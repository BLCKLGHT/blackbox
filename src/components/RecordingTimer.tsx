import { formatDuration } from "@/lib/drive-utils";

export function RecordingTimer({ seconds }: { seconds: number }) {
  return (
    <div className="rounded-lg border border-signal-red/40 bg-signal-red/10 p-3 text-center">
      <div className="text-xs uppercase tracking-wide text-signal-red">Recording</div>
      <div className="text-3xl font-black tabular-nums">{formatDuration(seconds)}</div>
    </div>
  );
}
