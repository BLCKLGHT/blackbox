import { formatDuration, metresPerSecondToKmh } from "@/lib/drive-utils";
import type { DriveSession } from "@/types/drive";

export function SessionSummaryCard({ session }: { session: DriveSession }) {
  return (
    <section className="rounded-lg border border-cockpit-line bg-cockpit-900 p-4 shadow-glow">
      <h2 className="text-lg font-black">Drive Summary</h2>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-slate-500">Started</dt>
          <dd>{new Date(session.startedAt).toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Duration</dt>
          <dd>{formatDuration(session.durationSeconds)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Max speed</dt>
          <dd>{metresPerSecondToKmh(session.summary.maxSpeedMetresPerSecond).toFixed(1)} km/h</dd>
        </div>
        <div>
          <dt className="text-slate-500">Avg speed</dt>
          <dd>{metresPerSecondToKmh(session.summary.averageSpeedMetresPerSecond).toFixed(1)} km/h</dd>
        </div>
        <div>
          <dt className="text-slate-500">GPS samples</dt>
          <dd>{session.summary.gpsSampleCount}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Motion samples</dt>
          <dd>{session.summary.motionSampleCount}</dd>
        </div>
      </dl>
    </section>
  );
}
