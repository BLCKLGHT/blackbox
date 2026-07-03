"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { EVIDENCE_WARNING, downloadBlob } from "@/lib/drive-utils";
import { deleteLastSession, getLastSession, getVideoBlob, protectSession } from "@/lib/storage";
import { loadSettings } from "@/lib/settings";
import type { DriveSession } from "@/types/drive";
import { MotionChart, SpeedChart } from "./Charts";
import { EventTimeline } from "./EventTimeline";
import { ExportButtons } from "./ExportButtons";
import { SessionSummaryCard } from "./SessionSummaryCard";

export function ReviewClient() {
  const [session, setSession] = useState<DriveSession | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoExtension, setVideoExtension] = useState("webm");

  useEffect(() => {
    let currentUrl: string | null = null;
    getLastSession().then(async (loaded) => {
      setSession(loaded);
      if (loaded?.videoBlobId) {
        const blob = await getVideoBlob(loaded.videoBlobId);
        if (blob) {
          currentUrl = URL.createObjectURL(blob);
          setVideoUrl(currentUrl);
          setVideoExtension(blob.type.includes("mp4") ? "mp4" : "webm");
        }
      }
    });
    return () => {
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, []);

  const contactLinks = useMemo(() => {
    if (!session) return null;
    const settings = loadSettings();
    const location = session.summary.lastKnownLocation ? `${session.summary.lastKnownLocation.latitude},${session.summary.lastKnownLocation.longitude}` : "unknown";
    const time = session.highImpactEvents[0] ? new Date(session.highImpactEvents[0].timestamp).toLocaleString() : new Date(session.startedAt).toLocaleString();
    const body = settings.alertMessageTemplate.replace("{time}", time).replace("{location}", location);
    return {
      sms: `sms:${encodeURIComponent(settings.emergencyContact.phone)}&body=${encodeURIComponent(body)}`,
      mailto: `mailto:${encodeURIComponent(settings.emergencyContact.email)}?subject=${encodeURIComponent("Black Box possible high-impact event")}&body=${encodeURIComponent(body)}`
    };
  }, [session]);

  if (!session) {
    return (
      <section className="rounded-lg border border-cockpit-line bg-cockpit-900 p-6 text-center">
        <h1 className="text-2xl font-black">No saved drive</h1>
        <p className="mt-2 text-slate-400">Start a drive to record the latest local evidence package.</p>
        <Link href="/drive" className="mt-5 inline-flex rounded-lg bg-signal-blue px-5 py-3 font-black text-cockpit-950">
          Start Drive
        </Link>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-cockpit-line bg-cockpit-900 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black">Last Drive</h1>
            <p className="mt-1 text-sm text-slate-400">
              {session.protected ? "Protected from auto-delete" : `Expires ${new Date(session.expiresAt).toLocaleString()}`}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              className="rounded-md bg-signal-green px-3 py-2 text-sm font-black text-cockpit-950"
              onClick={async () => {
                const protectedDrive = await protectSession();
                if (protectedDrive) setSession(protectedDrive);
              }}
            >
              Save Evidence
            </button>
            <button
              className="rounded-md border border-signal-red px-3 py-2 text-sm font-bold text-signal-red"
              onClick={async () => {
                if (window.confirm("Delete the saved drive and video from this device?")) {
                  await deleteLastSession();
                  setSession(null);
                }
              }}
            >
              Delete
            </button>
          </div>
        </div>
      </section>

      {session.highImpactEvents.length ? (
        <section className="rounded-lg border border-signal-amber/40 bg-signal-amber/10 p-4 text-signal-amber">
          <h2 className="font-black">Possible high-impact event detected. Save this drive?</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="rounded-md bg-signal-amber px-3 py-2 font-black text-cockpit-950" onClick={async () => setSession(await protectSession())}>
              Save Evidence
            </button>
            {contactLinks ? (
              <>
                <a className="rounded-md border border-signal-amber px-3 py-2 font-bold" href={contactLinks.sms}>
                  Prepare SMS
                </a>
                <a className="rounded-md border border-signal-amber px-3 py-2 font-bold" href={contactLinks.mailto}>
                  Prepare Email
                </a>
              </>
            ) : null}
          </div>
        </section>
      ) : null}

      {videoUrl ? (
        <section className="rounded-lg border border-cockpit-line bg-cockpit-900 p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="font-black">Watch Most Recent Save</h2>
            <a className="rounded-md bg-signal-blue px-3 py-2 text-sm font-black text-cockpit-950" href={videoUrl} download={`black-box-${session.id}-video.${videoExtension}`} target="_blank">
              Save Video
            </a>
          </div>
          <video className="w-full rounded-lg border border-cockpit-line bg-black" src={videoUrl} controls playsInline preload="metadata" />
        </section>
      ) : (
        <section className="rounded-lg border border-cockpit-line bg-cockpit-900 p-4 text-sm text-slate-400">No playable video was saved for this session.</section>
      )}

      <SessionSummaryCard session={session} />
      <SpeedChart samples={session.gpsSamples} />
      <MotionChart samples={session.motionSamples} />
      <EventTimeline impacts={session.highImpactEvents} markers={session.manualMarkers} />
      <LocationTrail session={session} />
      <ExportButtons session={session} />
      <p className="rounded-lg border border-cockpit-line bg-cockpit-900 p-4 text-sm text-slate-400">{EVIDENCE_WARNING}</p>
    </div>
  );
}

function LocationTrail({ session }: { session: DriveSession }) {
  const samples = session.gpsSamples.slice(-25);
  return (
    <section className="rounded-lg border border-cockpit-line bg-cockpit-900 p-4">
      <h2 className="font-black">Location Trail</h2>
      <div className="mt-3 max-h-72 overflow-auto text-sm">
        {samples.length ? (
          <table className="w-full text-left">
            <thead className="text-slate-500">
              <tr>
                <th className="py-2">Time</th>
                <th>Latitude</th>
                <th>Longitude</th>
                <th>Accuracy</th>
              </tr>
            </thead>
            <tbody>
              {samples.map((sample) => (
                <tr key={`${sample.timestamp}-${sample.latitude}`} className="border-t border-cockpit-line">
                  <td className="py-2">{new Date(sample.timestamp).toLocaleTimeString()}</td>
                  <td>{sample.latitude.toFixed(5)}</td>
                  <td>{sample.longitude.toFixed(5)}</td>
                  <td>{sample.accuracy ? `${sample.accuracy.toFixed(0)}m` : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-slate-500">No GPS samples recorded.</p>
        )}
      </div>
    </section>
  );
}
