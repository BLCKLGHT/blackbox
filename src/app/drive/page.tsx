"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { DriveControls } from "@/components/DriveControls";
import { ImpactRiskBadge } from "@/components/ImpactRiskBadge";
import { LiveVideoPreview } from "@/components/LiveVideoPreview";
import { MotionGauge } from "@/components/MotionGauge";
import { RecordingTimer } from "@/components/RecordingTimer";
import { SpeedDisplay } from "@/components/SpeedDisplay";
import { useDriveSession } from "@/hooks/useDriveSession";

export default function DrivePage() {
  const drive = useDriveSession();
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    drive.start().catch(console.error);
  }, []);

  const latestMagnitude = drive.currentMotion?.magnitude ?? 0;

  return (
    <AppShell>
      <div className="space-y-4">
        <LiveVideoPreview stream={drive.stream} />
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
        <div className="grid grid-cols-2 gap-3">
          <RecordingTimer seconds={drive.elapsed} />
          <ImpactRiskBadge eventCount={drive.highImpactEvents.length} latestMagnitude={latestMagnitude} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <SpeedDisplay speed={drive.currentGps?.speedMetresPerSecond} />
          <MotionGauge magnitude={latestMagnitude} />
        </div>
        <section className="rounded-lg border border-cockpit-line bg-cockpit-900 p-3 text-sm text-slate-400">
          GPS accuracy: {drive.currentGps?.accuracy ? `${drive.currentGps.accuracy.toFixed(0)}m` : "Waiting for fix"}
        </section>
        {drive.isRecording ? <DriveControls onMarkEvent={drive.markEvent} onStop={() => void drive.stop()} /> : <Link href="/" className="block rounded-lg bg-cockpit-800 p-4 text-center font-bold">Back Home</Link>}
      </div>
    </AppShell>
  );
}
