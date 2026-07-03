export function MotionGauge({ magnitude, compact = false }: { magnitude: number; compact?: boolean }) {
  const percent = Math.min(100, (magnitude / 40) * 100);
  return (
    <section className={`rounded-lg border border-cockpit-line bg-cockpit-900 ${compact ? "p-2" : "p-4"}`}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase text-slate-400">Motion Force</div>
          <div className={`${compact ? "text-2xl" : "mt-1 text-3xl"} font-black tabular-nums`}>{magnitude.toFixed(1)}</div>
        </div>
        <div className="text-sm text-slate-400">m/s²</div>
      </div>
      <div className={`${compact ? "mt-2" : "mt-3"} h-2 rounded-full bg-cockpit-800`}>
        <div className="h-2 rounded-full bg-signal-blue" style={{ width: `${percent}%` }} />
      </div>
    </section>
  );
}
