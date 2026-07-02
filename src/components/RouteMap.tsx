import type { GpsSample } from "@/types/drive";

export function RouteMap({ samples, latest }: { samples: GpsSample[]; latest: GpsSample | null }) {
  const points = samples.filter((sample) => Number.isFinite(sample.latitude) && Number.isFinite(sample.longitude)).slice(-80);
  const projected = project(points);
  const polyline = projected.map((point) => `${point.x},${point.y}`).join(" ");
  const last = projected.at(-1);

  return (
    <section className="rounded-lg border border-cockpit-line bg-cockpit-900 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">GPS Route</div>
          <div className="text-sm font-bold text-slate-200">{points.length ? `${points.length} samples` : "Waiting for fix"}</div>
        </div>
        <div className="text-right text-xs text-slate-500">
          <div>Accuracy</div>
          <div className="font-bold text-slate-200">{latest?.accuracy ? `${latest.accuracy.toFixed(0)}m` : "--"}</div>
        </div>
      </div>
      <svg viewBox="0 0 320 190" role="img" aria-label="Live GPS route map" className="h-48 w-full rounded-md border border-cockpit-line bg-cockpit-950">
        <defs>
          <pattern id="route-grid" width="32" height="32" patternUnits="userSpaceOnUse">
            <path d="M 32 0 L 0 0 0 32" fill="none" stroke="rgba(148,163,184,0.14)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="320" height="190" fill="url(#route-grid)" />
        <path d="M0 95 H320 M160 0 V190" stroke="rgba(62,168,255,0.14)" strokeWidth="1" />
        {polyline ? <polyline points={polyline} fill="none" stroke="#3ea8ff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /> : null}
        {last ? <circle cx={last.x} cy={last.y} r="7" fill="#4ade80" stroke="#050607" strokeWidth="3" /> : null}
        {!points.length ? <text x="160" y="98" textAnchor="middle" fill="#64748b" fontSize="13">GPS route will draw here</text> : null}
      </svg>
      <div className="mt-3 truncate text-xs text-slate-500">
        {latest ? `${latest.latitude.toFixed(5)}, ${latest.longitude.toFixed(5)}` : "No coordinates recorded yet"}
      </div>
    </section>
  );
}

function project(samples: GpsSample[]): Array<{ x: number; y: number }> {
  if (!samples.length) return [];
  const lats = samples.map((sample) => sample.latitude);
  const lngs = samples.map((sample) => sample.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latRange = Math.max(maxLat - minLat, 0.00005);
  const lngRange = Math.max(maxLng - minLng, 0.00005);
  const pad = 18;

  return samples.map((sample) => ({
    x: pad + ((sample.longitude - minLng) / lngRange) * (320 - pad * 2),
    y: 190 - pad - ((sample.latitude - minLat) / latRange) * (190 - pad * 2)
  }));
}
