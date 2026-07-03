"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { EVIDENCE_WARNING } from "@/lib/drive-utils";
import { getLastSession, getVideoBlob } from "@/lib/storage";
import type { DriveSession, PermissionStatusInfo } from "@/types/drive";
import { PermissionStatusCard } from "./PermissionStatusCard";
import { StartDriveButton } from "./StartDriveButton";

export function HomeDashboard() {
  const [lastSession, setLastSession] = useState<DriveSession | null>(null);
  const [lastVideoUrl, setLastVideoUrl] = useState<string | null>(null);
  const [storageOk, setStorageOk] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let currentUrl: string | null = null;
    setStorageOk(typeof indexedDB !== "undefined");
    getLastSession()
      .then(async (session) => {
        setLastSession(session);
        if (session?.videoBlobId) {
          const blob = await getVideoBlob(session.videoBlobId);
          if (blob) {
            currentUrl = URL.createObjectURL(blob);
            setLastVideoUrl(currentUrl);
          }
        }
      })
      .catch(() => setLastSession(null));
    setDismissed(window.localStorage.getItem("black-box-v4-disclaimer") === "accepted");
    return () => {
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, []);

  const statuses = useMemo<PermissionStatusInfo[]>(
    () => [
      {
        label: "Camera",
        state: typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function" ? "available" : "unsupported",
        detail: "Rear-facing camera requested when you start a drive."
      },
      {
        label: "Location",
        state: typeof navigator !== "undefined" && navigator.geolocation ? "available" : "unsupported",
        detail: "GPS samples and speed estimates are recorded while active."
      },
      {
        label: "Motion",
        state: typeof DeviceMotionEvent !== "undefined" ? "available" : "unsupported",
        detail: "iPhone Safari asks for motion permission after a user tap."
      },
      {
        label: "Local Storage",
        state: storageOk ? "available" : "unsupported",
        detail: "IndexedDB stores only the latest drive session unless protected."
      }
    ],
    [storageOk]
  );

  return (
    <div className="space-y-6">
      {!dismissed ? (
        <section className="rounded-lg border border-signal-amber/40 bg-signal-amber/10 p-4 text-signal-amber">
          <p className="text-sm leading-6">{EVIDENCE_WARNING}</p>
          <button
            className="mt-3 rounded-md bg-signal-amber px-3 py-2 text-sm font-black text-cockpit-950"
            onClick={() => {
              window.localStorage.setItem("black-box-v4-disclaimer", "accepted");
              setDismissed(true);
            }}
          >
            Acknowledge
          </button>
        </section>
      ) : null}

      <section className="space-y-3">
        <p className="max-w-2xl text-lg leading-7 text-slate-300">
          A car-mounted phone recorder for road-facing video, GPS, speed, timestamps, motion samples, and possible high-impact markers.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <StartDriveButton />
          {lastSession ? (
            <Link className="touch-target flex items-center justify-center rounded-lg border border-cockpit-line bg-cockpit-900 px-5 py-4 font-bold" href="/review">
              Review Last Drive
            </Link>
          ) : null}
          <Link className="touch-target flex items-center justify-center rounded-lg border border-cockpit-line bg-cockpit-900 px-5 py-4 font-bold" href="/settings">
            Settings
          </Link>
        </div>
      </section>

      {lastSession && lastVideoUrl ? (
        <section className="rounded-lg border border-cockpit-line bg-cockpit-900 p-4 shadow-glow">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-black">Most Recent Save</h2>
              <p className="text-xs text-slate-500">{new Date(lastSession.startedAt).toLocaleString()}</p>
            </div>
            <Link className="rounded-md bg-cockpit-800 px-3 py-2 text-sm font-bold" href="/review">
              Open Review
            </Link>
          </div>
          <video className="max-h-64 w-full rounded-md border border-cockpit-line bg-black" src={lastVideoUrl} controls playsInline preload="metadata" />
        </section>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2">
        {statuses.map((item) => (
          <PermissionStatusCard key={item.label} item={item} />
        ))}
      </section>
    </div>
  );
}
