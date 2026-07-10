export function DriveControls({ onStop }: { onStop: () => void }) {
  return (
    <div>
      <button onClick={onStop} className="touch-target w-full rounded-lg bg-signal-red px-4 py-3 font-black text-white">
        Stop Drive
      </button>
    </div>
  );
}
