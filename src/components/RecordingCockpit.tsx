import { FlightGyroDisplay } from "@/components/FlightGyroDisplay";
import { LiveVideoPreview } from "@/components/LiveVideoPreview";
import { RecordingTimer } from "@/components/RecordingTimer";
import { RouteMap } from "@/components/RouteMap";
import { SpeedDisplay } from "@/components/SpeedDisplay";
import { TargetDistancePanel } from "@/components/TargetDistancePanel";
import type { GpsSample, HudTarget, MotionSample, OrientationSample } from "@/types/drive";

export function RecordingCockpit({
  elapsed,
  gpsSamples,
  latestGps,
  locationLabel,
  latestMotion,
  latestOrientation,
  stream,
  hudTargets,
  onMarkEvent,
  compact = false
}: {
  elapsed: number;
  gpsSamples: GpsSample[];
  latestGps: GpsSample | null;
  locationLabel: string | null;
  latestMotion: MotionSample | null;
  latestOrientation: OrientationSample | null;
  stream: MediaStream | null;
  hudTargets: HudTarget[];
  onMarkEvent: () => void;
  compact?: boolean;
}) {
  return (
    <section className={compact ? "space-y-2" : "space-y-3"}>
      <div className={`rounded-lg border border-signal-red/50 bg-signal-red/10 ${compact ? "p-2" : "p-3"}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="h-3 w-3 rounded-full bg-signal-red shadow-[0_0_18px_rgba(239,68,68,0.95)]" />
            <div>
              <div className="text-xs uppercase tracking-wide text-signal-red">Recording Active</div>
              <div className={compact ? "text-xs font-bold text-slate-100" : "text-sm font-bold text-slate-100"}>Camera, route, speed, and motion telemetry</div>
            </div>
          </div>
          <div className="text-right text-xs text-slate-400">
            <div>Latest session</div>
            <div className="font-bold text-slate-100">Local only</div>
          </div>
        </div>
      </div>
      <LiveVideoPreview
        stream={stream}
        prominent
        compact={compact}
        hudTargets={hudTargets}
        gpsSamples={gpsSamples}
        latestGps={latestGps}
        locationLabel={locationLabel}
        latestMotion={latestMotion}
        latestOrientation={latestOrientation}
      />
      <button
        type="button"
        onClick={onMarkEvent}
        className={`touch-target w-full rounded-lg border-2 border-signal-amber bg-signal-amber px-5 font-black uppercase tracking-wide text-cockpit-950 shadow-[0_0_22px_rgba(245,158,11,0.35)] active:translate-y-px ${
          compact ? "py-3 text-base" : "py-5 text-xl"
        }`}
      >
        Mark Event
      </button>
      <div className={compact ? "grid grid-cols-[minmax(0,1.25fr)_minmax(104px,0.75fr)] gap-2" : "grid gap-3 md:grid-cols-[minmax(0,1.35fr)_minmax(180px,0.65fr)]"}>
        <TargetDistancePanel targets={hudTargets} compact={compact} />
        <SpeedDisplay speed={latestGps?.speedMetresPerSecond} compact={compact} />
      </div>
      <div className={compact ? "grid grid-cols-2 gap-2" : "grid gap-3 sm:grid-cols-3"}>
        <RecordingTimer seconds={elapsed} compact={compact} />
        <FlightGyroDisplay orientation={latestOrientation} motion={latestMotion} compact={compact} />
        <RouteMap samples={gpsSamples} latest={latestGps} compact={compact} />
      </div>
    </section>
  );
}
