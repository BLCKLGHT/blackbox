"use client";

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { metresPerSecondToKmh } from "@/lib/drive-utils";
import type { GpsSample, MotionSample } from "@/types/drive";

export function SpeedChart({ samples }: { samples: GpsSample[] }) {
  const data = samples.map((sample) => ({ time: new Date(sample.timestamp).toLocaleTimeString(), speed: metresPerSecondToKmh(sample.speedMetresPerSecond) }));
  return <Chart title="Speed Graph" data={data} dataKey="speed" stroke="#3ea8ff" unit="km/h" />;
}

export function MotionChart({ samples }: { samples: MotionSample[] }) {
  const data = samples.filter((_, index) => index % 3 === 0).map((sample) => ({ time: new Date(sample.timestamp).toLocaleTimeString(), magnitude: sample.magnitude }));
  return <Chart title="Motion Force Graph" data={data} dataKey="magnitude" stroke="#f59e0b" unit="m/s²" />;
}

function Chart({ title, data, dataKey, stroke, unit }: { title: string; data: Array<Record<string, string | number>>; dataKey: string; stroke: string; unit: string }) {
  return (
    <section className="rounded-lg border border-cockpit-line bg-cockpit-900 p-4">
      <h2 className="font-black">{title}</h2>
      <div className="mt-4 h-56">
        {data.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <XAxis dataKey="time" tick={{ fill: "#94a3b8", fontSize: 11 }} minTickGap={24} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} width={42} />
              <Tooltip contentStyle={{ background: "#11151a", border: "1px solid #2a333d", color: "#f8fafc" }} formatter={(value) => [`${Number(value).toFixed(1)} ${unit}`, title]} />
              <Line type="monotone" dataKey={dataKey} stroke={stroke} dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">No samples recorded.</div>
        )}
      </div>
    </section>
  );
}
