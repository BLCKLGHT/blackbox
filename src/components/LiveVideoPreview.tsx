"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { metresPerSecondToKmh } from "@/lib/drive-utils";
import type { GpsSample, HudTarget, MotionSample, OrientationSample, WeatherInfo } from "@/types/drive";

export function LiveVideoPreview({
  stream,
  prominent = false,
  compact = false,
  hudTargets = [],
  latestGps = null,
  latestMotion = null,
  latestOrientation = null,
  weather = null
}: {
  stream: MediaStream | null;
  prominent?: boolean;
  compact?: boolean;
  hudTargets?: HudTarget[];
  latestGps?: GpsSample | null;
  latestMotion?: MotionSample | null;
  latestOrientation?: OrientationSample | null;
  weather?: WeatherInfo | null;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [immersiveFullscreen, setImmersiveFullscreen] = useState(false);
  const locked = useMemo(() => hudTargets.find((target) => target.lockState === "locked") ?? null, [hudTargets]);
  const pitch = latestOrientation?.beta ?? 0;
  const roll = latestOrientation?.gamma ?? 0;
  const heading = latestOrientation?.alpha ?? latestGps?.heading ?? 0;
  const motionForce = latestMotion?.magnitude ?? 0;

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
      <div className="pointer-events-none absolute inset-0">
        <div
          className={`absolute border-2 border-signal-green transition-all duration-300 ease-out ${
            locked ? (locked.displayState === "strong_lock" ? "opacity-100 shadow-[0_0_12px_rgba(74,222,128,0.65)]" : "opacity-60") : "opacity-25"
          }`}
          style={
            locked
              ? {
                  left: `${locked.x * 100}%`,
                  top: `${locked.y * 100}%`,
                  width: `${locked.width * 100}%`,
                  height: `${locked.height * 100}%`
                }
              : {
                  left: "41%",
                  top: "41%",
                  width: "18%",
                  height: "18%"
                }
          }
        >
          {locked ? (
            <span
              className={`absolute left-0 whitespace-nowrap rounded-sm bg-signal-green px-2 py-1 font-black uppercase text-cockpit-950 ${
                immersiveFullscreen ? "-bottom-8 text-xs" : "-bottom-7 text-[10px]"
              }`}
            >
              {formatVehicleSpeed(locked.estimatedVehicleSpeedKmh)}
              {locked.plateText && (locked.plateConfidence ?? 0) >= 90 ? `  ${locked.plateText}` : ""}
            </span>
          ) : null}
        </div>
      </div>
      <div
        className={`pointer-events-none absolute z-10 max-w-[82%] rounded-md border border-signal-green/40 bg-black/70 font-mono font-bold uppercase text-signal-green ${
          immersiveFullscreen
            ? "bottom-[calc(0.75rem+env(safe-area-inset-bottom))] left-[calc(0.75rem+env(safe-area-inset-left))] p-3 text-xs leading-6 sm:text-sm"
            : "bottom-3 left-3 p-2 text-[11px] leading-5 sm:text-xs"
        }`}
      >
        <div>{metresPerSecondToKmh(latestGps?.speedMetresPerSecond).toFixed(0)} KMH</div>
        <div>GYRO P/R {pitch.toFixed(0)} / {roll.toFixed(0)}</div>
        <div>HDG {heading.toFixed(0).padStart(3, "0")} / FORCE {motionForce.toFixed(1)}</div>
        <div>{new Date().toLocaleTimeString()}</div>
        <div>{latestGps ? `${latestGps.latitude.toFixed(5)}, ${latestGps.longitude.toFixed(5)}` : "GPS --"}</div>
        <div>{weather ? `${weather.temperatureCelsius?.toFixed(0) ?? "--"}C ${weather.summary}` : "WX --"}</div>
        <div>{locked?.estimatedCarLengthsAhead !== null && locked?.estimatedCarLengthsAhead !== undefined ? `${locked.estimatedCarLengthsAhead.toFixed(1)} CAR LENGTHS` : "NO TARGET"}</div>
        <div>{locked ? `${motionLabel(locked.relativeMotionEstimate)} / RISK ${(locked.closingRisk ?? "unknown").toUpperCase()}` : "REL MOTION --"}</div>
        <div>{locked ? `${lockLabel(locked.displayState)} / TC ${Math.round((locked.trackConfidence ?? 0) * 100)} / ${(locked.lockDurationMs / 1000).toFixed(1)}S` : "SEARCHING"}</div>
      </div>
    </div>
  );
}

function motionLabel(motion: HudTarget["relativeMotionEstimate"] | undefined): string {
  if (!motion) return "UNKNOWN";
  if (motion === "moving_away") return "MOVING AWAY";
  return motion.toUpperCase();
}

function lockLabel(state: HudTarget["displayState"] | undefined): string {
  if (state === "strong_lock") return "STRONG LOCK";
  if (state === "weak_lock") return "WEAK LOCK";
  if (state === "lost_target") return "LOST";
  if (state === "no_vehicle") return "NO VEHICLE";
  return "SEARCHING";
}

function formatVehicleSpeed(speedKmh: number | null | undefined): string {
  if (speedKmh === null || speedKmh === undefined || !Number.isFinite(speedKmh)) return "EST: -- KM/H";
  return `EST: ${Math.round(speedKmh)} KM/H`;
}
