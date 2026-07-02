import { FlightGyroDisplay } from "@/components/FlightGyroDisplay";
import { LiveVideoPreview } from "@/components/LiveVideoPreview";
import { RecordingTimer } from "@/components/RecordingTimer";
import { RouteMap } from "@/components/RouteMap";
import { SpeedDisplay } from "@/components/SpeedDisplay";
import type { GpsSample, MotionSample, OrientationSample } from "@/types/drive";

export function RecordingCockpit({
  elapsed,
  gpsSamples,
  latestGps,
  latestMotion,
  latestOrientation,
  stream
}: {
  elapsed: number;
  gpsSamples: GpsSample[];
  latestGps: GpsSample | null;
  latestMotion: MotionSample | null;
  latestOrientation: OrientationSample | null;
  stream: MediaStream | null;
}) {
  return (
    <section className="space-y-3">
      <div className="rounded-lg border border-signal-red/50 bg-signal-red/10 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="h-3 w-3 rounded-full bg-signal-red shadow-[0_0_18px_rgba(239,68,68,0.95)]" />
            <div>
              <div className="text-xs uppercase tracking-wide text-signal-red">Recording Active</div>
              <div className="text-sm font-bold text-slate-100">Camera, route, speed, and motion telemetry</div>
            </div>
          </div>
          <div className="text-right text-xs text-slate-400">
            <div>Latest session</div>
            <div className="font-bold text-slate-100">Local only</div>
          </div>
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(280px,1.1fr)_minmax(320px,1.4fr)]">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
          <RecordingTimer seconds={elapsed} />
          <SpeedDisplay speed={latestGps?.speedMetresPerSecond} />
          <FlightGyroDisplay orientation={latestOrientation} motion={latestMotion} />
          <RouteMap samples={gpsSamples} latest={latestGps} />
        </div>
        <LiveVideoPreview stream={stream} prominent />
      </div>
    </section>
  );
}
