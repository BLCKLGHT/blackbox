import type { DriveSession, DriveSummary, GpsSample, HighImpactEvent, ManualMarker, MotionSample } from "@/types/drive";

export const EVIDENCE_WARNING =
  "Black Box is an experimental personal recording tool. It is not a certified crash detection or emergency response system.";

export function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function metresPerSecondToKmh(value: number | null | undefined): number {
  return value ? value * 3.6 : 0;
}

export function calculateMagnitude(x: number | null, y: number | null, z: number | null): number {
  const safeX = x ?? 0;
  const safeY = y ?? 0;
  const safeZ = z ?? 0;
  return Math.sqrt(safeX * safeX + safeY * safeY + safeZ * safeZ);
}

export function createEmptySummary(): DriveSummary {
  return {
    maxSpeedMetresPerSecond: 0,
    averageSpeedMetresPerSecond: 0,
    gpsSampleCount: 0,
    motionSampleCount: 0,
    highImpactEventCount: 0,
    manualMarkerCount: 0,
    lastKnownLocation: null,
    warning: EVIDENCE_WARNING
  };
}

export function buildSummary(
  gpsSamples: GpsSample[],
  motionSamples: MotionSample[],
  highImpactEvents: HighImpactEvent[],
  manualMarkers: ManualMarker[]
): DriveSummary {
  const speeds = gpsSamples.map((sample) => sample.speedMetresPerSecond).filter((speed): speed is number => typeof speed === "number" && speed >= 0);
  const maxSpeedMetresPerSecond = speeds.length ? Math.max(...speeds) : 0;
  const averageSpeedMetresPerSecond = speeds.length ? speeds.reduce((sum, speed) => sum + speed, 0) / speeds.length : 0;
  const lastGps = gpsSamples.at(-1);

  return {
    maxSpeedMetresPerSecond,
    averageSpeedMetresPerSecond,
    gpsSampleCount: gpsSamples.length,
    motionSampleCount: motionSamples.length,
    highImpactEventCount: highImpactEvents.length,
    manualMarkerCount: manualMarkers.length,
    lastKnownLocation: lastGps
      ? {
          latitude: lastGps.latitude,
          longitude: lastGps.longitude,
          accuracy: lastGps.accuracy,
          timestamp: lastGps.timestamp
        }
      : null,
    warning: EVIDENCE_WARNING
  };
}

export function createSession(retentionHours: number): DriveSession {
  const startedAt = Date.now();
  return {
    id: createId("drive"),
    startedAt,
    endedAt: null,
    durationSeconds: 0,
    videoBlobId: null,
    protected: false,
    expiresAt: startedAt + retentionHours * 60 * 60 * 1000,
    gpsSamples: [],
    motionSamples: [],
    orientationSamples: [],
    hudFrames: [],
    highImpactEvents: [],
    manualMarkers: [],
    summary: createEmptySummary()
  };
}

export function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return [hours, minutes, seconds].map((unit) => unit.toString().padStart(2, "0")).join(":");
}

export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
