"use client";

import type { DriveSession, GpsSample, MotionSample, OrientationSample } from "@/types/drive";

const EXPORT_FRAME_RATE = 30;
const GRAPH_WINDOW_MS = 9000;
const MAX_GRAPH_ACCELERATION = 6;

type ExportInput = {
  videoUrl: string;
  session: DriveSession;
  onProgress?: (progress: number) => void;
};

type GraphSample = {
  timestamp: number;
  acceleration: number;
};

export async function burnHudTelemetryIntoVideo({ videoUrl, session, onProgress }: ExportInput): Promise<Blob> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = videoUrl;
  await waitForMetadata(video);

  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create export canvas.");

  const stream = canvas.captureStream(EXPORT_FRAME_RATE);
  const mimeType = getExportMimeType();
  const recorder = mimeType ? new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 }) : new MediaRecorder(stream, { videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  const graphSamples: GraphSample[] = [];

  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };

  await seekVideo(video, 0);
  const stopped = new Promise<Blob>((resolve, reject) => {
    recorder.onerror = () => reject(new Error("HUD video export failed."));
    recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || mimeType || "video/webm" }));
  });

  recorder.start(1000);
  await video.play();

  await new Promise<void>((resolve) => {
    let lastDrawAt = 0;
    const frameInterval = 1000 / EXPORT_FRAME_RATE;
    const draw = (now: number) => {
      if (video.ended || video.paused) {
        drawFrame(ctx, video, session, graphSamples);
        onProgress?.(1);
        resolve();
        return;
      }
      if (now - lastDrawAt >= frameInterval) {
        lastDrawAt = now;
        drawFrame(ctx, video, session, graphSamples);
        onProgress?.(video.duration > 0 ? Math.min(1, video.currentTime / video.duration) : 0);
      }
      window.requestAnimationFrame(draw);
    };
    window.requestAnimationFrame(draw);
  });

  recorder.stop();
  stream.getTracks().forEach((track) => track.stop());
  const blob = await stopped;
  video.removeAttribute("src");
  video.load();
  return blob;
}

function drawFrame(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, session: DriveSession, graphSamples: GraphSample[]): void {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  const timestamp = session.startedAt + Math.round(video.currentTime * 1000);
  const gps = nearest(session.gpsSamples, timestamp);
  const motion = nearest(session.motionSamples, timestamp);
  const orientation = nearest(session.orientationSamples, timestamp);
  const acceleration = calculateAcceleration(session.gpsSamples, timestamp) ?? motion?.accelerationX ?? null;

  ctx.drawImage(video, 0, 0, width, height);
  drawTelemetry(ctx, {
    timestamp,
    width,
    ownSpeedMetresPerSecond: gps?.speedMetresPerSecond ?? null,
    acceleration,
    motionForce: motion?.magnitude ?? null,
    latitude: gps?.latitude ?? null,
    longitude: gps?.longitude ?? null,
    pitch: orientation?.beta ?? null,
    roll: orientation?.gamma ?? null,
    heading: orientation?.alpha ?? gps?.heading ?? null,
    graphSamples
  });
}

function drawTelemetry(
  ctx: CanvasRenderingContext2D,
  input: {
    timestamp: number;
    width: number;
    ownSpeedMetresPerSecond: number | null;
    acceleration: number | null;
    motionForce: number | null;
    latitude: number | null;
    longitude: number | null;
    pitch: number | null;
    roll: number | null;
    heading: number | null;
    graphSamples: GraphSample[];
  }
): void {
  const acceleration = input.acceleration;
  const speed = input.ownSpeedMetresPerSecond !== null ? `${(input.ownSpeedMetresPerSecond * 3.6).toFixed(0)} KMH` : "-- KMH";
  const accel = acceleration !== null ? `ACCEL ${Math.max(0, acceleration).toFixed(1)} M/S2 / ${formatG(acceleration > 0 ? acceleration / 9.80665 : null)}` : "ACCEL --";
  const brake = acceleration !== null ? `BRAKE ${Math.max(0, -acceleration).toFixed(1)} M/S2 / ${formatG(acceleration < 0 ? Math.abs(acceleration) / 9.80665 : null)}` : "BRAKE --";
  const motion = input.motionForce !== null ? `MOTION ${input.motionForce.toFixed(1)} M/S2` : "MOTION --";
  const gyro = `GYRO P/R ${(input.pitch ?? 0).toFixed(0)} / ${(input.roll ?? 0).toFixed(0)}`;
  const heading = `HDG ${(input.heading ?? 0).toFixed(0).padStart(3, "0")}`;
  const coords = input.latitude !== null && input.longitude !== null ? `${input.latitude.toFixed(5)}, ${input.longitude.toFixed(5)}` : "GPS --";
  const lines = [speed, accel, brake, motion, gyro, heading, new Date(input.timestamp).toLocaleTimeString(), coords];

  if (acceleration !== null) {
    input.graphSamples.push({ timestamp: input.timestamp, acceleration });
    while (input.graphSamples.length && input.timestamp - input.graphSamples[0].timestamp > GRAPH_WINDOW_MS) input.graphSamples.shift();
  }

  ctx.save();
  ctx.font = `${Math.max(18, input.width * 0.018)}px monospace`;
  ctx.textBaseline = "top";
  const lineHeight = Math.max(24, input.width * 0.024);
  const boxWidth = Math.max(...lines.map((line) => ctx.measureText(line).width)) + 24;
  const graphHeight = Math.max(58, input.width * 0.052);
  ctx.fillStyle = "rgba(5, 6, 7, 0.68)";
  ctx.fillRect(14, 14, boxWidth, lineHeight * lines.length + graphHeight + 28);
  ctx.fillStyle = "#4ade80";
  lines.forEach((line, index) => ctx.fillText(line, 26, 22 + index * lineHeight));
  drawGraph(ctx, input.graphSamples, 26, 28 + lineHeight * lines.length, boxWidth - 24, graphHeight, input.timestamp);
  ctx.restore();
}

function drawGraph(ctx: CanvasRenderingContext2D, samples: GraphSample[], x: number, y: number, width: number, height: number, now: number): void {
  const midY = y + height / 2;
  ctx.save();
  ctx.fillStyle = "rgba(10, 15, 20, 0.34)";
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = "rgba(148, 163, 184, 0.32)";
  ctx.beginPath();
  ctx.moveTo(x, midY);
  ctx.lineTo(x + width, midY);
  ctx.stroke();
  if (samples.length >= 2) {
    ctx.strokeStyle = "#4ade80";
    ctx.lineWidth = 2;
    ctx.beginPath();
    samples.forEach((sample, index) => {
      const ageRatio = Math.min(1, Math.max(0, (now - sample.timestamp) / GRAPH_WINDOW_MS));
      const pointX = x + width * (1 - ageRatio);
      const pointY = midY - Math.min(1, Math.max(-1, sample.acceleration / MAX_GRAPH_ACCELERATION)) * (height / 2 - 7);
      if (index === 0) ctx.moveTo(pointX, pointY);
      else ctx.lineTo(pointX, pointY);
    });
    ctx.stroke();
  }
  ctx.restore();
}

function calculateAcceleration(samples: GpsSample[], timestamp: number): number | null {
  const previous = [...samples].reverse().find((sample) => sample.speedMetresPerSecond !== null && sample.timestamp <= timestamp);
  const next = samples.find((sample) => sample.speedMetresPerSecond !== null && sample.timestamp > timestamp);
  if (!previous || !next) return null;
  const seconds = (next.timestamp - previous.timestamp) / 1000;
  if (seconds < 0.35 || seconds > 4) return null;
  return ((next.speedMetresPerSecond ?? 0) - (previous.speedMetresPerSecond ?? 0)) / seconds;
}

function nearest<T extends GpsSample | MotionSample | OrientationSample>(samples: T[], timestamp: number): T | null {
  if (!samples.length) return null;
  let best = samples[0];
  let bestDelta = Math.abs(best.timestamp - timestamp);
  for (const sample of samples) {
    const delta = Math.abs(sample.timestamp - timestamp);
    if (delta < bestDelta) {
      best = sample;
      bestDelta = delta;
    }
  }
  return bestDelta <= 2500 ? best : null;
}

function formatG(value: number | null): string {
  return value !== null ? `${value.toFixed(2)}G` : "--G";
}

function getExportMimeType(): string {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return "";
  return ["video/mp4;codecs=h264", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
}

function waitForMetadata(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA && video.duration) return Promise.resolve();
  return new Promise((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("Saved video could not be loaded."));
    video.load();
  });
}

function seekVideo(video: HTMLVideoElement, seconds: number): Promise<void> {
  if (Math.abs(video.currentTime - seconds) < 0.01 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = () => {
      video.removeEventListener("seeked", finish);
      video.removeEventListener("error", fail);
      resolve();
    };
    const fail = () => {
      video.removeEventListener("seeked", finish);
      video.removeEventListener("error", fail);
      reject(new Error("Saved video seek failed."));
    };
    video.addEventListener("seeked", finish, { once: true });
    video.addEventListener("error", fail, { once: true });
    video.currentTime = seconds;
  });
}
