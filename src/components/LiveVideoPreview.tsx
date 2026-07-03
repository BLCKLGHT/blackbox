"use client";

import { useEffect, useRef } from "react";
import type { HudTarget } from "@/types/drive";

export function LiveVideoPreview({
  stream,
  prominent = false,
  compact = false,
  hudTargets = []
}: {
  stream: MediaStream | null;
  prominent?: boolean;
  compact?: boolean;
  hudTargets?: HudTarget[];
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);

  return (
    <div
      className={`relative overflow-hidden rounded-lg border border-cockpit-line bg-black ${
        compact ? "h-36" : prominent ? "min-h-[420px] lg:min-h-[720px]" : "aspect-[9/16] max-h-[58vh]"
      }`}
    >
      <div className="absolute left-3 top-3 z-10 rounded-full border border-signal-red/60 bg-black/70 px-3 py-1 text-xs font-black uppercase tracking-wide text-signal-red">
        REC Camera
      </div>
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
    </div>
  );
}
