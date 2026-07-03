export function ImpactRiskBadge({ eventCount, latestMagnitude, compact = false }: { eventCount: number; latestMagnitude: number; compact?: boolean }) {
  const elevated = eventCount > 0 || latestMagnitude > 20;
  return (
    <div className={`rounded-lg border text-center ${compact ? "px-2 py-2" : "px-4 py-3"} ${elevated ? "border-signal-amber bg-signal-amber/10 text-signal-amber" : "border-signal-green/50 bg-signal-green/10 text-signal-green"}`}>
      <div className="text-xs uppercase tracking-wide">High-impact risk</div>
      <div className="font-black">{elevated ? "Elevated" : "Normal"}</div>
    </div>
  );
}
