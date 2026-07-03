"use client";

import { useCallback, useRef, useState } from "react";
import { getVideoConstraints } from "@/lib/settings";
import type { CameraLens, HudFrame, HudTarget, VideoQuality } from "@/types/drive";

type VideoRecorderStartOptions = {
  cameraLens: CameraLens;
  hudEnabled: boolean;
  plateOcrEnabled: boolean;
  hudSensitivityAuto: boolean;
  hudSensitivity: number;
};

type VehicleDetector = {
  detect: (input: HTMLVideoElement) => Promise<Array<{ bbox: [number, number, number, number]; class: string; score: number }>>;
};

type TargetEstimateHistory = {
  distanceMetres: number;
  timestamp: number;
};

type PlateMemory = {
  confidence: number;
  expiresAt: number;
};

export function useVideoRecorder(quality: VideoQuality, audio: boolean, getOwnSpeedMetresPerSecond: () => number | null) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [recordingSupported, setRecordingSupported] = useState(true);
  const [hudTargets, setHudTargets] = useState<HudTarget[]>([]);
  const hudFramesRef = useRef<HudFrame[]>([]);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const mimeTypeRef = useRef("video/webm");
  const animationFrameRef = useRef<number | null>(null);
  const detectionTimerRef = useRef<number | null>(null);
  const ocrTimerRef = useRef<number | null>(null);
  const ocrBusyRef = useRef(false);
  const detectorRef = useRef<VehicleDetector | null>(null);
  const hudTargetsRef = useRef<HudTarget[]>([]);
  const plateTextByTargetRef = useRef<Record<string, string>>({});
  const plateConfidenceByTargetRef = useRef<Record<string, number>>({});
  const plateMemoryRef = useRef<Record<string, PlateMemory>>({});
  const targetEstimateHistoryRef = useRef<Record<string, TargetEstimateHistory>>({});
  const lockedTargetRef = useRef<HudTarget | null>(null);
  const lockedTargetMissesRef = useRef(0);
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
    const lock = target.lockState === "locked" ? "LOCK" : "VEH";
    const plate = target.plateText && (target.plateConfidence ?? 0) >= 90 ? ` ${target.plateText}` : "";
    const speed = target.estimatedSpeedMetresPerSecond !== null ? ` ${Math.max(0, target.estimatedSpeedMetresPerSecond * 3.6).toFixed(0)}KMH` : "";
    return `${lock}${plate}${speed}`;
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
  }, [buildHudLabel]);

  const estimateTargetMotion = useCallback(
    (targetId: string, bboxWidthPixels: number, videoWidth: number, label: string): Pick<HudTarget, "estimatedDistanceMetres" | "estimatedCarLengthsAhead" | "estimatedSpeedMetresPerSecond" | "relativeSpeedMetresPerSecond"> => {
      const assumedWidthMetres = label === "motorcycle" ? 0.85 : label === "bus" || label === "truck" ? 2.45 : 1.85;
      const assumedLengthMetres = label === "motorcycle" ? 2.2 : label === "bus" || label === "truck" ? 8.5 : 4.5;
      const horizontalFovDegrees = 60;
      const focalLengthPixels = videoWidth / (2 * Math.tan((horizontalFovDegrees * Math.PI) / 360));
      const estimatedDistanceMetres = bboxWidthPixels > 4 ? (assumedWidthMetres * focalLengthPixels) / bboxWidthPixels : null;
      if (estimatedDistanceMetres === null || !Number.isFinite(estimatedDistanceMetres)) {
        return {
          estimatedDistanceMetres: null,
          estimatedCarLengthsAhead: null,
          estimatedSpeedMetresPerSecond: null,
          relativeSpeedMetresPerSecond: null
        };
      }

      const now = Date.now();
      const previous = targetEstimateHistoryRef.current[targetId];
      const ownSpeed = getOwnSpeedMetresPerSecond() ?? 0;
      let relativeSpeedMetresPerSecond: number | null = null;
      let estimatedSpeedMetresPerSecond: number | null = null;
      if (previous) {
        const seconds = Math.max(0.25, (now - previous.timestamp) / 1000);
        relativeSpeedMetresPerSecond = (estimatedDistanceMetres - previous.distanceMetres) / seconds;
        estimatedSpeedMetresPerSecond = clamp(ownSpeed + relativeSpeedMetresPerSecond, 0, 80);
      }
      targetEstimateHistoryRef.current[targetId] = { distanceMetres: estimatedDistanceMetres, timestamp: now };

      return {
        estimatedDistanceMetres,
        estimatedCarLengthsAhead: estimatedDistanceMetres / assumedLengthMetres,
        estimatedSpeedMetresPerSecond,
        relativeSpeedMetresPerSecond
      };
    },
    [getOwnSpeedMetresPerSecond]
  );

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
        plateTextByTargetRef.current[target.id] = plateResult.text;
        plateConfidenceByTargetRef.current[target.id] = plateResult.confidence;
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
        await import("@tensorflow/tfjs");
        const coco = await import("@tensorflow-models/coco-ssd");
        detectorRef.current = (await coco.load()) as VehicleDetector;
        detectorStatusRef.current = "ready";
      } catch {
        detectorStatusRef.current = "unsupported";
        setError("HUD vehicle detection could not load on this device. Video recording can still continue.");
        return;
      }
    }
    if (detectorStatusRef.current !== "ready" || !detectorRef.current) return;

    detectionTimerRef.current = window.setInterval(() => {
      detectorRef.current
        ?.detect(video)
        .then((predictions) => {
          const videoWidth = video.videoWidth || 1;
          const videoHeight = video.videoHeight || 1;
          prunePlateMemory(plateMemoryRef.current);
          const vehiclePredictions = predictions.filter((prediction) => ["car", "truck", "bus", "motorcycle"].includes(prediction.class));
          const confidenceThreshold = getHudConfidenceThreshold(vehiclePredictions.map((prediction) => prediction.score), hudSensitivityOptionsRef.current);
          const candidates = vehiclePredictions
            .filter((prediction) => prediction.score >= confidenceThreshold)
            .map((prediction, index) => {
              const [x, y, width, height] = prediction.bbox;
              const centerX = x + width / 2;
              const centerOffset = Math.abs(centerX / videoWidth - 0.5);
              const area = (width * height) / (videoWidth * videoHeight);
              const frontScore = prediction.score * 1.8 + area * 3 - centerOffset * 1.4;
              const targetId = `candidate-${index}`;
              const cachedPlate = plateTextByTargetRef.current[targetId] ?? null;
              const memory = cachedPlate ? plateMemoryRef.current[cachedPlate] : undefined;
              return {
                id: targetId,
                label: prediction.class,
                confidence: prediction.score,
                x: x / videoWidth,
                y: y / videoHeight,
                width: width / videoWidth,
                height: height / videoHeight,
                lockState: "candidate",
                plateText: cachedPlate,
                plateConfidence: memory?.confidence ?? plateConfidenceByTargetRef.current[targetId] ?? null,
                frontScore,
                ...estimateTargetMotion(targetId, width, videoWidth, prediction.class)
              } satisfies HudTarget & { frontScore: number };
            })
            .sort((a, b) => b.frontScore - a.frontScore);
          const locked = chooseLockedTarget(candidates, lockedTargetRef.current);
          if (locked) {
            const lockedPlate = plateTextByTargetRef.current.locked;
            const lockedPlateConfidence = plateConfidenceByTargetRef.current.locked ?? null;
            const lockedWithPlate =
              lockedPlate && (lockedPlateConfidence ?? 0) >= 90
                ? { ...locked, plateText: lockedPlate, plateConfidence: lockedPlateConfidence }
                : locked;
            lockedTargetRef.current = lockedWithPlate;
            lockedTargetMissesRef.current = 0;
            if (lockedWithPlate.plateText) {
              plateTextByTargetRef.current.locked = lockedWithPlate.plateText;
              if (lockedWithPlate.plateConfidence !== null) plateConfidenceByTargetRef.current.locked = lockedWithPlate.plateConfidence;
            }
          } else if (lockedTargetRef.current && lockedTargetMissesRef.current < 4) {
            lockedTargetMissesRef.current += 1;
          } else {
            lockedTargetRef.current = null;
            lockedTargetMissesRef.current = 0;
          }
          const vehicles = lockedTargetRef.current
            ? [lockedTargetRef.current as TrackableHudTarget, ...candidates.filter((candidate) => trackingScore(candidate, lockedTargetRef.current as HudTarget) < 0.34).slice(0, 2)]
            : candidates.slice(0, 3);
          hudTargetsRef.current = vehicles.map((target) => stripFrontScore(target));
          if (hudTargetsRef.current.length) hudFramesRef.current.push({ timestamp: Date.now(), targets: hudTargetsRef.current });
          setHudTargets(hudTargetsRef.current);
        })
        .catch(() => undefined);
    }, 650);
    if (plateOcrEnabled) startPlateOcr(video);
  }, [estimateTargetMotion, startPlateOcr]);

  const startCompositeRecording = useCallback(
    async (mediaStream: MediaStream, plateOcrEnabled: boolean) => {
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = mediaStream;
      await video.play();

      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas recording is not available in this browser.");

      const draw = () => {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        drawHud(ctx, hudTargetsRef.current, canvas.width, canvas.height);
        animationFrameRef.current = window.requestAnimationFrame(draw);
      };
      draw();
      await startHudDetection(video, plateOcrEnabled);

      const canvasStream = canvas.captureStream(30);
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
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
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
    if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current);
    if (detectionTimerRef.current !== null) window.clearInterval(detectionTimerRef.current);
    if (ocrTimerRef.current !== null) window.clearInterval(ocrTimerRef.current);
    animationFrameRef.current = null;
    detectionTimerRef.current = null;
    ocrTimerRef.current = null;
    ocrBusyRef.current = false;
    setHudTargets([]);
    hudTargetsRef.current = [];
    plateTextByTargetRef.current = {};
    plateConfidenceByTargetRef.current = {};
    targetEstimateHistoryRef.current = {};
    lockedTargetRef.current = null;
    lockedTargetMissesRef.current = 0;
    const recorder = recorderRef.current;
    const stopped = new Promise<Blob | null>((resolve) => {
      if (!recorder || recorder.state === "inactive") {
        resolve(chunksRef.current.length ? new Blob(chunksRef.current, { type: mimeTypeRef.current }) : null);
        return;
      }
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        window.setTimeout(() => {
          resolve(chunksRef.current.length ? new Blob(chunksRef.current, { type: recorder.mimeType || mimeTypeRef.current }) : null);
        }, 80);
      };
      if (typeof recorder.requestData === "function") recorder.requestData();
      recorder.stop();
    });
    stream?.getTracks().forEach((track) => track.stop());
    compositeStreamRef.current?.getTracks().forEach((track) => track.stop());
    compositeStreamRef.current = null;
    setStream(null);
    return stopped;
  }, [stream]);

  return { stream, hudTargets, hudFramesRef, recordingSupported, error, start, stop };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

type TrackableHudTarget = HudTarget & { frontScore: number };

function chooseLockedTarget(candidates: TrackableHudTarget[], previous: HudTarget | null): TrackableHudTarget | null {
  if (!candidates.length) return null;
  const matchingPrevious = previous
    ? candidates
        .map((candidate) => ({ candidate, score: trackingScore(candidate, previous) }))
        .filter((match) => match.score > 0.34)
        .sort((a, b) => b.score - a.score)[0]?.candidate
    : null;
  const chosen = matchingPrevious ?? candidates[0];
  const smoothed = previous && matchingPrevious ? smoothTarget(matchingPrevious, previous) : chosen;
  return {
    ...smoothed,
    id: "locked",
    lockState: "locked",
    plateText: previous?.plateText && (previous.plateConfidence ?? 0) >= 90 ? previous.plateText : smoothed.plateText,
    plateConfidence: previous?.plateText && (previous.plateConfidence ?? 0) >= 90 ? previous.plateConfidence : smoothed.plateConfidence,
    frontScore: chosen.frontScore
  };
}

function trackingScore(candidate: HudTarget, previous: HudTarget): number {
  const candidateCenterX = candidate.x + candidate.width / 2;
  const candidateCenterY = candidate.y + candidate.height / 2;
  const previousCenterX = previous.x + previous.width / 2;
  const previousCenterY = previous.y + previous.height / 2;
  const centerDistance = Math.hypot(candidateCenterX - previousCenterX, candidateCenterY - previousCenterY);
  return boxIoU(candidate, previous) * 0.75 + Math.max(0, 1 - centerDistance * 3) * 0.25;
}

function smoothTarget(candidate: TrackableHudTarget, previous: HudTarget): TrackableHudTarget {
  const alpha = 0.38;
  return {
    ...candidate,
    x: lerp(previous.x, candidate.x, alpha),
    y: lerp(previous.y, candidate.y, alpha),
    width: lerp(previous.width, candidate.width, alpha),
    height: lerp(previous.height, candidate.height, alpha),
    estimatedDistanceMetres: smoothNullable(previous.estimatedDistanceMetres, candidate.estimatedDistanceMetres, alpha),
    estimatedCarLengthsAhead: smoothNullable(previous.estimatedCarLengthsAhead, candidate.estimatedCarLengthsAhead, alpha),
    estimatedSpeedMetresPerSecond: smoothNullable(previous.estimatedSpeedMetresPerSecond, candidate.estimatedSpeedMetresPerSecond, alpha),
    relativeSpeedMetresPerSecond: smoothNullable(previous.relativeSpeedMetresPerSecond, candidate.relativeSpeedMetresPerSecond, alpha)
  };
}

function stripFrontScore(target: TrackableHudTarget): HudTarget {
  const { frontScore: _frontScore, ...hudTarget } = target;
  return hudTarget;
}

function boxIoU(a: HudTarget, b: HudTarget): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * alpha;
}

function smoothNullable(from: number | null, to: number | null, alpha: number): number | null {
  if (from === null) return to;
  if (to === null) return from;
  return lerp(from, to, alpha);
}

function prunePlateMemory(memory: Record<string, PlateMemory>): void {
  const now = Date.now();
  Object.entries(memory).forEach(([plate, entry]) => {
    if (entry.expiresAt < now) delete memory[plate];
  });
}

function getHudConfidenceThreshold(scores: number[], options: { auto: boolean; sensitivity: number }): number {
  if (!options.auto) {
    return clamp(0.84 - options.sensitivity * 0.0042, 0.42, 0.84);
  }
  if (!scores.length) return 0.48;
  const sorted = [...scores].sort((a, b) => b - a);
  const best = sorted[0];
  const second = sorted[1] ?? 0;
  const crowdedPenalty = sorted.length > 4 ? 0.06 : sorted.length > 2 ? 0.03 : 0;
  const separationBonus = Math.max(0, best - second) * 0.25;
  return clamp(best * 0.72 + crowdedPenalty - separationBonus, 0.46, 0.78);
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
