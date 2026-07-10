"use client";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_SETTINGS, getVideoConstraints, normaliseRetention, saveSettings } from "@/lib/settings";
import type { AppSettings, CameraLens, ImpactSensitivity, VideoQuality } from "@/types/drive";
import { EVIDENCE_WARNING } from "@/lib/drive-utils";

const CAMERA_LENSES: CameraLens[] = ["auto", "0.5x", "1x", "3x"];

export function SettingsForm() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    import("@/lib/settings").then(({ loadSettings }) => setSettings(loadSettings()));
  }, []);

  function update(patch: Partial<AppSettings>) {
    setSettings((current) => ({ ...current, ...patch }));
    setSaved(false);
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        saveSettings(settings);
        setSaved(true);
      }}
    >
      <Field label="Impact sensitivity">
        <select className="w-full rounded-md border border-cockpit-line bg-cockpit-900 p-3" value={settings.impactSensitivity} onChange={(event) => update({ impactSensitivity: event.target.value as ImpactSensitivity })}>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </Field>
      <Field label="Video quality">
        <select className="w-full rounded-md border border-cockpit-line bg-cockpit-900 p-3" value={settings.videoQuality} onChange={(event) => update({ videoQuality: event.target.value as VideoQuality })}>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </Field>
      <CameraSetupPreview quality={settings.videoQuality} />
      <label className="flex items-center justify-between rounded-lg border border-cockpit-line bg-cockpit-900 p-4">
        <span>Audio recording</span>
        <input type="checkbox" checked={settings.audioRecording} onChange={(event) => update({ audioRecording: event.target.checked })} />
      </label>
      <label className="flex items-center justify-between gap-4 rounded-lg border border-signal-blue/50 bg-cockpit-900 p-4">
        <span>
          <span className="block font-bold">Simulation mode</span>
          <span className="block text-xs leading-5 text-slate-500">Feeds synthetic GPS, acceleration, braking, motion, and gyro data so you can test the HUD without driving. Emergency cloud alerts are disabled in this mode.</span>
        </span>
        <input type="checkbox" checked={settings.simulationMode} onChange={(event) => update({ simulationMode: event.target.checked })} />
      </label>
      <Field label="Retention">
        <select className="w-full rounded-md border border-cockpit-line bg-cockpit-900 p-3" value={settings.retentionHours} onChange={(event) => update({ retentionHours: normaliseRetention(event.target.value) })}>
          <option value={24}>24 hours</option>
          <option value={48}>48 hours</option>
          <option value={72}>72 hours</option>
        </select>
      </Field>
      <Field label="Driver name">
        <input className="w-full rounded-md border border-cockpit-line bg-cockpit-900 p-3" placeholder="Driver name for incident SMS" value={settings.driverName} onChange={(event) => update({ driverName: event.target.value })} />
      </Field>
      <section className="rounded-lg border border-cockpit-line bg-cockpit-900 p-4">
        <h2 className="font-black">Emergency Contact</h2>
        <div className="mt-4 grid gap-3">
          <input className="rounded-md border border-cockpit-line bg-cockpit-950 p-3" placeholder="Name" value={settings.emergencyContact.name} onChange={(event) => update({ emergencyContact: { ...settings.emergencyContact, name: event.target.value } })} />
          <input className="rounded-md border border-cockpit-line bg-cockpit-950 p-3" placeholder="Email" value={settings.emergencyContact.email} onChange={(event) => update({ emergencyContact: { ...settings.emergencyContact, email: event.target.value } })} />
          <input className="rounded-md border border-cockpit-line bg-cockpit-950 p-3" placeholder="Phone number" value={settings.emergencyContact.phone} onChange={(event) => update({ emergencyContact: { ...settings.emergencyContact, phone: event.target.value } })} />
        </div>
      </section>
      <Field label="Alert message template">
        <textarea className="min-h-28 w-full rounded-md border border-cockpit-line bg-cockpit-900 p-3" value={settings.alertMessageTemplate} onChange={(event) => update({ alertMessageTemplate: event.target.value })} />
      </Field>
      <p className="rounded-lg border border-signal-amber/40 bg-signal-amber/10 p-4 text-sm text-signal-amber">{EVIDENCE_WARNING}</p>
      <button className="touch-target w-full rounded-lg bg-signal-blue px-5 py-3 font-black text-cockpit-950">Save Settings</button>
      {saved ? <p className="text-center text-sm text-signal-green">Settings saved locally.</p> : null}
    </form>
  );
}

function CameraSetupPreview({ quality }: { quality: VideoQuality }) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [lens, setLens] = useState<CameraLens>("auto");
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    return () => {
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [stream]);

  async function startPreview(selectedLens = lens) {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera preview is not supported in this browser.");
      return;
    }
    setStarting(true);
    setError(null);
    stream?.getTracks().forEach((track) => track.stop());
    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({
        video: getVideoConstraints(quality),
        audio: false
      });
      await applyPreviewLens(nextStream, selectedLens).catch((message) => {
        if (message) setError(message instanceof Error ? message.message : String(message));
      });
      setStream(nextStream);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "Camera permission was denied.");
    } finally {
      setStarting(false);
    }
  }

  function stopPreview() {
    stream?.getTracks().forEach((track) => track.stop());
    setStream(null);
  }

  async function selectLens(nextLens: CameraLens) {
    setLens(nextLens);
    if (stream) await startPreview(nextLens);
  }

  return (
    <section className="rounded-lg border border-cockpit-line bg-cockpit-900 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-black">Camera Setup</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">Preview the rear camera while positioning the phone mount. This does not record video or telemetry.</p>
        </div>
        {stream ? (
          <button type="button" className="rounded-md border border-signal-red px-3 py-2 text-sm font-bold text-signal-red" onClick={stopPreview}>
            Stop
          </button>
        ) : (
          <button type="button" className="rounded-md bg-signal-blue px-3 py-2 text-sm font-black text-cockpit-950" disabled={starting} onClick={() => void startPreview()}>
            {starting ? "Starting..." : "Setup Camera"}
          </button>
        )}
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2">
        {CAMERA_LENSES.map((option) => (
          <button
            key={option}
            type="button"
            className={`rounded-md border px-2 py-2 text-sm font-black ${lens === option ? "border-signal-blue bg-signal-blue text-cockpit-950" : "border-cockpit-line bg-cockpit-950 text-slate-200"}`}
            onClick={() => void selectLens(option)}
          >
            {option === "auto" ? "Auto" : option}
          </button>
        ))}
      </div>
      {error ? <p className="mt-3 rounded-md border border-signal-amber/40 bg-signal-amber/10 p-3 text-sm text-signal-amber">{error}</p> : null}
      <div className="mt-3 aspect-[9/16] max-h-[62vh] overflow-hidden rounded-lg border border-cockpit-line bg-black">
        {stream ? (
          <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-500">Tap Setup Camera to view alignment.</div>
        )}
      </div>
    </section>
  );
}

async function applyPreviewLens(mediaStream: MediaStream, cameraLens: CameraLens): Promise<string | null> {
  if (cameraLens === "auto") return null;
  const track = mediaStream.getVideoTracks()[0];
  if (!track) return null;
  const capabilities = typeof track.getCapabilities === "function" ? (track.getCapabilities() as MediaTrackCapabilities & { zoom?: { min?: number; max?: number; step?: number } }) : {};
  if (!capabilities.zoom) return `Lens ${cameraLens} requested, but this browser does not expose camera zoom selection. Using the default rear camera.`;
  const requestedZoom = cameraLens === "0.5x" ? 0.5 : cameraLens === "3x" ? 3 : 1;
  const min = capabilities.zoom.min ?? requestedZoom;
  const max = capabilities.zoom.max ?? requestedZoom;
  const zoom = Math.min(max, Math.max(min, requestedZoom));
  await track.applyConstraints({ advanced: [{ zoom }] } as unknown as MediaTrackConstraints);
  return null;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-bold text-slate-300">{label}</span>
      {children}
    </label>
  );
}
