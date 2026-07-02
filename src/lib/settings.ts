import type { AppSettings, ImpactSensitivity, RetentionHours, VideoQuality } from "@/types/drive";

export const DEFAULT_SETTINGS: AppSettings = {
  impactSensitivity: "medium",
  videoQuality: "medium",
  audioRecording: false,
  retentionHours: 48,
  emergencyContact: {
    name: "",
    email: "",
    phone: ""
  },
  alertMessageTemplate:
    "Black Box possible high-impact event recorded at {time}. Last known location: {location}. This is not an automated emergency alert.",
  disclaimerAccepted: false
};

const SETTINGS_KEY = "black-box-v4-settings";

export function getImpactThreshold(setting: ImpactSensitivity): number {
  if (setting === "high") return 18;
  if (setting === "low") return 32;
  return 25;
}

export function getVideoConstraints(quality: VideoQuality): MediaTrackConstraints {
  const base: MediaTrackConstraints = { facingMode: { ideal: "environment" } };
  if (quality === "low") return { ...base, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } };
  if (quality === "high") return { ...base, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } };
  return { ...base, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
}

export function normaliseRetention(value: string): RetentionHours {
  const parsed = Number(value);
  return parsed === 24 || parsed === 72 ? parsed : 48;
}

export function loadSettings(): AppSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  const raw = window.localStorage.getItem(SETTINGS_KEY);
  if (!raw) return DEFAULT_SETTINGS;
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } as AppSettings;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
