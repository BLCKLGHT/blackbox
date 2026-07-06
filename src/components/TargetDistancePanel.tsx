import type { HudTarget } from "@/types/drive";

export function TargetDistancePanel({ targets, compact = false }: { targets: HudTarget[]; compact?: boolean }) {
  const locked = targets.find((target) => target.lockState === "locked") ?? targets[0] ?? null;

  return (
    <section className={`rounded-lg border border-cockpit-line bg-cockpit-900 ${compact ? "p-2" : "p-4"}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">Target Distance</div>
          <div className={`${compact ? "text-2xl" : "text-3xl"} font-black tabular-nums text-slate-100`}>
            {locked?.estimatedCarLengthsAhead !== null && locked?.estimatedCarLengthsAhead !== undefined ? locked.estimatedCarLengthsAhead.toFixed(1) : "--"}
          </div>
          <div className="text-sm text-slate-400">car lengths ahead</div>
        </div>
        <div className="text-right text-xs text-slate-500">
          <div>{locked ? lockLabel(locked.displayState) : "NO TARGET"}</div>
          <div className="mt-1 font-bold text-slate-200">{locked?.estimatedDistanceMetres ? `${locked.estimatedDistanceMetres.toFixed(0)}m` : "--"}</div>
          <div className="font-bold text-slate-200">{locked ? motionLabel(locked.relativeMotionEstimate) : "--"}</div>
          <div className="font-bold text-slate-200">{locked ? `Track ${Math.round((locked.trackConfidence ?? 0) * 100)}%` : "--"}</div>
          <div className="font-bold text-slate-200">{locked ? `Lock ${(locked.lockDurationMs / 1000).toFixed(1)}s` : "--"}</div>
          <div className={`font-bold ${locked?.closingRisk === "high" ? "text-signal-red" : locked?.closingRisk === "medium" ? "text-signal-amber" : "text-signal-green"}`}>
            {locked ? `Risk ${locked.closingRisk ?? "unknown"}` : "--"}
          </div>
        </div>
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-500">Visual estimate only. Relative motion and closing risk use box scale, centre movement, and host GPS speed. They are not measured target speed.</p>
    </section>
  );
}

function motionLabel(motion: HudTarget["relativeMotionEstimate"] | undefined): string {
  if (!motion) return "Unknown";
  if (motion === "moving_away") return "Moving away";
  return motion.charAt(0).toUpperCase() + motion.slice(1);
}

function lockLabel(state: HudTarget["displayState"] | undefined): string {
  if (state === "strong_lock") return "Strong lock";
  if (state === "weak_lock") return "Weak lock";
  if (state === "lost_target") return "Lost target";
  if (state === "no_vehicle") return "No vehicle";
  return "Searching";
}
