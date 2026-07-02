"use client";

import { useEffect, useRef } from "react";

export function LiveVideoPreview({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);

  return (
    <div className="aspect-[9/16] max-h-[58vh] overflow-hidden rounded-lg border border-cockpit-line bg-black">
      {stream ? (
        <video ref={ref} autoPlay muted playsInline className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-500">Camera preview will appear after permission is granted.</div>
      )}
    </div>
  );
}
