"use client";

import { useCallback, useRef, useState } from "react";
import { getVideoConstraints } from "@/lib/settings";
import { deleteRecordingChunks, getRecordingChunks, saveRecordingChunk } from "@/lib/storage";
import { YoloVehicleDetector, type VehicleDetection } from "@/lib/yolo-vehicle-detector";
import type { CameraLens, HudFrame, HudOverlayMetrics, HudTarget, RecordedVideoChunk, VehicleClosingRisk, VehicleLockDisplayState, VehicleRelativeMotion, VehicleTrackEvidence, VideoQuality } from "@/types/drive";

type VideoRecorderStartOptions = {
  cameraLens: CameraLens;
  hudEnabled: boolean;
  plateOcrEnabled: boolean;
  hudSensitivityAuto: boolean;
  hudSensitivity: number;
};

type PlateMemory = {
  confidence: number;
  expiresAt: number;
};

type TrackedVehicle = {
  id: string;
  label: HudTarget["evidence"]["detectionClass"];
  confidence: number;
  detectionConfidence: number;
  trackConfidence: number;
  stability: number;
  leadScore: number;
  x: number;
  y: number;
  width: number;
  height: number;
  vx: number;
  vy: number;
  vw: number;
  vh: number;
  misses: number;
  ageFrames: number;
  hits: number;
  createdAt: number;
  lastSeenAt: number;
  lastDetectedAt: number;
  previousSeenAt: number | null;
  lastEvidence: VehicleTrackEvidence | null;
  predicted: boolean;
  association: VehicleTrackEvidence["tracking"]["association"];
};

type TrackUpdate = {
  track: TrackedVehicle;
  detection: VehicleDetection | null;
  iouWithPrevious: number | null;
};

type LeadLockState = {
  trackId: string | null;
  lockedAt: number | null;
  pendingTrackId: string | null;
  pendingSince: number | null;
  lostSince: number | null;
  displayState: VehicleLockDisplayState;
};

const YOLO_MODEL_NAME = "yolov8n-onnx";
const DETECTION_INTERVAL_MS = 280;
const RECORDING_FRAME_RATE = 30;
const TRACK_IOU_THRESHOLD = 0.18;
const MAX_TRACK_MISSES = 12;
const MAX_HUD_TARGETS = 4;
const LEAD_SWITCH_MARGIN = 0.34;
const LEAD_SWITCH_HOLD_MS = 1500;
const WEAK_LOCK_MS = 750;

export function useVideoRecorder(quality: VideoQuality, audio: boolean, getOverlayMetrics: () => HudOverlayMetrics) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [recordingSupported, setRecordingSupported] = useState(true);
  const [hudTargets, setHudTargets] = useState<HudTarget[]>([]);
  const hudFramesRef = useRef<HudFrame[]>([]);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<RecordedVideoChunk[]>([]);
  const recordingIdRef = useRef<string | null>(null);
  const chunkSequenceRef = useRef(0);
  const chunkWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const mimeTypeRef = useRef("video/webm");
  const animationFrameRef = useRef<number | null>(null);
  const detectionTimerRef = useRef<number | null>(null);
  const videoFrameCallbackRef = useRef<number | null>(null);
  const compositeVideoRef = useRef<HTMLVideoElement | null>(null);
  const drawingActiveRef = useRef(false);
  const ocrTimerRef = useRef<number | null>(null);
  const ocrBusyRef = useRef(false);
  const detectorRef = useRef<YoloVehicleDetector | null>(null);
  const hudTargetsRef = useRef<HudTarget[]>([]);
  const tracksRef = useRef<TrackedVehicle[]>([]);
  const nextTrackIdRef = useRef(1);
  const leadLockRef = useRef<LeadLockState>({
    trackId: null,
    lockedAt: null,
    pendingTrackId: null,
    pendingSince: null,
    lostSince: null,
    displayState: "no_vehicle"
  });
  const plateTextByTrackRef = useRef<Record<string, string>>({});
  const plateConfidenceByTrackRef = useRef<Record<string, number>>({});
  const plateMemoryRef = useRef<Record<string, PlateMemory>>({});
  const compositeStreamRef = useRef<MediaStream | null>(null);
  const detectorStatusRef = useRef<"idle" | "loading" | "ready" | "unsupported">("idle");
  const plateOcrStatusRef = useRef<"idle" | "ready" | "unsupported">("idle");
  const hudSensitivityOptionsRef = useRef({ auto: true, sensitivity: 55 });

  const getSupportedMimeType = useCallback(() => {
    if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return "";
    const candidates = ["video/mp4;codecs=h264", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
    return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
  }, []);

  const applyCameraLens = useCallback(async (mediaStream: MediaStream, cameraLens: CameraLens) => {
    if (cameraLens === "auto") return;
    const track = mediaStream.getVideoTracks()[0];
    if (!track) return;
    const capabilities = typeof track.getCapabilities === "function" ? (track.getCapabilities() as MediaTrackCapabilities & { zoom?: { min?: number; max?: number; step?: number } }) : {};
    if (!capabilities.zoom) {
      setError(`Lens ${cameraLens} requested, but this browser does not expose camera zoom selection. Using the default rear camera.`);
      return;
    }
    const requestedZoom = cameraLens === "0.5x" ? 0.5 : cameraLens === "3x" ? 3 : 1;
    const min = capabilities.zoom.min ?? requestedZoom;
    const max = capabilities.zoom.max ?? requestedZoom;
    const zoom = Math.min(max, Math.max(min, requestedZoom));
    try {
      await track.applyConstraints({ advanced: [{ zoom }] } as unknown as MediaTrackConstraints);
    } catch {
      setError(`Could not switch to ${cameraLens}. Using the closest available rear camera.`);
    }
  }, []);

  const buildHudLabel = useCallback((target: HudTarget) => {
    const lock = target.displayState === "weak_lock" ? "WEAK LOCK" : target.lockState === "locked" ? "LOCK" : "VEH";
    const plate = target.plateText && (target.plateConfidence ?? 0) >= 90 ? ` ${target.plateText}` : "";
    return `${lock}${plate} ${relativeMotionLabel(target.relativeMotionEstimate)} RISK ${target.closingRisk.toUpperCase()} TC${Math.round(target.trackConfidence * 100)}`;
  }, []);

  const drawTelemetryOverlay = useCallback((ctx: CanvasRenderingContext2D, metrics: HudOverlayMetrics, targets: HudTarget[], width: number, height: number) => {
    const locked = targets.find((target) => target.lockState === "locked") ?? null;
    const speed = metrics.ownSpeedMetresPerSecond !== null ? `${(metrics.ownSpeedMetresPerSecond * 3.6).toFixed(0)} KMH` : "-- KMH";
    const time = new Date(metrics.timestamp).toLocaleTimeString();
    const coords = metrics.latitude !== null && metrics.longitude !== null ? `${metrics.latitude.toFixed(5)}, ${metrics.longitude.toFixed(5)}` : "GPS --";
    const weather = metrics.weather ? `${metrics.weather.temperatureCelsius?.toFixed(0) ?? "--"}C ${metrics.weather.summary}` : "WX --";
    const gap = locked?.estimatedCarLengthsAhead !== null && locked?.estimatedCarLengthsAhead !== undefined ? `${locked.estimatedCarLengthsAhead.toFixed(1)} CAR LENGTHS` : "NO TARGET";
    const motion = locked ? `${lockStateLabel(locked.displayState)} / ${relativeMotionLabel(locked.relativeMotionEstimate)} / RISK ${locked.closingRisk.toUpperCase()}` : "NO VEHICLE";
    const confidence = locked ? `TRACK ${Math.round(locked.trackConfidence * 100)}% / LOCK ${(locked.lockDurationMs / 1000).toFixed(1)}S` : "TRACK --";
    const lines = [speed, time, coords, weather, gap, motion, confidence];

    ctx.save();
    ctx.font = `${Math.max(18, width * 0.018)}px monospace`;
    ctx.textBaseline = "top";
    const lineHeight = Math.max(24, width * 0.024);
    const boxWidth = Math.max(...lines.map((line) => ctx.measureText(line).width)) + 24;
    const boxHeight = lineHeight * lines.length + 16;
    ctx.fillStyle = "rgba(5, 6, 7, 0.68)";
    ctx.fillRect(14, 14, boxWidth, boxHeight);
    ctx.fillStyle = "#4ade80";
    lines.forEach((line, index) => ctx.fillText(line, 26, 22 + index * lineHeight));
    ctx.restore();
  }, []);

  const drawHud = useCallback((ctx: CanvasRenderingContext2D, targets: HudTarget[], width: number, height: number) => {
    ctx.save();
    ctx.lineWidth = Math.max(3, width * 0.003);
    ctx.font = `${Math.max(18, width * 0.018)}px monospace`;
    targets.forEach((target) => {
      const color = target.lockState === "locked" ? "#4ade80" : "#f59e0b";
      const x = target.x * width;
      const y = target.y * height;
      const boxWidth = target.width * width;
      const boxHeight = target.height * height;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.strokeRect(x, y, boxWidth, boxHeight);
      const label = buildHudLabel(target);
      const labelWidth = ctx.measureText(label).width + 14;
      const labelY = Math.min(height - 28, y + boxHeight + 4);
      ctx.fillRect(x, labelY, labelWidth, 26);
      ctx.fillStyle = "#050607";
      ctx.fillText(label, x + 7, labelY + 19);
    });
    ctx.restore();
    drawTelemetryOverlay(ctx, getOverlayMetrics(), targets, width, height);
  }, [buildHudLabel, drawTelemetryOverlay, getOverlayMetrics]);

  const recognisePlateText = useCallback(async (video: HTMLVideoElement, target: HudTarget) => {
    if (ocrBusyRef.current) return;
    ocrBusyRef.current = true;
    try {
      if (plateOcrStatusRef.current === "idle") {
        const tesseract = await import("tesseract.js");
        if (typeof tesseract.recognize !== "function") {
          plateOcrStatusRef.current = "unsupported";
          setError("Plate OCR is unavailable in this browser. HUD vehicle boxes can still continue.");
          return;
        }
        plateOcrStatusRef.current = "ready";
      }
      if (plateOcrStatusRef.current !== "ready") return;

      const cropCanvas = document.createElement("canvas");
      const videoWidth = video.videoWidth || 1;
      const videoHeight = video.videoHeight || 1;
      const sourceX = Math.max(0, target.x * videoWidth);
      const sourceY = Math.max(0, (target.y + target.height * 0.52) * videoHeight);
      const sourceWidth = Math.min(videoWidth - sourceX, target.width * videoWidth);
      const sourceHeight = Math.min(videoHeight - sourceY, target.height * videoHeight * 0.38);
      if (sourceWidth < 80 || sourceHeight < 24) return;

      cropCanvas.width = 320;
      cropCanvas.height = Math.max(80, Math.round((sourceHeight / sourceWidth) * 320));
      const cropCtx = cropCanvas.getContext("2d");
      if (!cropCtx) return;
      cropCtx.filter = "contrast(1.35) grayscale(1)";
      cropCtx.drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, cropCanvas.width, cropCanvas.height);
      const { recognize } = await import("tesseract.js");
      const result = await recognize(cropCanvas, "eng");
      const plateResult = cleanPlateText(result.data.text, result.data.confidence ?? 0);
      if (plateResult) {
        plateTextByTrackRef.current[target.id] = plateResult.text;
        plateConfidenceByTrackRef.current[target.id] = plateResult.confidence;
        plateMemoryRef.current[plateResult.text] = {
          confidence: plateResult.confidence,
          expiresAt: Date.now() + 5 * 60 * 1000
        };
      }
    } catch {
      plateOcrStatusRef.current = "unsupported";
      setError("Plate OCR could not run on this device. HUD vehicle boxes can still continue.");
    } finally {
      ocrBusyRef.current = false;
    }
  }, []);

  const startPlateOcr = useCallback(
    (video: HTMLVideoElement) => {
      ocrTimerRef.current = window.setInterval(() => {
        const lockedTarget = hudTargetsRef.current.find((target) => target.lockState === "locked") ?? hudTargetsRef.current[0];
        if (!lockedTarget) return;
        if (lockedTarget.plateText && (lockedTarget.plateConfidence ?? 0) >= 90) return;
        void recognisePlateText(video, lockedTarget);
      }, 2200);
    },
    [recognisePlateText]
  );

  const startHudDetection = useCallback(async (video: HTMLVideoElement, plateOcrEnabled: boolean) => {
    if (detectorStatusRef.current === "idle") {
      detectorStatusRef.current = "loading";
      try {
        detectorRef.current = await YoloVehicleDetector.load();
        detectorStatusRef.current = "ready";
      } catch {
        detectorStatusRef.current = "unsupported";
        setError("HUD vehicle detection could not load. Add a YOLO nano ONNX model at /public/models/yolov8n.onnx, or set NEXT_PUBLIC_YOLO_MODEL_URL.");
        return;
      }
    }
    if (detectorStatusRef.current !== "ready" || !detectorRef.current) return;

    let detectionBusy = false;
    const runDetection = () => {
      if (detectionBusy) return;
      detectionBusy = true;
      const threshold = getHudConfidenceThreshold(hudSensitivityOptionsRef.current);
      detectorRef.current
        ?.detect(video, threshold)
        .then((detections) => {
          const timestamp = Date.now();
          const metrics = getOverlayMetrics();
          prunePlateMemory(plateMemoryRef.current);
          const updates = updateTracks(tracksRef.current, detections, timestamp, nextTrackIdRef, metrics.ownSpeedMetresPerSecond);
          const lead = updateLeadLock(tracksRef.current, leadLockRef.current, timestamp);
          const targets = buildHudTargets(updates, lead, leadLockRef.current, plateTextByTrackRef.current, plateConfidenceByTrackRef.current, plateMemoryRef.current);
          const leadTarget = lead ? targets.find((target) => target.id === lead.id) ?? null : null;
          const visibleTargets = leadTarget
            ? [leadTarget, ...targets.filter((target) => target.id !== leadTarget.id).slice(0, MAX_HUD_TARGETS - 1)]
            : targets.slice(0, MAX_HUD_TARGETS);
          hudTargetsRef.current = visibleTargets;
          hudFramesRef.current.push({
            timestamp,
            targets: visibleTargets,
            detections: tracksRef.current.map((track) => track.lastEvidence).filter((evidence): evidence is VehicleTrackEvidence => Boolean(evidence)),
            trackingState: leadLockRef.current.displayState
          });
          setHudTargets(visibleTargets);
        })
        .catch(() => undefined)
        .finally(() => {
          detectionBusy = false;
        });
    };
    detectionTimerRef.current = window.setInterval(runDetection, DETECTION_INTERVAL_MS);
    runDetection();
    if (plateOcrEnabled) startPlateOcr(video);
  }, [getOverlayMetrics, startPlateOcr]);

  const startCompositeRecording = useCallback(
    async (mediaStream: MediaStream, plateOcrEnabled: boolean) => {
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = mediaStream;
      compositeVideoRef.current = video;
      drawingActiveRef.current = true;
      await video.play();

      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas recording is not available in this browser.");

      const drawFrame = () => {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        drawHud(ctx, hudTargetsRef.current, canvas.width, canvas.height);
      };
      const scheduleVideoFrame = () => {
        if (!drawingActiveRef.current) return;
        const requestVideoFrameCallback = "requestVideoFrameCallback" in video ? video.requestVideoFrameCallback.bind(video) : null;
        if (requestVideoFrameCallback) {
          videoFrameCallbackRef.current = requestVideoFrameCallback(() => {
            if (!drawingActiveRef.current) return;
            drawFrame();
            scheduleVideoFrame();
          });
          return;
        }
        let lastDrawAt = 0;
        const frameInterval = 1000 / RECORDING_FRAME_RATE;
        const drawLoop = (now: number) => {
          if (!drawingActiveRef.current) return;
          if (now - lastDrawAt >= frameInterval) {
            lastDrawAt = now;
            drawFrame();
          }
          animationFrameRef.current = window.requestAnimationFrame(drawLoop);
        };
        animationFrameRef.current = window.requestAnimationFrame(drawLoop);
      };
      drawFrame();
      scheduleVideoFrame();
      await startHudDetection(video, plateOcrEnabled);

      const canvasStream = canvas.captureStream(RECORDING_FRAME_RATE);
      mediaStream.getAudioTracks().forEach((track) => canvasStream.addTrack(track));
      compositeStreamRef.current = canvasStream;
      return canvasStream;
    },
    [drawHud, startHudDetection]
  );

  const start = useCallback(async (options: VideoRecorderStartOptions) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera access is not supported in this browser.");
      return false;
    }
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: getVideoConstraints(quality),
        audio
      });
      await applyCameraLens(mediaStream, options.cameraLens);
      setStream(mediaStream);
      hudFramesRef.current = [];
      tracksRef.current = [];
      nextTrackIdRef.current = 1;
      leadLockRef.current = {
        trackId: null,
        lockedAt: null,
        pendingTrackId: null,
        pendingSince: null,
        lostSince: null,
        displayState: "no_vehicle"
      };
      hudSensitivityOptionsRef.current = {
        auto: options.hudSensitivityAuto,
        sensitivity: options.hudSensitivity
      };

      if (typeof MediaRecorder === "undefined") {
        setRecordingSupported(false);
        setError("Video recording is not supported in this browser. Sensor and GPS logging can still continue.");
        return true;
      }

      const recordingStream = options.hudEnabled ? await startCompositeRecording(mediaStream, options.plateOcrEnabled) : mediaStream;
      const mimeType = getSupportedMimeType();
      const recorder = mimeType ? new MediaRecorder(recordingStream, { mimeType }) : new MediaRecorder(recordingStream);
      mimeTypeRef.current = recorder.mimeType || mimeType || "video/webm";
      recordingIdRef.current = `recording-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      chunkSequenceRef.current = 0;
      chunkWriteQueueRef.current = Promise.resolve();
      recordedChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          const recordingId = recordingIdRef.current;
          const sequence = chunkSequenceRef.current;
          chunkSequenceRef.current += 1;
          if (recordingId) {
            chunkWriteQueueRef.current = chunkWriteQueueRef.current
              .then(() => saveRecordingChunk(recordingId, sequence, event.data))
              .catch(() => {
                setError("Video storage is full or unavailable. Stop the drive to preserve the data already recorded.");
              });
          }
          recordedChunksRef.current.push({
            id: `chunk-${Date.now()}-${recordedChunksRef.current.length}`,
            timestamp: Date.now(),
            blob: event.data,
            contentType: event.data.type || mimeTypeRef.current
          });
          pruneRecordedChunks(recordedChunksRef.current);
        }
      };
      recorder.start(1000);
      recorderRef.current = recorder;
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Camera permission was denied.");
      return false;
    }
  }, [applyCameraLens, audio, getSupportedMimeType, quality, startCompositeRecording]);

  const stop = useCallback(async () => {
    drawingActiveRef.current = false;
    if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current);
    if (videoFrameCallbackRef.current !== null && compositeVideoRef.current && "cancelVideoFrameCallback" in compositeVideoRef.current) {
      compositeVideoRef.current.cancelVideoFrameCallback(videoFrameCallbackRef.current);
    }
    if (detectionTimerRef.current !== null) window.clearInterval(detectionTimerRef.current);
    if (ocrTimerRef.current !== null) window.clearInterval(ocrTimerRef.current);
    animationFrameRef.current = null;
    videoFrameCallbackRef.current = null;
    detectionTimerRef.current = null;
    ocrTimerRef.current = null;
    ocrBusyRef.current = false;
    setHudTargets([]);
    hudTargetsRef.current = [];
    tracksRef.current = [];
    leadLockRef.current = {
      trackId: null,
      lockedAt: null,
      pendingTrackId: null,
      pendingSince: null,
      lostSince: null,
      displayState: "no_vehicle"
    };
    plateTextByTrackRef.current = {};
    plateConfidenceByTrackRef.current = {};
    const recorder = recorderRef.current;
    const stopped = new Promise<Blob | null>((resolve) => {
      if (!recorder || recorder.state === "inactive") {
        void buildRecordedBlob(recordingIdRef.current, mimeTypeRef.current, chunkWriteQueueRef.current).then(resolve);
        return;
      }
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          const recordingId = recordingIdRef.current;
          const sequence = chunkSequenceRef.current;
          chunkSequenceRef.current += 1;
          if (recordingId) {
            chunkWriteQueueRef.current = chunkWriteQueueRef.current.then(() => saveRecordingChunk(recordingId, sequence, event.data));
          }
          recordedChunksRef.current.push({
            id: `chunk-${Date.now()}-${recordedChunksRef.current.length}`,
            timestamp: Date.now(),
            blob: event.data,
            contentType: event.data.type || mimeTypeRef.current
          });
        }
      };
      recorder.onstop = () => {
        window.setTimeout(() => {
          void buildRecordedBlob(recordingIdRef.current, recorder.mimeType || mimeTypeRef.current, chunkWriteQueueRef.current).then(resolve);
        }, 80);
      };
      if (typeof recorder.requestData === "function") recorder.requestData();
      recorder.stop();
    });
    stream?.getTracks().forEach((track) => track.stop());
    compositeStreamRef.current?.getTracks().forEach((track) => track.stop());
    compositeStreamRef.current = null;
    compositeVideoRef.current = null;
    setStream(null);
    return stopped;
  }, [stream]);

  const getChunksInWindow = useCallback((start: number, end: number) => {
    return recordedChunksRef.current.filter((chunk) => chunk.timestamp >= start && chunk.timestamp <= end);
  }, []);

  return { stream, hudTargets, hudFramesRef, recordingSupported, error, start, stop, getChunksInWindow, mimeTypeRef };
}

function pruneRecordedChunks(chunks: RecordedVideoChunk[]): void {
  const oldestProtectedTime = Date.now() - 2 * 60 * 1000 - 10 * 1000;
  while (chunks.length && chunks[0].timestamp < oldestProtectedTime) chunks.shift();
}

async function buildRecordedBlob(recordingId: string | null, mimeType: string, writeQueue: Promise<void>): Promise<Blob | null> {
  if (!recordingId) return null;
  try {
    await writeQueue;
    const chunks = await getRecordingChunks(recordingId);
    return chunks.length ? new Blob(chunks, { type: mimeType }) : null;
  } finally {
    await deleteRecordingChunks(recordingId).catch(() => undefined);
  }
}

function updateTracks(tracks: TrackedVehicle[], detections: VehicleDetection[], timestamp: number, nextTrackIdRef: { current: number }, hostSpeedMetresPerSecond: number | null): TrackUpdate[] {
  tracks.forEach((track) => predictTrack(track, timestamp));

  const updates: TrackUpdate[] = [];
  const unmatchedTracks = new Set(tracks.map((track) => track.id));
  const unmatchedDetections = new Set(detections.map((_, index) => index));

  associateDetections("high_confidence", 0.5);
  associateDetections("low_confidence", 0.22);

  detections.forEach((detection, index) => {
    if (!unmatchedDetections.has(index) || detection.confidence < 0.34 || !inDetectionConcernArea(detection)) return;
    const track = createTrack(detection, timestamp, nextTrackIdRef);
    track.lastEvidence = buildEvidence(track, detection, null, null, timestamp, hostSpeedMetresPerSecond, "high_confidence", "searching");
    tracks.push(track);
    updates.push({ track, detection, iouWithPrevious: null });
  });

  tracks.forEach((track) => {
    if (unmatchedTracks.has(track.id)) {
      track.misses += 1;
      track.ageFrames += 1;
      track.predicted = true;
      track.association = "prediction";
      track.confidence = Math.max(0, track.confidence * 0.72);
      track.trackConfidence = Math.max(0, track.trackConfidence * 0.84);
      track.stability = Math.max(0, track.stability * 0.9);
      track.lastEvidence = buildEvidence(track, null, null, null, timestamp, hostSpeedMetresPerSecond, "prediction", "searching");
      updates.push({ track, detection: null, iouWithPrevious: null });
    }
  });

  for (let index = tracks.length - 1; index >= 0; index -= 1) {
    if (tracks[index].misses > MAX_TRACK_MISSES || tracks[index].trackConfidence < 0.06) tracks.splice(index, 1);
  }
  return updates;

  function associateDetections(association: VehicleTrackEvidence["tracking"]["association"], minimumConfidence: number) {
    const candidates = detections
      .map((detection, index) => ({ detection, index }))
      .filter(({ detection, index }) => unmatchedDetections.has(index) && detection.confidence >= minimumConfidence)
      .sort((a, b) => b.detection.confidence - a.detection.confidence);

    candidates.forEach(({ detection, index }) => {
      const match = tracks
        .filter((track) => unmatchedTracks.has(track.id))
        .map((track) => {
          const iou = boxIoU(track, detection);
          const centerDistance = centerDistanceBetween(track, detection);
          const targetDiagonal = Math.hypot(track.width, track.height);
          const motionGate = Math.min(0.42, Math.max(0.13, targetDiagonal * 1.65 + track.misses * 0.035));
          const proximity = Math.max(0, 1 - centerDistance / motionGate);
          const classCompatibility = track.label === detection.label ? 1 : 0.72;
          const associationScore = (iou * 0.46 + proximity * 0.42 + track.trackConfidence * 0.12) * classCompatibility;
          return { track, iou, associationScore, centerDistance, motionGate };
        })
        .filter((candidate) => candidate.iou >= TRACK_IOU_THRESHOLD || (candidate.centerDistance <= candidate.motionGate && candidate.associationScore >= 0.3))
        .sort((a, b) => b.associationScore - a.associationScore)[0];
      if (!match) return;
      updateMatchedTrack(match.track, detection, match.iou, timestamp, hostSpeedMetresPerSecond, association);
      updates.push({ track: match.track, detection, iouWithPrevious: match.iou });
      unmatchedTracks.delete(match.track.id);
      unmatchedDetections.delete(index);
    });
  }
}

function buildHudTargets(updates: TrackUpdate[], lead: TrackedVehicle | null, lock: LeadLockState, plates: Record<string, string>, plateConfidences: Record<string, number>, plateMemory: Record<string, PlateMemory>): HudTarget[] {
  const displayable = updates
    .map(({ track }): HudTarget | null => {
      const plateText = plates[track.id] ?? null;
      const memory = plateText ? plateMemory[plateText] : undefined;
      const evidence = track.lastEvidence;
      if (!evidence) return null;
      const displayState = track.id === lead?.id ? lock.displayState : "searching";
      const target: HudTarget = {
        id: track.id,
        label: track.label,
        confidence: track.confidence,
        x: track.x,
        y: track.y,
        width: track.width,
        height: track.height,
        lockState: track.id === lead?.id && (lock.displayState === "strong_lock" || lock.displayState === "weak_lock") ? "locked" : "candidate",
        plateText,
        plateConfidence: memory?.confidence ?? plateConfidences[track.id] ?? null,
        estimatedDistanceMetres: evidence.estimatedDistanceMetres,
        estimatedCarLengthsAhead: evidence.estimatedCarLengthsAhead,
        relativeMotionEstimate: evidence.relativeMotionEstimate,
        closingRisk: evidence.closingRisk,
        closingRiskScore: evidence.closingRiskScore,
        displayState,
        trackConfidence: track.trackConfidence,
        lockDurationMs: track.id === lead?.id && lock.lockedAt ? Math.max(0, evidence.timestamp - lock.lockedAt) : 0,
        trackStability: track.stability,
        predicted: track.predicted,
        trackAgeFrames: track.ageFrames,
        lastSeenAt: track.lastSeenAt,
        evidence: {
          ...evidence,
          tracking: {
            ...evidence.tracking,
            displayState,
            lockDurationMs: track.id === lead?.id && lock.lockedAt ? Math.max(0, evidence.timestamp - lock.lockedAt) : 0,
            leadScore: track.leadScore
          }
        }
      };
      track.lastEvidence = target.evidence;
      return target;
    })
    .filter((target): target is HudTarget => Boolean(target))
    .filter((target) => inAreaOfConcern(target))
    .sort((a, b) => frontScore(b) - frontScore(a));
  return displayable;
}

function updateLeadLock(tracks: TrackedVehicle[], lock: LeadLockState, timestamp: number): TrackedVehicle | null {
  const leadable = tracks.filter((track) => inTrackConcernArea(track) && track.trackConfidence > 0.12);
  leadable.forEach((track) => {
    track.leadScore = calculateLeadScore(track, track.id === lock.trackId);
  });
  const best = leadable.slice().sort((a, b) => b.leadScore - a.leadScore)[0] ?? null;
  const current = lock.trackId ? tracks.find((track) => track.id === lock.trackId) ?? null : null;

  if (!best) {
    if (current && timestamp - current.lastDetectedAt <= WEAK_LOCK_MS) {
      lock.displayState = "weak_lock";
      return current;
    }
    lock.trackId = null;
    lock.lockedAt = null;
    lock.pendingTrackId = null;
    lock.pendingSince = null;
    lock.displayState = tracks.length ? "lost_target" : "no_vehicle";
    return null;
  }

  if (!current || !lock.trackId) {
    lock.trackId = best.id;
    lock.lockedAt = timestamp;
    lock.pendingTrackId = null;
    lock.pendingSince = null;
    lock.displayState = best.predicted ? "weak_lock" : "strong_lock";
    return best;
  }

  const currentMissingMs = timestamp - current.lastDetectedAt;
  if (currentMissingMs > WEAK_LOCK_MS) {
    lock.trackId = null;
    lock.lockedAt = null;
    lock.pendingTrackId = null;
    lock.pendingSince = null;
    lock.displayState = "lost_target";
    return null;
  }

  if (best.id !== current.id && best.leadScore > current.leadScore + LEAD_SWITCH_MARGIN) {
    if (lock.pendingTrackId !== best.id) {
      lock.pendingTrackId = best.id;
      lock.pendingSince = timestamp;
    } else if (lock.pendingSince && timestamp - lock.pendingSince >= LEAD_SWITCH_HOLD_MS) {
      lock.trackId = best.id;
      lock.lockedAt = timestamp;
      lock.pendingTrackId = null;
      lock.pendingSince = null;
      lock.displayState = best.predicted ? "weak_lock" : "strong_lock";
      return best;
    }
  } else {
    lock.pendingTrackId = null;
    lock.pendingSince = null;
  }

  lock.displayState = current.predicted ? "weak_lock" : "strong_lock";
  return current;
}

function buildEvidence(
  track: TrackedVehicle,
  detection: VehicleDetection | null,
  previous: TrackedVehicle | null,
  iouWithPrevious: number | null,
  timestamp: number,
  hostSpeedMetresPerSecond: number | null,
  association: VehicleTrackEvidence["tracking"]["association"],
  displayState: VehicleLockDisplayState
): VehicleTrackEvidence {
  const boxAreaRatio = track.width * track.height;
  const previousArea = previous ? previous.width * previous.height : null;
  const seconds = previous ? Math.max(0.08, (timestamp - previous.lastSeenAt) / 1000) : null;
  const scaleDeltaPerSecond = previousArea !== null && seconds ? (Math.sqrt(boxAreaRatio) - Math.sqrt(previousArea)) / seconds : null;
  const centerX = track.x + track.width / 2;
  const centerY = track.y + track.height / 2;
  const previousCenterX = previous ? previous.x + previous.width / 2 : null;
  const previousCenterY = previous ? previous.y + previous.height / 2 : null;
  const centerDeltaX = previousCenterX !== null && seconds ? (centerX - previousCenterX) / seconds : null;
  const centerDeltaY = previousCenterY !== null && seconds ? (centerY - previousCenterY) / seconds : null;
  const { estimatedDistanceMetres, estimatedCarLengthsAhead } = estimateDistance(track.label, track.width);
  const relativeMotionEstimate = classifyRelativeMotion(scaleDeltaPerSecond, centerDeltaX, centerDeltaY);
  const { closingRisk, closingRiskScore, motionBasis } = classifyClosingRisk(relativeMotionEstimate, scaleDeltaPerSecond, centerX, boxAreaRatio, hostSpeedMetresPerSecond, estimatedCarLengthsAhead);

  return {
    timestamp,
    model: YOLO_MODEL_NAME,
    trackId: track.id,
    detectionId: detection?.id ?? `${track.id}-predicted-${timestamp}`,
    detectionClass: track.label,
    confidence: track.confidence,
    bbox: {
      x: track.x,
      y: track.y,
      width: track.width,
      height: track.height
    },
    iouWithPrevious,
    boxAreaRatio,
    scaleDeltaPerSecond,
    centerDeltaPerSecond: {
      x: centerDeltaX,
      y: centerDeltaY
    },
    hostSpeedMetresPerSecond,
    estimatedDistanceMetres,
    estimatedCarLengthsAhead,
    relativeMotionEstimate,
    closingRisk,
    closingRiskScore,
    motionBasis,
    tracking: {
      displayState,
      trackConfidence: track.trackConfidence,
      lockDurationMs: 0,
      trackAgeFrames: track.ageFrames,
      trackStability: track.stability,
      leadScore: track.leadScore,
      predicted: track.predicted,
      lostForMs: Math.max(0, timestamp - track.lastDetectedAt),
      association
    }
  };
}

function createTrack(detection: VehicleDetection, timestamp: number, nextTrackIdRef: { current: number }): TrackedVehicle {
  const track: TrackedVehicle = {
    id: `veh-${nextTrackIdRef.current}`,
    label: detection.label,
    confidence: detection.confidence,
    detectionConfidence: detection.confidence,
    trackConfidence: clamp(detection.confidence * 0.72, 0, 1),
    stability: 0.15,
    leadScore: 0,
    x: detection.x,
    y: detection.y,
    width: detection.width,
    height: detection.height,
    vx: 0,
    vy: 0,
    vw: 0,
    vh: 0,
    misses: 0,
    ageFrames: 1,
    hits: 1,
    createdAt: timestamp,
    lastSeenAt: timestamp,
    lastDetectedAt: timestamp,
    previousSeenAt: null,
    lastEvidence: null,
    predicted: false,
    association: "high_confidence"
  };
  nextTrackIdRef.current += 1;
  return track;
}

function predictTrack(track: TrackedVehicle, timestamp: number): void {
  const seconds = Math.min(0.5, Math.max(0, (timestamp - track.lastSeenAt) / 1000));
  if (seconds <= 0) return;
  track.x = clamp(track.x + track.vx * seconds, 0, 1 - track.width);
  track.y = clamp(track.y + track.vy * seconds, 0, 1 - track.height);
  track.width = clamp(track.width + track.vw * seconds, 0.01, 1);
  track.height = clamp(track.height + track.vh * seconds, 0.01, 1);
  track.lastSeenAt = timestamp;
}

function updateMatchedTrack(
  track: TrackedVehicle,
  detection: VehicleDetection,
  iou: number,
  timestamp: number,
  hostSpeedMetresPerSecond: number | null,
  association: VehicleTrackEvidence["tracking"]["association"]
): void {
  const previous = { ...track };
  const seconds = Math.max(0.08, (timestamp - track.lastDetectedAt) / 1000);
  const alpha = association === "high_confidence" ? 0.44 : 0.28;
  const nextX = lerp(track.x, detection.x, alpha);
  const nextY = lerp(track.y, detection.y, alpha);
  const nextWidth = lerp(track.width, detection.width, alpha);
  const nextHeight = lerp(track.height, detection.height, alpha);

  track.vx = smoothVelocity(track.vx, (detection.x - previous.x) / seconds);
  track.vy = smoothVelocity(track.vy, (detection.y - previous.y) / seconds);
  track.vw = smoothVelocity(track.vw, (detection.width - previous.width) / seconds);
  track.vh = smoothVelocity(track.vh, (detection.height - previous.height) / seconds);
  track.x = clamp(nextX, 0, 1 - nextWidth);
  track.y = clamp(nextY, 0, 1 - nextHeight);
  track.width = clamp(nextWidth, 0.01, 1);
  track.height = clamp(nextHeight, 0.01, 1);
  track.confidence = detection.confidence;
  track.detectionConfidence = detection.confidence;
  track.trackConfidence = clamp(track.trackConfidence * 0.82 + detection.confidence * 0.18 + Math.min(0.1, iou * 0.08), 0, 1);
  track.stability = clamp(track.stability * 0.8 + iou * 0.2 + (association === "high_confidence" ? 0.04 : 0), 0, 1);
  track.misses = 0;
  track.hits += 1;
  track.ageFrames += 1;
  track.previousSeenAt = previous.lastSeenAt;
  track.lastSeenAt = timestamp;
  track.lastDetectedAt = timestamp;
  track.predicted = false;
  track.association = association;
  track.lastEvidence = buildEvidence(track, detection, previous, iou, timestamp, hostSpeedMetresPerSecond, association, "searching");
}

function calculateLeadScore(track: TrackedVehicle, wasPreviousLead: boolean): number {
  const centerX = track.x + track.width / 2;
  const centerY = track.y + track.height / 2;
  const centerScore = 1 - Math.min(1, Math.abs(centerX - 0.5) * 2.25);
  const verticalScore = clamp((centerY - 0.32) / 0.55, 0, 1);
  const sizeScore = clamp(Math.sqrt(track.width * track.height) / 0.38, 0, 1);
  const ageScore = clamp(track.ageFrames / 16, 0, 1);
  const stabilityScore = track.stability;
  const confidenceScore = track.trackConfidence;
  const previousLeadBoost = wasPreviousLead ? 0.46 : 0;
  const predictedPenalty = track.predicted ? 0.18 : 0;
  return (
    centerScore * 0.28 +
    verticalScore * 0.16 +
    sizeScore * 0.2 +
    confidenceScore * 0.18 +
    ageScore * 0.08 +
    stabilityScore * 0.1 +
    previousLeadBoost -
    predictedPenalty
  );
}

function centerDistanceBetween(a: Pick<TrackedVehicle | VehicleDetection, "x" | "y" | "width" | "height">, b: Pick<TrackedVehicle | VehicleDetection, "x" | "y" | "width" | "height">): number {
  return Math.hypot(a.x + a.width / 2 - (b.x + b.width / 2), a.y + a.height / 2 - (b.y + b.height / 2));
}

function inDetectionConcernArea(detection: VehicleDetection): boolean {
  const center = detection.x + detection.width / 2;
  const rightEdge = detection.x + detection.width;
  return (center > 0.18 && center < 0.82) || (rightEdge > 0.48 && detection.x < 0.86);
}

function inTrackConcernArea(track: TrackedVehicle): boolean {
  const center = track.x + track.width / 2;
  const rightEdge = track.x + track.width;
  return (center > 0.16 && center < 0.84) || (rightEdge > 0.48 && track.x < 0.88);
}

function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * alpha;
}

function smoothVelocity(previous: number, next: number): number {
  return clamp(previous * 0.68 + next * 0.32, -1.5, 1.5);
}

function estimateDistance(label: TrackedVehicle["label"], boxWidthRatio: number): Pick<VehicleTrackEvidence, "estimatedDistanceMetres" | "estimatedCarLengthsAhead"> {
  const assumedWidthMetres = label === "motorcycle" ? 0.85 : label === "bus" || label === "truck" ? 2.45 : 1.85;
  const assumedLengthMetres = label === "motorcycle" ? 2.2 : label === "bus" || label === "truck" ? 8.5 : 4.5;
  const horizontalFovDegrees = 60;
  const focalLengthRatio = 1 / (2 * Math.tan((horizontalFovDegrees * Math.PI) / 360));
  const estimatedDistanceMetres = boxWidthRatio > 0.01 ? (assumedWidthMetres * focalLengthRatio) / boxWidthRatio : null;
  return {
    estimatedDistanceMetres,
    estimatedCarLengthsAhead: estimatedDistanceMetres !== null ? estimatedDistanceMetres / assumedLengthMetres : null
  };
}

function classifyRelativeMotion(scaleDeltaPerSecond: number | null, centerDeltaX: number | null, centerDeltaY: number | null): VehicleRelativeMotion {
  if (scaleDeltaPerSecond === null || centerDeltaX === null || centerDeltaY === null) return "unknown";
  const lateralMotion = Math.abs(centerDeltaX);
  if (lateralMotion > 0.12 && Math.abs(scaleDeltaPerSecond) < 0.05) return "crossing";
  if (scaleDeltaPerSecond > 0.035) return "approaching";
  if (scaleDeltaPerSecond < -0.035) return "moving_away";
  if (Math.abs(centerDeltaY) > 0.12 && scaleDeltaPerSecond > 0.015) return "approaching";
  return "stable";
}

function classifyClosingRisk(
  motion: VehicleRelativeMotion,
  scaleDeltaPerSecond: number | null,
  centerX: number,
  boxAreaRatio: number,
  hostSpeedMetresPerSecond: number | null,
  carLengthsAhead: number | null
): { closingRisk: VehicleClosingRisk; closingRiskScore: number; motionBasis: string[] } {
  const basis: string[] = [];
  const centered = 1 - Math.min(1, Math.abs(centerX - 0.5) * 2);
  const hostSpeedFactor = Math.min(1, (hostSpeedMetresPerSecond ?? 0) / 25);
  const scaleFactor = Math.max(0, Math.min(1, (scaleDeltaPerSecond ?? 0) / 0.18));
  const sizeFactor = Math.min(1, boxAreaRatio / 0.18);
  const distanceFactor = carLengthsAhead !== null ? Math.max(0, Math.min(1, (10 - carLengthsAhead) / 10)) : 0;
  const motionFactor = motion === "approaching" ? 1 : motion === "crossing" ? 0.55 : motion === "stable" ? 0.2 : 0;
  const closingRiskScore = clamp(motionFactor * 0.34 + scaleFactor * 0.24 + centered * 0.16 + sizeFactor * 0.12 + hostSpeedFactor * 0.08 + distanceFactor * 0.06, 0, 1);

  if (motion === "approaching") basis.push("bounding box scale is increasing");
  if (motion === "moving_away") basis.push("bounding box scale is decreasing");
  if (motion === "crossing") basis.push("centre point is moving laterally");
  if (centered > 0.65) basis.push("track is near forward corridor");
  if ((hostSpeedMetresPerSecond ?? 0) > 8) basis.push("host GPS speed is moving");
  if (carLengthsAhead !== null) basis.push("distance estimate from bounding box scale");

  if (motion === "unknown") return { closingRisk: "unknown", closingRiskScore, motionBasis: basis };
  if (closingRiskScore >= 0.68) return { closingRisk: "high", closingRiskScore, motionBasis: basis };
  if (closingRiskScore >= 0.38) return { closingRisk: "medium", closingRiskScore, motionBasis: basis };
  return { closingRisk: "low", closingRiskScore, motionBasis: basis };
}

function inAreaOfConcern(target: HudTarget): boolean {
  const center = target.x + target.width / 2;
  const rightEdge = target.x + target.width;
  return (center > 0.2 && center < 0.8) || (rightEdge > 0.5 && target.x < 0.84);
}

function frontScore(target: HudTarget): number {
  const center = target.x + target.width / 2;
  const centerOffset = Math.abs(center - 0.5);
  const area = target.width * target.height;
  const lockBoost = target.lockState === "locked" ? 0.4 : 0;
  const riskBoost = target.closingRisk === "high" ? 0.35 : target.closingRisk === "medium" ? 0.18 : 0;
  return target.confidence * 1.5 + area * 3 + riskBoost + lockBoost - centerOffset * 1.7;
}

function boxIoU(a: Pick<TrackedVehicle | VehicleDetection | HudTarget, "x" | "y" | "width" | "height">, b: Pick<TrackedVehicle | VehicleDetection | HudTarget, "x" | "y" | "width" | "height">): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

function relativeMotionLabel(motion: VehicleRelativeMotion): string {
  if (motion === "moving_away") return "MOVING AWAY";
  return motion.toUpperCase();
}

function lockStateLabel(state: VehicleLockDisplayState): string {
  if (state === "strong_lock") return "STRONG LOCK";
  if (state === "weak_lock") return "WEAK LOCK";
  if (state === "lost_target") return "LOST TARGET";
  if (state === "no_vehicle") return "NO VEHICLE";
  return "SEARCHING";
}

function getHudConfidenceThreshold(options: { auto: boolean; sensitivity: number }): number {
  if (!options.auto) {
    return clamp(0.84 - options.sensitivity * 0.0042, 0.42, 0.84);
  }
  return 0.52;
}

function prunePlateMemory(memory: Record<string, PlateMemory>): void {
  const now = Date.now();
  Object.entries(memory).forEach(([plate, entry]) => {
    if (entry.expiresAt < now) delete memory[plate];
  });
}

function cleanPlateText(rawText: string, confidence: number): { text: string; confidence: number } | null {
  if (confidence < 90) return null;
  const candidates = rawText
    .toUpperCase()
    .split(/\s+/)
    .map((part) => part.replace(/[^A-Z0-9]/g, ""))
    .filter((part) => part.length >= 3 && part.length <= 10 && /[A-Z]/.test(part) && /\d/.test(part));
  return candidates[0] ? { text: candidates[0], confidence } : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
