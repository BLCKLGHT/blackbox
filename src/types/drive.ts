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
export type VehicleLockDisplayState = "no_vehicle" | "searching" | "strong_lock" | "weak_lock" | "lost_target";

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
  relativeSpeedEstimateKmh: number | null;
  estimatedVehicleSpeedKmh: number | null;
  relativeMotionEstimate: VehicleRelativeMotion;
  closingRisk: VehicleClosingRisk;
  closingRiskScore: number;
  motionBasis: string[];
  tracking: {
    displayState: VehicleLockDisplayState;
    trackConfidence: number;
    lockDurationMs: number;
    trackAgeFrames: number;
    trackStability: number;
    leadScore: number;
    predicted: boolean;
    lostForMs: number;
    association: "high_confidence" | "low_confidence" | "prediction";
  };
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
  relativeSpeedEstimateKmh: number | null;
  estimatedVehicleSpeedKmh: number | null;
  relativeMotionEstimate: VehicleRelativeMotion;
  closingRisk: VehicleClosingRisk;
  closingRiskScore: number;
  displayState: VehicleLockDisplayState;
  trackConfidence: number;
  lockDurationMs: number;
  trackStability: number;
  predicted: boolean;
  trackAgeFrames: number;
  lastSeenAt: number;
  evidence: VehicleTrackEvidence;
}

export interface HudFrame {
  timestamp: number;
  targets: HudTarget[];
  detections: VehicleTrackEvidence[];
  trackingState: VehicleLockDisplayState;
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

export interface IncidentUploadObject {
  id: string;
  kind: "video-chunk" | "video-clip" | "sensor-json";
  objectName: string;
  contentType: string;
  timestamp: number;
  uploadedAt: number;
  sizeBytes: number | null;
}

export interface RecordedVideoChunk {
  id: string;
  timestamp: number;
  blob: Blob;
  contentType: string;
}

export interface IncidentRecord {
  id: string;
  tokenHash: string;
  sessionId: string;
  driverName: string;
  emergencyContactPhone: string;
  createdAt: number;
  updatedAt: number;
  event: HighImpactEvent;
  protectedWindow: {
    start: number;
    end: number;
  };
  reviewUrl: string;
  lastKnownLocation: Pick<GpsSample, "latitude" | "longitude" | "accuracy" | "timestamp"> | null;
  speedBeforeMetresPerSecond: number | null;
  speedAfterMetresPerSecond: number | null;
  confidenceScore: number;
  lastUploadAt: number | null;
  uploads: IncidentUploadObject[];
  sms: {
    status: "not_configured" | "sent" | "failed";
    provider: "twilio" | "clicksend" | "none";
    sentAt: number | null;
    error: string | null;
  };
  warning: string;
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
  driverName: string;
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
