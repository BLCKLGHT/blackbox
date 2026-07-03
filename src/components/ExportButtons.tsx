"use client";

import { useEffect, useState } from "react";
import { buildTextSummary, exportSessionCsv, exportSessionJson, getVideoBlob } from "@/lib/storage";
import { downloadBlob } from "@/lib/drive-utils";
import type { DriveSession } from "@/types/drive";

export function ExportButtons({ session }: { session: DriveSession }) {
  const base = `black-box-${session.id}`;
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoType, setVideoType] = useState("");

  useEffect(() => {
    let currentUrl: string | null = null;
    if (!session.videoBlobId) {
      setVideoUrl(null);
      setVideoType("");
      return undefined;
    }
    getVideoBlob(session.videoBlobId).then((blob) => {
      if (!blob) return;
      currentUrl = URL.createObjectURL(blob);
      setVideoUrl(currentUrl);
      setVideoType(blob.type);
    });
    return () => {
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [session.videoBlobId]);

  const videoExtension = videoType.includes("mp4") ? "mp4" : "webm";

  return (
    <section className="rounded-lg border border-cockpit-line bg-cockpit-900 p-4">
      <h2 className="font-black">Export Evidence</h2>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <button className="touch-target rounded-md bg-cockpit-800 px-3 py-2" onClick={() => downloadBlob(exportSessionJson(session), `${base}.json`)}>
          JSON
        </button>
        <button className="touch-target rounded-md bg-cockpit-800 px-3 py-2" onClick={() => downloadBlob(exportSessionCsv(session, "gps"), `${base}-gps.csv`)}>
          GPS CSV
        </button>
        <button className="touch-target rounded-md bg-cockpit-800 px-3 py-2" onClick={() => downloadBlob(exportSessionCsv(session, "motion"), `${base}-motion.csv`)}>
          Motion CSV
        </button>
        <button className="touch-target rounded-md bg-cockpit-800 px-3 py-2" onClick={() => downloadBlob(buildTextSummary(session), `${base}-summary.txt`)}>
          Summary
        </button>
        {videoUrl ? (
          <a className="touch-target col-span-2 rounded-md bg-signal-blue px-3 py-2 text-center font-bold text-cockpit-950" href={videoUrl} download={`${base}-video.${videoExtension}`} target="_blank">
            Save / Open Video
          </a>
        ) : (
          <button className="touch-target col-span-2 rounded-md bg-cockpit-800 px-3 py-2 text-slate-500" disabled>
            No Video Saved
          </button>
        )}
      </div>
    </section>
  );
}
