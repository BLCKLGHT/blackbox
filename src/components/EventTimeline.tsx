import type { HighImpactEvent, ManualMarker } from "@/types/drive";

export function EventTimeline({ impacts, markers }: { impacts: HighImpactEvent[]; markers: ManualMarker[] }) {
  const items = [
    ...impacts.map((event) => ({ id: event.id, timestamp: event.timestamp, title: "Possible High Impact", detail: event.triggerReasons.join("; "), tone: "text-signal-amber" })),
    ...markers.map((marker) => ({ id: marker.id, timestamp: marker.timestamp, title: marker.label, detail: marker.notes, tone: "text-signal-blue" }))
  ].sort((a, b) => a.timestamp - b.timestamp);

  return (
    <section className="rounded-lg border border-cockpit-line bg-cockpit-900 p-4">
      <h2 className="font-black">Event Timeline</h2>
      <div className="mt-4 space-y-3">
        {items.length ? (
          items.map((item) => (
            <article key={item.id} className="border-l border-cockpit-line pl-3">
              <div className={`font-bold ${item.tone}`}>{item.title}</div>
              <div className="text-xs text-slate-500">{new Date(item.timestamp).toLocaleString()}</div>
              <p className="mt-1 text-sm text-slate-300">{item.detail}</p>
            </article>
          ))
        ) : (
          <p className="text-sm text-slate-500">No high-impact events or manual markers recorded.</p>
        )}
      </div>
    </section>
  );
}
