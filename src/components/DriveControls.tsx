export function DriveControls({ onStop, onMarkEvent }: { onStop: () => void; onMarkEvent: () => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <button onClick={onMarkEvent} className="touch-target rounded-lg border border-signal-amber bg-signal-amber/10 px-4 py-3 font-bold text-signal-amber">
        Mark Event
      </button>
      <button onClick={onStop} className="touch-target rounded-lg bg-signal-red px-4 py-3 font-black text-white">
        Stop Drive
      </button>
    </div>
  );
}
