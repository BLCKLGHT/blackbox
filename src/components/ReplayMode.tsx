"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { metresPerSecondToKmh } from "@/lib/drive-utils";
import type { DriveSession, GpsSample, HudFrame, MotionSample, OrientationSample } from "@/types/drive";
import { TargetDistancePanel } from "./TargetDistancePanel";

export function ReplayMode({ session, videoUrl }: { session: DriveSession; videoUrl: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastUiUpdateRef = useRef(0);
  const [currentTime, setCurrentTime] = useState(0);
  const replayTimestamp = session.startedAt + currentTime * 1000;
  const gps = useMemo(() => nearest(session.gpsSamples, replayTimestamp), [replayTimestamp, session.gpsSamples]);
  const motion = useMemo(() => nearest(session.motionSamples, replayTimestamp), [replayTimestamp, session.motionSamples]);
  const orientation = useMemo(() => nearest(session.orientationSamples, replayTimestamp), [replayTimestamp, session.orientationSamples]);
  const hudFrame = useMemo(() => nearest(session.hudFrames ?? [], replayTimestamp), [replayTimestamp, session.hudFrames]);
  const updateReplayTime = useCallback((time: number, force = false) => {
    const now = performance.now();
    if (!force && now - lastUiUpdateRef.current < 220) return;
    lastUiUpdateRef.current = now;
    setCurrentTime(time);
  }, []);

  return (
    <section className="rounded-lg border border-signal-blue/40 bg-cockpit-900 p-3 shadow-glow">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-black">Replay Mode</h2>
          <p className="text-xs text-slate-500">Video and measurements synchronized by session time.</p>
        </div>
        <div className="text-right text-xs text-slate-500">
          <div>Replay</div>
          <div className="font-bold text-slate-200">{currentTime.toFixed(1)}s</div>
        </div>
      </div>
      <video
        ref={videoRef}
        className="w-full rounded-lg border border-cockpit-line bg-black"
        src={videoUrl}
        controls
        playsInline
        preload="auto"
        onTimeUpdate={(event) => updateReplayTime(event.currentTarget.currentTime)}
        onSeeked={(event) => updateReplayTime(event.currentTarget.currentTime, true)}
      />
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <ReplayMetric label="Own speed" value={`${metresPerSecondToKmh(gps?.speedMetresPerSecond).toFixed(0)} km/h`} />
        <ReplayMetric label="Motion force" value={`${(motion?.magnitude ?? 0).toFixed(1)} m/s²`} />
        <ReplayMetric label="Gyro pitch / roll" value={`${(orientation?.beta ?? 0).toFixed(0)} / ${(orientation?.gamma ?? 0).toFixed(0)}`} />
        <ReplayMetric label="Target lock" value={hudFrame?.targets[0]?.lockState === "locked" ? "Locked" : hudFrame?.targets.length ? "Candidate" : "No target"} />
      </div>
      <div className="mt-3">
        <TargetDistancePanel targets={hudFrame?.targets ?? []} compact />
      </div>
      <ReplayTimeline session={session} currentTime={currentTime} />
      <p className="mt-3 text-xs leading-5 text-slate-500">Replay measurements use locally recorded browser telemetry. They are estimates, not certified measurements.</p>
    </section>
  );
}

function ReplayTimeline({ session, currentTime }: { session: DriveSession; currentTime: number }) {
  const data = useMemo(() => {
    const speed = session.gpsSamples.map((sample) => ({
      t: (sample.timestamp - session.startedAt) / 1000,
      speed: metresPerSecondToKmh(sample.speedMetresPerSecond),
      motion: null as number | null
    }));
    const motion = session.motionSamples
      .filter((_, index) => index % 6 === 0)
      .map((sample) => ({
        t: (sample.timestamp - session.startedAt) / 1000,
        speed: null as number | null,
        motion: sample.magnitude
      }));
    return [...speed, ...motion].sort((a, b) => a.t - b.t);
  }, [session]);

  return (
    <section className="mt-3 rounded-lg border border-cockpit-line bg-cockpit-950 p-3">
      <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Synchronized timeline</div>
      <div className="h-40">
        {data.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <XAxis dataKey="t" tick={{ fill: "#94a3b8", fontSize: 10 }} minTickGap={18} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} width={34} />
              <Tooltip contentStyle={{ background: "#11151a", border: "1px solid #2a333d", color: "#f8fafc" }} />
              <ReferenceLine x={currentTime} stroke="#4ade80" strokeWidth={2} />
              <Line type="monotone" dataKey="speed" stroke="#3ea8ff" dot={false} strokeWidth={2} connectNulls={false} />
              <Line type="monotone" dataKey="motion" stroke="#f59e0b" dot={false} strokeWidth={2} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">No replay samples recorded.</div>
        )}
      </div>
    </section>
  );
}

function ReplayMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-cockpit-line bg-cockpit-950 p-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-black text-slate-100">{value}</div>
    </div>
  );
}

function nearest<T extends GpsSample | MotionSample | OrientationSample | HudFrame>(samples: T[], timestamp: number): T | null {
  if (!samples.length) return null;
  let best = samples[0];
  let bestDelta = Math.abs(best.timestamp - timestamp);
  for (const sample of samples) {
    const delta = Math.abs(sample.timestamp - timestamp);
    if (delta < bestDelta) {
      best = sample;
      bestDelta = delta;
    }
  }
  return bestDelta < 2500 ? best : null;
}
