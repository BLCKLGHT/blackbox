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
          <div>{locked?.lockState === "locked" ? "LOCKED" : locked ? "CANDIDATE" : "NO TARGET"}</div>
          <div className="mt-1 font-bold text-slate-200">{locked?.estimatedDistanceMetres ? `${locked.estimatedDistanceMetres.toFixed(0)}m` : "--"}</div>
          <div className="font-bold text-slate-200">{locked?.estimatedSpeedMetresPerSecond !== null && locked?.estimatedSpeedMetresPerSecond !== undefined ? `${(locked.estimatedSpeedMetresPerSecond * 3.6).toFixed(0)} km/h` : "--"}</div>
        </div>
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-500">Visual estimate only. Box size, lens, angle, and target type can shift this reading.</p>
    </section>
  );
}
