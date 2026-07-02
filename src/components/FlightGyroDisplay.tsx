import type { MotionSample, OrientationSample } from "@/types/drive";

export function FlightGyroDisplay({ orientation, motion }: { orientation: OrientationSample | null; motion: MotionSample | null }) {
  const roll = clamp(orientation?.gamma ?? 0, -45, 45);
  const pitch = clamp(orientation?.beta ?? 0, -45, 45);
  const yaw = orientation?.alpha ?? 0;
  const magnitude = motion?.magnitude ?? 0;

  return (
    <section className="rounded-lg border border-cockpit-line bg-cockpit-900 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">Gyro Attitude</div>
          <div className="text-sm font-bold text-slate-200">Pitch {pitch.toFixed(0)} / Roll {roll.toFixed(0)}</div>
        </div>
        <div className="text-right text-xs text-slate-500">
          <div>HDG</div>
          <div className="font-bold text-slate-200">{yaw.toFixed(0).padStart(3, "0")}</div>
        </div>
      </div>
      <div className="relative mx-auto aspect-square max-h-52 overflow-hidden rounded-full border-2 border-slate-600 bg-cockpit-950">
        <div
          className="absolute inset-[-25%] transition-transform duration-300"
          style={{
            transform: `rotate(${-roll}deg) translateY(${pitch * 1.1}px)`
          }}
        >
          <div className="h-1/2 bg-sky-500/80" />
          <div className="h-1/2 bg-amber-800/85" />
        </div>
        <div className="absolute left-0 right-0 top-1/2 h-px bg-white/80" />
        <div className="absolute left-1/2 top-0 h-full w-px bg-white/20" />
        <div className="absolute inset-x-8 top-1/2 flex -translate-y-1/2 items-center justify-between">
          <div className="h-1 w-12 bg-signal-green" />
          <div className="h-1 w-12 bg-signal-green" />
        </div>
        <div className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-signal-green bg-cockpit-950" />
        <div className="absolute inset-0 rounded-full shadow-[inset_0_0_42px_rgba(0,0,0,0.65)]" />
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
        <span>Motion force</span>
        <span className={magnitude > 20 ? "font-bold text-signal-amber" : "font-bold text-signal-green"}>{magnitude.toFixed(1)} m/s²</span>
      </div>
    </section>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
