"use client";

import { useCallback, useRef, useState } from "react";
import { getVideoConstraints } from "@/lib/settings";
import type { CameraLens, HudTarget, VideoQuality } from "@/types/drive";

type VideoRecorderStartOptions = {
  cameraLens: CameraLens;
  hudEnabled: boolean;
};

type VehicleDetector = {
  detect: (input: HTMLVideoElement) => Promise<Array<{ bbox: [number, number, number, number]; class: string; score: number }>>;
};

export function useVideoRecorder(quality: VideoQuality, audio: boolean) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [recordingSupported, setRecordingSupported] = useState(true);
  const [hudTargets, setHudTargets] = useState<HudTarget[]>([]);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const mimeTypeRef = useRef("video/webm");
  const animationFrameRef = useRef<number | null>(null);
  const detectionTimerRef = useRef<number | null>(null);
  const detectorRef = useRef<VehicleDetector | null>(null);
  const hudTargetsRef = useRef<HudTarget[]>([]);
  const compositeStreamRef = useRef<MediaStream | null>(null);
  const detectorStatusRef = useRef<"idle" | "loading" | "ready" | "unsupported">("idle");

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
      const label = `${target.lockState === "locked" ? "LOCK" : "VEH"} ${Math.round(target.confidence * 100)}%${target.plateText ? ` ${target.plateText}` : ""}`;
      const labelWidth = ctx.measureText(label).width + 14;
      ctx.fillRect(x, Math.max(0, y - 28), labelWidth, 26);
      ctx.fillStyle = "#050607";
      ctx.fillText(label, x + 7, Math.max(18, y - 9));
    });
    ctx.restore();
  }, []);

  const startHudDetection = useCallback(async (video: HTMLVideoElement) => {
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
                plateText: null
              } satisfies HudTarget;
            })
            .sort((a, b) => b.width * b.height - a.width * a.height)
            .slice(0, 5);
          hudTargetsRef.current = vehicles.map((target, index) => ({ ...target, lockState: index === 0 && target.lockState === "locked" ? "locked" : "candidate" }));
          setHudTargets(hudTargetsRef.current);
        })
        .catch(() => undefined);
    }, 650);
  }, []);

  const startCompositeRecording = useCallback(
    async (mediaStream: MediaStream) => {
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
      await startHudDetection(video);

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

      const recordingStream = options.hudEnabled ? await startCompositeRecording(mediaStream) : mediaStream;
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
    animationFrameRef.current = null;
    detectionTimerRef.current = null;
    setHudTargets([]);
    hudTargetsRef.current = [];
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
