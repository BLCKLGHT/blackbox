import { metresPerSecondToKmh } from "@/lib/drive-utils";

export function SpeedDisplay({ speed, compact = false }: { speed: number | null | undefined; compact?: boolean }) {
  return (
    <section className={`rounded-lg border border-cockpit-line bg-cockpit-900 ${compact ? "p-2" : "p-4"}`}>
      <div className="text-xs uppercase text-slate-400">Current Speed</div>
      <div className={`${compact ? "text-3xl" : "mt-1 text-4xl"} font-black tabular-nums`}>{metresPerSecondToKmh(speed).toFixed(0)}</div>
      <div className="text-sm text-slate-400">km/h</div>
    </section>
  );
}
