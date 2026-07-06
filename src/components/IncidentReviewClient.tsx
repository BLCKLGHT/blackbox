"use client";

import { useEffect, useMemo, useState } from "react";
import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { metresPerSecondToKmh } from "@/lib/drive-utils";
import type { GpsSample, HighImpactEvent, HudFrame, IncidentRecord, IncidentUploadObject, MotionSample, OrientationSample } from "@/types/drive";

type IncidentUploadWithUrl = IncidentUploadObject & { readUrl: string };
type IncidentResponse = Omit<IncidentRecord, "tokenHash" | "uploads"> & { uploads: IncidentUploadWithUrl[] };
type SensorPayload = {
  event: HighImpactEvent;
  gpsSamples: GpsSample[];
  motionSamples: MotionSample[];
  orientationSamples: OrientationSample[];
  hudFrames: HudFrame[];
};

export function IncidentReviewClient({ incidentId, token }: { incidentId: string; token: string }) {
  const [incident, setIncident] = useState<IncidentResponse | null>(null);
  const [sensor, setSensor] = useState<SensorPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/incidents/${incidentId}?token=${encodeURIComponent(token)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(((await response.json()) as { error?: string }).error ?? "Could not load incident.");
        return response.json() as Promise<IncidentResponse>;
      })
      .then(async (record) => {
        setIncident(record);
        const sensorUpload = record.uploads.filter((upload) => upload.kind === "sensor-json").at(-1);
        if (sensorUpload) {
          const sensorResponse = await fetch(sensorUpload.readUrl);
          if (sensorResponse.ok) setSensor((await sensorResponse.json()) as SensorPayload);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load incident."));
  }, [incidentId, token]);

  const videoUpload = useMemo(() => {
    if (!incident) return null;
    return incident.uploads.find((upload) => upload.kind === "video-clip") ?? incident.uploads.find((upload) => upload.kind === "video-chunk") ?? null;
  }, [incident]);

  if (error) {
    return <section className="rounded-lg border border-signal-red/40 bg-signal-red/10 p-6 text-signal-red">{error}</section>;
  }

  if (!incident) {
    return <section className="rounded-lg border border-cockpit-line bg-cockpit-900 p-6 text-slate-400">Loading private incident review...</section>;
  }

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-signal-amber/50 bg-signal-amber/10 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black text-slate-100">Incident Review</h1>
            <p className="mt-1 text-sm text-signal-amber">Private evidence link for {incident.driverName || "unknown driver"}</p>
          </div>
          <div className="text-right text-xs uppercase tracking-wide text-slate-500">
            <div>Confidence</div>
            <div className="text-2xl font-black text-signal-amber">{Math.round(incident.confidenceScore * 100)}%</div>
          </div>
        </div>
        <p className="mt-3 rounded-md border border-signal-amber/30 bg-black/20 p-3 text-sm text-signal-amber">{incident.warning}</p>
      </section>

      <section className="rounded-lg border border-cockpit-line bg-cockpit-900 p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-black">Uploaded Video</h2>
          <span className="text-xs text-slate-500">{incident.uploads.filter((upload) => upload.kind.startsWith("video")).length} video object(s)</span>
        </div>
        {videoUpload ? (
          <video className="w-full rounded-lg border border-cockpit-line bg-black" src={videoUpload.readUrl} controls playsInline preload="metadata" />
        ) : (
          <div className="rounded-lg border border-cockpit-line bg-cockpit-950 p-4 text-sm text-slate-400">Video chunks are still uploading or unavailable.</div>
        )}
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Timestamp" value={new Date(incident.event.timestamp).toLocaleString()} />
        <Metric label="Last upload" value={incident.lastUploadAt ? new Date(incident.lastUploadAt).toLocaleString() : "Pending"} />
        <Metric label="Speed before" value={`${metresPerSecondToKmh(incident.speedBeforeMetresPerSecond).toFixed(0)} km/h`} />
        <Metric label="Speed after" value={`${metresPerSecondToKmh(incident.speedAfterMetresPerSecond).toFixed(0)} km/h`} />
      </section>

      <section className="rounded-lg border border-cockpit-line bg-cockpit-900 p-4">
        <h2 className="font-black">GPS Location</h2>
        {incident.lastKnownLocation ? (
          <div className="mt-3 grid gap-2 text-sm text-slate-300 sm:grid-cols-3">
            <div>Latitude {incident.lastKnownLocation.latitude.toFixed(5)}</div>
            <div>Longitude {incident.lastKnownLocation.longitude.toFixed(5)}</div>
            <div>Accuracy {incident.lastKnownLocation.accuracy ? `${incident.lastKnownLocation.accuracy.toFixed(0)}m` : "unknown"}</div>
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-500">No GPS location was available at upload time.</p>
        )}
      </section>

      <MotionGraph sensor={sensor} eventTimestamp={incident.event.timestamp} />
      <IncidentTimeline incident={incident} sensor={sensor} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-cockpit-line bg-cockpit-900 p-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-black text-slate-100">{value}</div>
    </div>
  );
}

function MotionGraph({ sensor, eventTimestamp }: { sensor: SensorPayload | null; eventTimestamp: number }) {
  const data = useMemo(() => {
    if (!sensor) return [];
    return sensor.motionSamples.map((sample) => ({
      t: (sample.timestamp - eventTimestamp) / 1000,
      force: sample.magnitude
    }));
  }, [eventTimestamp, sensor]);

  return (
    <section className="rounded-lg border border-cockpit-line bg-cockpit-900 p-4">
      <h2 className="font-black">Motion Graph</h2>
      <div className="mt-3 h-56">
        {data.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <XAxis dataKey="t" tick={{ fill: "#94a3b8", fontSize: 10 }} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} width={36} />
              <Tooltip contentStyle={{ background: "#11151a", border: "1px solid #2a333d", color: "#f8fafc" }} />
              <ReferenceLine x={0} stroke="#f59e0b" strokeWidth={2} />
              <Line type="monotone" dataKey="force" stroke="#f59e0b" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">Motion samples are still uploading or unavailable.</div>
        )}
      </div>
    </section>
  );
}

function IncidentTimeline({ incident, sensor }: { incident: IncidentResponse; sensor: SensorPayload | null }) {
  const rows = [
    { time: incident.protectedWindow.start, label: "Protected window start" },
    { time: incident.event.timestamp, label: "Impact trigger", detail: incident.event.triggerReasons.join("; ") },
    { time: incident.protectedWindow.end, label: "Protected window end" },
    ...(sensor?.hudFrames.slice(-5).map((frame) => ({ time: frame.timestamp, label: "Vehicle tracking evidence", detail: `${frame.detections.length} detection(s)` })) ?? [])
  ].sort((a, b) => a.time - b.time);

  return (
    <section className="rounded-lg border border-cockpit-line bg-cockpit-900 p-4">
      <h2 className="font-black">Event Timeline</h2>
      <div className="mt-3 space-y-2">
        {rows.map((row) => (
          <div key={`${row.time}-${row.label}`} className="rounded-md border border-cockpit-line bg-cockpit-950 p-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="font-bold text-slate-100">{row.label}</span>
              <span className="text-xs text-slate-500">{new Date(row.time).toLocaleString()}</span>
            </div>
            {row.detail ? <p className="mt-1 text-slate-500">{row.detail}</p> : null}
          </div>
        ))}
      </div>
    </section>
  );
}
