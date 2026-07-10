"use client";

import { useEffect, useState } from "react";
import { buildTextSummary, exportSessionCsv, exportSessionJson, getVideoBlob } from "@/lib/storage";
import { downloadBlob } from "@/lib/drive-utils";
import { burnHudTelemetryIntoVideo } from "@/lib/hud-video-export";
import type { DriveSession } from "@/types/drive";

export function ExportButtons({ session }: { session: DriveSession }) {
  const base = `black-box-${session.id}`;
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoType, setVideoType] = useState("");
  const [markerClips, setMarkerClips] = useState<Array<{ id: string; url: string; type: string; timestamp: number }>>([]);
  const [hudExportProgress, setHudExportProgress] = useState<number | null>(null);
  const [hudExportError, setHudExportError] = useState<string | null>(null);

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

  useEffect(() => {
    let active = true;
    const urls: string[] = [];
    Promise.all(
      session.manualMarkers
        .filter((marker) => marker.clipVideoBlobId)
        .map(async (marker) => {
          const blob = marker.clipVideoBlobId ? await getVideoBlob(marker.clipVideoBlobId) : null;
          if (!blob) return null;
          const url = URL.createObjectURL(blob);
          urls.push(url);
          return { id: marker.id, url, type: blob.type, timestamp: marker.timestamp };
        })
    ).then((clips) => {
      if (active) setMarkerClips(clips.filter((clip): clip is { id: string; url: string; type: string; timestamp: number } => Boolean(clip)));
    });
    return () => {
      active = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [session.manualMarkers]);

  const videoExtension = videoType.includes("mp4") ? "mp4" : "webm";

  async function exportHudVideo() {
    if (!videoUrl || hudExportProgress !== null) return;
    setHudExportError(null);
    setHudExportProgress(0);
    try {
      const blob = await burnHudTelemetryIntoVideo({
        videoUrl,
        session,
        onProgress: setHudExportProgress
      });
      const extension = blob.type.includes("mp4") ? "mp4" : "webm";
      downloadBlob(blob, `${base}-hud-video.${extension}`);
    } catch (error) {
      setHudExportError(error instanceof Error ? error.message : "Could not generate HUD video.");
    } finally {
      setHudExportProgress(null);
    }
  }

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
          <>
            <a className="touch-target col-span-2 rounded-md bg-cockpit-800 px-3 py-2 text-center font-bold" href={videoUrl} download={`${base}-raw-video.${videoExtension}`} target="_blank">
              Save Raw Video
            </a>
            <button className="touch-target col-span-2 rounded-md bg-signal-blue px-3 py-2 text-center font-black text-cockpit-950 disabled:opacity-60" disabled={hudExportProgress !== null} onClick={() => void exportHudVideo()}>
              {hudExportProgress !== null ? `Generating HUD Video ${Math.round(hudExportProgress * 100)}%` : "Generate HUD Video"}
            </button>
          </>
        ) : (
          <button className="touch-target col-span-2 rounded-md bg-cockpit-800 px-3 py-2 text-slate-500" disabled>
            No Video Saved
          </button>
        )}
      </div>
      {hudExportError ? <p className="mt-3 rounded-md border border-signal-amber/40 bg-signal-amber/10 p-3 text-sm text-signal-amber">{hudExportError}</p> : null}
      {hudExportProgress !== null ? (
        <div className="mt-3 rounded-md border border-cockpit-line bg-cockpit-950 p-3">
          <div className="mb-2 flex justify-between text-xs font-bold uppercase tracking-wide text-slate-500">
            <span>Burning HUD telemetry</span>
            <span>{Math.round(hudExportProgress * 100)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-cockpit-800">
            <div className="h-full bg-signal-green transition-all" style={{ width: `${Math.round(hudExportProgress * 100)}%` }} />
          </div>
        </div>
      ) : null}
      {markerClips.length ? (
        <div className="mt-4 space-y-2">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Marked Event Clips</div>
          {markerClips.map((clip, index) => {
            const extension = clip.type.includes("mp4") ? "mp4" : "webm";
            return (
              <a key={clip.id} className="block rounded-md border border-signal-amber/40 bg-signal-amber/10 px-3 py-2 text-sm font-bold text-signal-amber" href={clip.url} download={`${base}-marked-event-${index + 1}.${extension}`} target="_blank">
                Save Marked Event {index + 1} - {new Date(clip.timestamp).toLocaleTimeString()}
              </a>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
