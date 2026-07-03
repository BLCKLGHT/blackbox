"use client";

import { useCallback, useRef, useState } from "react";
import { getVideoConstraints } from "@/lib/settings";
import type { CameraLens, HudTarget, VideoQuality } from "@/types/drive";

type VideoRecorderStartOptions = {
  cameraLens: CameraLens;
  hudEnabled: boolean;
  plateOcrEnabled: boolean;
};

type VehicleDetector = {
  detect: (input: HTMLVideoElement) => Promise<Array<{ bbox: [number, number, number, number]; class: string; score: number }>>;
};

type TargetEstimateHistory = {
  distanceMetres: number;
  timestamp: number;
};

export function useVideoRecorder(quality: VideoQuality, audio: boolean, getOwnSpeedMetresPerSecond: () => number | null) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [recordingSupported, setRecordingSupported] = useState(true);
  const [hudTargets, setHudTargets] = useState<HudTarget[]>([]);
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
  const targetEstimateHistoryRef = useRef<Record<string, TargetEstimateHistory>>({});
  const compositeStreamRef = useRef<MediaStream | null>(null);
  const detectorStatusRef = useRef<"idle" | "loading" | "ready" | "unsupported">("idle");
  const plateOcrStatusRef = useRef<"idle" | "ready" | "unsupported">("idle");

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
    const confidence = `${Math.round(target.confidence * 100)}%`;
    const plate = target.plateText ? ` ${target.plateText}` : "";
    const distance = target.estimatedCarLengthsAhead !== null ? ` ${target.estimatedCarLengthsAhead.toFixed(1)}CL` : "";
    const speed = target.estimatedSpeedMetresPerSecond !== null ? ` ${Math.max(0, target.estimatedSpeedMetresPerSecond * 3.6).toFixed(0)}KMH` : "";
    return `${lock} ${confidence}${plate}${distance}${speed}`;
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
      ctx.fillRect(x, Math.max(0, y - 28), labelWidth, 26);
      ctx.fillStyle = "#050607";
      ctx.fillText(label, x + 7, Math.max(18, y - 9));
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
      const plateText = cleanPlateText(result.data.text);
      if (plateText) plateTextByTargetRef.current[target.id] = plateText;
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
          const vehicles = predictions
            .filter((prediction) => ["car", "truck", "bus", "motorcycle"].includes(prediction.class) && prediction.score > 0.45)
            .map((prediction, index) => {
              const [x, y, width, height] = prediction.bbox;
              const centerX = x + width / 2;
              const centered = centerX > videoWidth * 0.28 && centerX < videoWidth * 0.72;
              return {
                id: `target-${index}`,
                label: prediction.class,
                confidence: prediction.score,
                x: x / videoWidth,
                y: y / videoHeight,
                width: width / videoWidth,
                height: height / videoHeight,
                lockState: centered && index === 0 ? "locked" : "candidate",
                plateText: plateTextByTargetRef.current[`target-${index}`] ?? null,
                ...estimateTargetMotion(`target-${index}`, width, videoWidth, prediction.class)
              } satisfies HudTarget;
            })
            .sort((a, b) => b.width * b.height - a.width * a.height)
            .slice(0, 5);
          hudTargetsRef.current = vehicles.map((target, index) => ({ ...target, lockState: index === 0 && target.lockState === "locked" ? "locked" : "candidate" }));
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
    targetEstimateHistoryRef.current = {};
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

  return { stream, hudTargets, recordingSupported, error, start, stop };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function cleanPlateText(rawText: string): string | null {
  const candidates = rawText
    .toUpperCase()
    .split(/\s+/)
    .map((part) => part.replace(/[^A-Z0-9]/g, ""))
    .filter((part) => part.length >= 3 && part.length <= 10 && /[A-Z]/.test(part) && /\d/.test(part));
  return candidates[0] ?? null;
}
