"use client";

import { useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { DriveControls } from "@/components/DriveControls";
import { ImpactRiskBadge } from "@/components/ImpactRiskBadge";
import { MotionGauge } from "@/components/MotionGauge";
import { RecordingCockpit } from "@/components/RecordingCockpit";
import { useDriveSession } from "@/hooks/useDriveSession";

export default function DrivePage() {
  const drive = useDriveSession();
  const [hasStarted, setHasStarted] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [condensed, setCondensed] = useState(false);

  const latestMagnitude = drive.currentMotion?.magnitude ?? 0;

  async function beginRecording() {
    setIsStarting(true);
    setHasStarted(true);
    await drive.start();
    setIsStarting(false);
  }

  return (
    <AppShell>
      <div className="space-y-4">
        <button
          className={`touch-target w-full rounded-lg border px-4 py-3 font-black ${condensed ? "border-signal-green bg-signal-green/10 text-signal-green" : "border-cockpit-line bg-cockpit-900 text-slate-200"}`}
          onClick={() => setCondensed((current) => !current)}
        >
          {condensed ? "Expand Dashboard" : "Condense Dashboard"}
        </button>
        {!hasStarted ? (
          <section className="rounded-lg border border-signal-blue/50 bg-cockpit-900 p-5 shadow-glow">
            <h1 className="text-2xl font-black">Ready to Record</h1>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Tap Begin Recording to request camera, location, motion, and gyro permissions. On iPhone this tap is required before recording can start.
            </p>
            <button
              className="touch-target mt-5 w-full rounded-lg bg-signal-blue px-5 py-4 text-lg font-black text-cockpit-950"
              disabled={isStarting}
              onClick={() => void beginRecording()}
            >
              {isStarting ? "Starting..." : "Begin Recording"}
            </button>
          </section>
        ) : null}
        <RecordingCockpit
          elapsed={drive.elapsed}
          gpsSamples={drive.gpsTrail}
          latestGps={drive.currentGps}
          latestMotion={drive.currentMotion}
          latestOrientation={drive.currentOrientation}
          stream={drive.stream}
          compact={condensed}
        />
        {drive.videoSupported ? null : (
          <p className="rounded-lg border border-signal-amber bg-signal-amber/10 p-3 text-sm text-signal-amber">
            Video recording is not supported in this browser. Sensor and GPS logging can still continue.
          </p>
        )}
        {drive.highImpactEvents.length ? (
          <p className="rounded-lg border border-signal-amber bg-signal-amber/10 p-3 text-sm font-bold text-signal-amber">
            Possible high-impact event detected. Save this drive?
          </p>
        ) : null}
        {drive.warnings.length ? (
          <div className="space-y-2">
            {[...new Set(drive.warnings)].map((warning) => (
              <p key={warning} className="rounded-lg border border-signal-amber/40 bg-signal-amber/10 p-3 text-sm text-signal-amber">
                {warning}
              </p>
            ))}
          </div>
        ) : null}
        <div className={condensed ? "grid grid-cols-2 gap-2" : "grid grid-cols-2 gap-3"}>
          <ImpactRiskBadge eventCount={drive.highImpactEvents.length} latestMagnitude={latestMagnitude} compact={condensed} />
          <MotionGauge magnitude={latestMagnitude} compact={condensed} />
        </div>
        <section className={`rounded-lg border border-cockpit-line bg-cockpit-900 text-sm text-slate-400 ${condensed ? "p-2" : "p-3"}`}>
          GPS accuracy: {drive.currentGps?.accuracy ? `${drive.currentGps.accuracy.toFixed(0)}m` : "Waiting for fix"}
        </section>
        {drive.isRecording ? (
          <DriveControls onMarkEvent={drive.markEvent} onStop={() => void drive.stop()} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {hasStarted ? (
              <button className="touch-target rounded-lg bg-signal-blue p-4 text-center font-black text-cockpit-950" disabled={isStarting} onClick={() => void beginRecording()}>
                {isStarting ? "Starting..." : "Try Begin Recording Again"}
              </button>
            ) : null}
            <Link href="/" className="touch-target block rounded-lg bg-cockpit-800 p-4 text-center font-bold">
              Back Home
            </Link>
          </div>
        )}
      </div>
    </AppShell>
  );
}
