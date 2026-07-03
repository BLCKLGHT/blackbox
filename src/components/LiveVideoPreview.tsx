"use client";

import { useEffect, useRef } from "react";

export function LiveVideoPreview({ stream, prominent = false, compact = false }: { stream: MediaStream | null; prominent?: boolean; compact?: boolean }) {
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
    </div>
  );
}
