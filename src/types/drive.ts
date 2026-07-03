export type ImpactSensitivity = "low" | "medium" | "high";
export type VideoQuality = "low" | "medium" | "high";
export type RetentionHours = 24 | 48 | 72;
export type CameraLens = "auto" | "0.5x" | "1x" | "3x";

export interface HudTarget {
  id: string;
  label: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
  lockState: "locked" | "candidate";
  plateText: string | null;
  estimatedDistanceMetres: number | null;
  estimatedCarLengthsAhead: number | null;
  estimatedSpeedMetresPerSecond: number | null;
  relativeSpeedMetresPerSecond: number | null;
}

export interface HudFrame {
  timestamp: number;
  targets: HudTarget[];
}

export interface GpsSample {
  timestamp: number;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speedMetresPerSecond: number | null;
  heading: number | null;
  altitude: number | null;
}

export interface MotionSample {
  timestamp: number;
  accelerationX: number | null;
  accelerationY: number | null;
  accelerationZ: number | null;
  accelerationIncludingGravityX: number | null;
  accelerationIncludingGravityY: number | null;
  accelerationIncludingGravityZ: number | null;
  rotationRateAlpha: number | null;
  rotationRateBeta: number | null;
  rotationRateGamma: number | null;
  interval: number | null;
  magnitude: number;
}

export interface OrientationSample {
  timestamp: number;
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
}

export interface HighImpactEvent {
  id: string;
  timestamp: number;
  confidence: "low" | "medium" | "high";
  triggerReasons: string[];
  speedBefore: number | null;
  speedAfter: number | null;
  peakAccelerationMagnitude: number;
  notes: string;
}

export interface ManualMarker {
  id: string;
  timestamp: number;
  label: string;
  notes: string;
}

export interface DriveSummary {
  maxSpeedMetresPerSecond: number;
  averageSpeedMetresPerSecond: number;
  gpsSampleCount: number;
  motionSampleCount: number;
  highImpactEventCount: number;
  manualMarkerCount: number;
  lastKnownLocation: Pick<GpsSample, "latitude" | "longitude" | "accuracy" | "timestamp"> | null;
  warning: string;
}

export interface DriveSession {
  id: string;
  startedAt: number;
  endedAt: number | null;
  durationSeconds: number;
  videoBlobId: string | null;
  protected: boolean;
  expiresAt: number;
  gpsSamples: GpsSample[];
  motionSamples: MotionSample[];
  orientationSamples: OrientationSample[];
  hudFrames: HudFrame[];
  highImpactEvents: HighImpactEvent[];
  manualMarkers: ManualMarker[];
  summary: DriveSummary;
}

export interface AppSettings {
  impactSensitivity: ImpactSensitivity;
  videoQuality: VideoQuality;
  audioRecording: boolean;
  retentionHours: RetentionHours;
  emergencyContact: {
    name: string;
    email: string;
    phone: string;
  };
  alertMessageTemplate: string;
  disclaimerAccepted: boolean;
}

export type PermissionStateName = "unknown" | "available" | "granted" | "denied" | "unsupported" | "warning";

export interface PermissionStatusInfo {
  label: string;
  state: PermissionStateName;
  detail: string;
}
