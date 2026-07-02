import type { PermissionStatusInfo } from "@/types/drive";

const stateClass: Record<PermissionStatusInfo["state"], string> = {
  unknown: "border-slate-700 text-slate-300",
  available: "border-signal-blue text-signal-blue",
  granted: "border-signal-green text-signal-green",
  denied: "border-signal-red text-signal-red",
  unsupported: "border-signal-amber text-signal-amber",
  warning: "border-signal-amber text-signal-amber"
};

export function PermissionStatusCard({ item }: { item: PermissionStatusInfo }) {
  return (
    <section className="rounded-lg border border-cockpit-line bg-cockpit-900 p-4 shadow-glow">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold text-slate-100">{item.label}</h3>
        <span className={`rounded-full border px-2 py-1 text-xs uppercase ${stateClass[item.state]}`}>{item.state}</span>
      </div>
      <p className="mt-2 text-sm leading-5 text-slate-400">{item.detail}</p>
    </section>
  );
}
