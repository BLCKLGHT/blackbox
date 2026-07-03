import { formatDuration } from "@/lib/drive-utils";

export function RecordingTimer({ seconds, compact = false }: { seconds: number; compact?: boolean }) {
  return (
    <div className={`rounded-lg border border-signal-red/40 bg-signal-red/10 text-center ${compact ? "p-2" : "p-3"}`}>
      <div className="text-xs uppercase tracking-wide text-signal-red">Recording</div>
      <div className={`${compact ? "text-2xl" : "text-3xl"} font-black tabular-nums`}>{formatDuration(seconds)}</div>
    </div>
  );
}
