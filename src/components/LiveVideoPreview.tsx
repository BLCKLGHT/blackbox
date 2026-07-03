"use client";

import { useEffect, useMemo, useRef } from "react";
import { metresPerSecondToKmh } from "@/lib/drive-utils";
import type { GpsSample, HudTarget, WeatherInfo } from "@/types/drive";

export function LiveVideoPreview({
  stream,
  prominent = false,
  compact = false,
  hudTargets = [],
  latestGps = null,
  weather = null
}: {
  stream: MediaStream | null;
  prominent?: boolean;
  compact?: boolean;
  hudTargets?: HudTarget[];
  latestGps?: GpsSample | null;
  weather?: WeatherInfo | null;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const locked = useMemo(() => hudTargets.find((target) => target.lockState === "locked") ?? null, [hudTargets]);

  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);

  async function enterFullscreen() {
    const element = wrapperRef.current;
    if (!element) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    await element.requestFullscreen?.();
  }

  return (
    <div
      ref={wrapperRef}
      className={`relative overflow-hidden rounded-lg border border-cockpit-line bg-black ${
        compact ? "h-36" : prominent ? "min-h-[420px] lg:min-h-[720px]" : "aspect-[9/16] max-h-[58vh]"
      }`}
    >
      <div className="absolute left-3 top-3 z-10 rounded-full border border-signal-red/60 bg-black/70 px-3 py-1 text-xs font-black uppercase tracking-wide text-signal-red">
        REC Camera
      </div>
      <button className="absolute right-3 top-3 z-20 rounded-md border border-signal-blue/70 bg-black/70 px-3 py-1 text-xs font-black uppercase tracking-wide text-signal-blue" onClick={() => void enterFullscreen()}>
        Full Screen
      </button>
      {stream ? (
        <video ref={ref} autoPlay muted playsInline className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-500">Camera preview will appear after permission is granted.</div>
      )}
      {hudTargets.length ? (
        <div className="pointer-events-none absolute inset-0">
          {hudTargets.map((target) => (
            <div
              key={target.id}
              className={`absolute border-2 ${target.lockState === "locked" ? "border-signal-green text-signal-green" : "border-signal-amber text-signal-amber"}`}
              style={{
                left: `${target.x * 100}%`,
                top: `${target.y * 100}%`,
                width: `${target.width * 100}%`,
                height: `${target.height * 100}%`
              }}
            >
              <span className={`absolute -bottom-7 left-0 whitespace-nowrap rounded-sm px-2 py-1 text-[10px] font-black uppercase ${target.lockState === "locked" ? "bg-signal-green text-cockpit-950" : "bg-signal-amber text-cockpit-950"}`}>
                {target.lockState === "locked" ? "LOCK" : "VEH"}
                {target.plateText && (target.plateConfidence ?? 0) >= 90 ? ` ${target.plateText}` : ""}
                {target.estimatedSpeedMetresPerSecond !== null ? ` ${(target.estimatedSpeedMetresPerSecond * 3.6).toFixed(0)}KMH` : ""}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="pointer-events-none absolute bottom-3 left-3 z-10 max-w-[78%] rounded-md border border-signal-green/40 bg-black/70 p-2 font-mono text-[11px] font-bold uppercase leading-5 text-signal-green sm:text-xs">
        <div>{metresPerSecondToKmh(latestGps?.speedMetresPerSecond).toFixed(0)} KMH</div>
        <div>{new Date().toLocaleTimeString()}</div>
        <div>{latestGps ? `${latestGps.latitude.toFixed(5)}, ${latestGps.longitude.toFixed(5)}` : "GPS --"}</div>
        <div>{weather ? `${weather.temperatureCelsius?.toFixed(0) ?? "--"}C ${weather.summary}` : "WX --"}</div>
        <div>{locked?.estimatedCarLengthsAhead !== null && locked?.estimatedCarLengthsAhead !== undefined ? `${locked.estimatedCarLengthsAhead.toFixed(1)} CAR LENGTHS` : "NO TARGET"}</div>
      </div>
    </div>
  );
}
