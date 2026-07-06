export type ImpactSensitivity = "low" | "medium" | "high";
export type VideoQuality = "low" | "medium" | "high";
export type RetentionHours = 24 | 48 | 72;
export type CameraLens = "auto" | "0.5x" | "1x" | "3x";

export interface WeatherInfo {
  temperatureCelsius: number | null;
  windKmh: number | null;
  summary: string;
  observedAt: number;
}

export interface HudOverlayMetrics {
  timestamp: number;
  ownSpeedMetresPerSecond: number | null;
  latitude: number | null;
  longitude: number | null;
  weather: WeatherInfo | null;
}

export type VehicleRelativeMotion = "approaching" | "moving_away" | "crossing" | "stable" | "unknown";
export type VehicleClosingRisk = "low" | "medium" | "high" | "unknown";

export interface VehicleTrackEvidence {
  timestamp: number;
  model: string;
  trackId: string;
  detectionId: string;
  detectionClass: "car" | "bus" | "truck" | "motorcycle";
  confidence: number;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  iouWithPrevious: number | null;
  boxAreaRatio: number;
  scaleDeltaPerSecond: number | null;
  centerDeltaPerSecond: {
    x: number | null;
    y: number | null;
  };
  hostSpeedMetresPerSecond: number | null;
  estimatedDistanceMetres: number | null;
  estimatedCarLengthsAhead: number | null;
  relativeMotionEstimate: VehicleRelativeMotion;
  closingRisk: VehicleClosingRisk;
  closingRiskScore: number;
  motionBasis: string[];
}

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
  plateConfidence: number | null;
  estimatedDistanceMetres: number | null;
  estimatedCarLengthsAhead: number | null;
  relativeMotionEstimate: VehicleRelativeMotion;
  closingRisk: VehicleClosingRisk;
  closingRiskScore: number;
  trackAgeFrames: number;
  lastSeenAt: number;
  evidence: VehicleTrackEvidence;
}

export interface HudFrame {
  timestamp: number;
  targets: HudTarget[];
  detections: VehicleTrackEvidence[];
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
