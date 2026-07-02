"use client";

import { useEffect, useState } from "react";
import { DEFAULT_SETTINGS, normaliseRetention, saveSettings } from "@/lib/settings";
import type { AppSettings, ImpactSensitivity, VideoQuality } from "@/types/drive";
import { EVIDENCE_WARNING } from "@/lib/drive-utils";

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
      <label className="flex items-center justify-between rounded-lg border border-cockpit-line bg-cockpit-900 p-4">
        <span>Audio recording</span>
        <input type="checkbox" checked={settings.audioRecording} onChange={(event) => update({ audioRecording: event.target.checked })} />
      </label>
      <Field label="Retention">
        <select className="w-full rounded-md border border-cockpit-line bg-cockpit-900 p-3" value={settings.retentionHours} onChange={(event) => update({ retentionHours: normaliseRetention(event.target.value) })}>
          <option value={24}>24 hours</option>
          <option value={48}>48 hours</option>
          <option value={72}>72 hours</option>
        </select>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-bold text-slate-300">{label}</span>
      {children}
    </label>
  );
}
