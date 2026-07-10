"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { metresPerSecondToKmh } from "@/lib/drive-utils";
import type { GpsSample, HudTarget, MotionSample, OrientationSample } from "@/types/drive";

export function LiveVideoPreview({
  stream,
  prominent = false,
  compact = false,
  hudTargets = [],
  gpsSamples = [],
  latestGps = null,
  locationLabel = null,
  latestMotion = null,
  latestOrientation = null
}: {
  stream: MediaStream | null;
  prominent?: boolean;
  compact?: boolean;
  hudTargets?: HudTarget[];
  gpsSamples?: GpsSample[];
  latestGps?: GpsSample | null;
  locationLabel?: string | null;
  latestMotion?: MotionSample | null;
  latestOrientation?: OrientationSample | null;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [immersiveFullscreen, setImmersiveFullscreen] = useState(false);
  const pitch = latestOrientation?.beta ?? 0;
  const roll = latestOrientation?.gamma ?? 0;
  const heading = latestOrientation?.alpha ?? latestGps?.heading ?? 0;
  const motionForce = latestMotion?.magnitude ?? 0;
  const acceleration = useMemo(() => calculateAcceleration(gpsSamples), [gpsSamples]);
  const graphSamples = useMemo(() => buildAccelerationGraph(gpsSamples), [gpsSamples]);

  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    if (!immersiveFullscreen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [immersiveFullscreen]);

  useEffect(() => {
    function onFullscreenChange() {
      if (!document.fullscreenElement) setImmersiveFullscreen(false);
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", onFullscreenChange);
    };
  }, []);

  async function toggleFullscreen() {
    const element = wrapperRef.current;
    if (!element) return;
    if (immersiveFullscreen || document.fullscreenElement) {
      if (document.fullscreenElement) await document.exitFullscreen();
      setImmersiveFullscreen(false);
      return;
    }
    try {
      if (element.requestFullscreen) await element.requestFullscreen();
      setImmersiveFullscreen(true);
    } catch {
      setImmersiveFullscreen(true);
    }
  }

  return (
    <div
      ref={wrapperRef}
      className={`relative overflow-hidden border border-cockpit-line bg-black ${
        immersiveFullscreen
          ? "fixed inset-0 z-[9999] h-[100dvh] rounded-none border-0"
          : `rounded-lg ${compact ? "h-36" : prominent ? "min-h-[420px] lg:min-h-[720px]" : "aspect-[9/16] max-h-[58vh]"}`
      }`}
    >
      <div className="absolute left-[calc(0.75rem+env(safe-area-inset-left))] top-[calc(0.75rem+env(safe-area-inset-top))] z-10 rounded-full border border-signal-red/60 bg-black/70 px-3 py-1 text-xs font-black uppercase tracking-wide text-signal-red">
        REC Camera
      </div>
      <button className="absolute right-[calc(0.75rem+env(safe-area-inset-right))] top-[calc(0.75rem+env(safe-area-inset-top))] z-20 rounded-md border border-signal-blue/70 bg-black/70 px-3 py-1 text-xs font-black uppercase tracking-wide text-signal-blue" type="button" onClick={() => void toggleFullscreen()}>
        {immersiveFullscreen ? "Exit" : "Full Screen"}
      </button>
      {stream ? (
        <video ref={ref} autoPlay muted playsInline className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-500">Camera preview will appear after permission is granted.</div>
      )}
      <div
        className={`pointer-events-none absolute z-10 max-w-[82%] rounded-md border border-signal-green/40 bg-black/70 font-mono font-bold uppercase text-signal-green ${
          immersiveFullscreen
            ? "bottom-[calc(0.75rem+env(safe-area-inset-bottom))] left-[calc(0.75rem+env(safe-area-inset-left))] p-3 text-xs leading-6 sm:text-sm"
            : "bottom-3 left-3 p-2 text-[11px] leading-5 sm:text-xs"
        }`}
      >
        <div>{metresPerSecondToKmh(latestGps?.speedMetresPerSecond).toFixed(0)} KMH</div>
        <div>ACCEL {acceleration !== null ? Math.max(0, acceleration).toFixed(1) : "--"} M/S2</div>
        <div>BRAKE {acceleration !== null ? Math.max(0, -acceleration).toFixed(1) : "--"} M/S2</div>
        <AccelerationMiniGraph samples={graphSamples} latest={acceleration} />
        <div>GYRO P/R {pitch.toFixed(0)} / {roll.toFixed(0)}</div>
        <div>HDG {heading.toFixed(0).padStart(3, "0")} / FORCE {motionForce.toFixed(1)}</div>
        <div>{new Date().toLocaleTimeString()}</div>
        <div>{latestGps ? `${latestGps.latitude.toFixed(5)}, ${latestGps.longitude.toFixed(5)}` : "GPS --"}</div>
        <div>{locationLabel ?? "ROAD --"}</div>
      </div>
    </div>
  );
}

function AccelerationMiniGraph({ samples, latest }: { samples: number[]; latest: number | null }) {
  const width = 112;
  const height = 34;
  const midY = height / 2;
  const maxAcceleration = 6;
  const points = samples
    .map((sample, index) => {
      const x = samples.length > 1 ? (index / (samples.length - 1)) * width : width;
      const y = midY - clamp(sample / maxAcceleration, -1, 1) * (height / 2 - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const markerY = midY - clamp((latest ?? 0) / maxAcceleration, -1, 1) * (height / 2 - 4);
  return (
    <svg className="my-1 block h-[34px] w-28 overflow-visible" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <rect width={width} height={height} fill="rgba(10,15,20,0.35)" />
      <line x1="0" y1={midY} x2={width} y2={midY} stroke="rgba(148,163,184,0.35)" strokeWidth="1" />
      {points ? <polyline points={points} fill="none" stroke="#4ade80" strokeWidth="2" /> : null}
      <circle cx={width - 4} cy={markerY} r="3" fill={(latest ?? 0) < -0.2 ? "#f59e0b" : "#4ade80"} />
    </svg>
  );
}

function buildAccelerationGraph(samples: GpsSample[]): number[] {
  const accelerations: number[] = [];
  const valid = samples.filter((sample) => sample.speedMetresPerSecond !== null).slice(-14);
  for (let index = 1; index < valid.length; index += 1) {
    const previous = valid[index - 1];
    const current = valid[index];
    const seconds = (current.timestamp - previous.timestamp) / 1000;
    if (seconds >= 0.35 && seconds <= 4) accelerations.push(((current.speedMetresPerSecond ?? 0) - (previous.speedMetresPerSecond ?? 0)) / seconds);
  }
  return accelerations;
}

function calculateAcceleration(samples: GpsSample[]): number | null {
  const graph = buildAccelerationGraph(samples);
  return graph.length ? graph[graph.length - 1] : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
