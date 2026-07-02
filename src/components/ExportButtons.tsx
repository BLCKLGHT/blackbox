"use client";

import { buildTextSummary, exportSessionCsv, exportSessionJson, getVideoBlob } from "@/lib/storage";
import { downloadBlob } from "@/lib/drive-utils";
import type { DriveSession } from "@/types/drive";

export function ExportButtons({ session }: { session: DriveSession }) {
  const base = `black-box-${session.id}`;
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
        <button
          className="touch-target col-span-2 rounded-md bg-signal-blue px-3 py-2 font-bold text-cockpit-950"
          onClick={async () => {
            if (!session.videoBlobId) return;
            const blob = await getVideoBlob(session.videoBlobId);
            if (blob) downloadBlob(blob, `${base}-video.webm`);
          }}
          disabled={!session.videoBlobId}
        >
          Download Video
        </button>
      </div>
    </section>
  );
}
