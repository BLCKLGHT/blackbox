"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { buildSummary, createId, createSession } from "@/lib/drive-utils";
import { createCloudIncident, uploadIncidentEvidence, type CloudIncidentHandle } from "@/lib/incident-client";
import { getImpactThreshold, loadSettings } from "@/lib/settings";
import { saveSession, saveVideoBlob } from "@/lib/storage";
import type { DriveSession, GpsSample, HighImpactEvent, HudOverlayMetrics, ManualMarker, MotionSample, OrientationSample, WeatherInfo } from "@/types/drive";
import { useGeolocationRecorder } from "./useGeolocationRecorder";
import { useHighImpactDetection } from "./useHighImpactDetection";
import { useMotionRecorder } from "./useMotionRecorder";
import { useVideoRecorder } from "./useVideoRecorder";
import type { CameraLens } from "@/types/drive";

type StartDriveOptions = {
  cameraLens: CameraLens;
  hudEnabled: boolean;
  liveAnalysisEnabled: boolean;
  plateOcrEnabled: boolean;
  hudSensitivityAuto: boolean;
  hudSensitivity: number;
};

export function useDriveSession() {
  const router = useRouter();
  const settings = useMemo(() => loadSettings(), []);
  const geo = useGeolocationRecorder();
  const motion = useMotionRecorder();
  const [weather, setWeather] = useState<WeatherInfo | null>(null);
  const [locationLabel, setLocationLabel] = useState<string | null>(null);
  const lastWeatherFetchRef = useRef({ timestamp: 0, latitude: 0, longitude: 0 });
  const lastLocationFetchRef = useRef({ timestamp: 0, latitude: 0, longitude: 0 });
  const getOverlayMetrics = useCallback(
    (): HudOverlayMetrics => {
      const acceleration = calculateLongitudinalAcceleration(geo.samplesRef.current);
      return {
        timestamp: Date.now(),
        ownSpeedMetresPerSecond: geo.latestGpsRef.current?.speedMetresPerSecond ?? null,
        longitudinalAccelerationMetresPerSecondSquared: acceleration,
        accelerationForceG: acceleration !== null && acceleration > 0 ? acceleration / 9.80665 : null,
        brakingForceG: acceleration !== null && acceleration < 0 ? Math.abs(acceleration) / 9.80665 : null,
        motionForceMetresPerSecondSquared: motion.latestMotionRef.current?.magnitude ?? null,
        latitude: geo.latestGpsRef.current?.latitude ?? null,
        longitude: geo.latestGpsRef.current?.longitude ?? null,
        locationLabel,
        weather,
        orientationAlpha: motion.latestOrientationRef.current?.alpha ?? null,
        orientationBeta: motion.latestOrientationRef.current?.beta ?? null,
        orientationGamma: motion.latestOrientationRef.current?.gamma ?? null
      };
    },
    [geo.latestGpsRef, geo.samplesRef, locationLabel, motion.latestMotionRef, motion.latestOrientationRef, weather]
  );
  const video = useVideoRecorder(settings.videoQuality, settings.audioRecording, getOverlayMetrics);
  const [session, setSession] = useState<DriveSession>(() => createSession(settings.retentionHours));
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [events, setEvents] = useState<HighImpactEvent[]>([]);
  const [manualMarkers, setManualMarkers] = useState<ManualMarker[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [gpsTrail, setGpsTrail] = useState(session.gpsSamples);
  const activeStartedAtRef = useRef(session.startedAt);
  const lastSessionSnapshotAtRef = useRef(0);
  const simulationDistanceRef = useRef(0);
  const simulationLastRef = useRef<{ timestamp: number; speed: number } | null>(null);
  const activeIncidentRef = useRef<{
    incident: CloudIncidentHandle;
    event: HighImpactEvent;
    uploadedIds: Set<string>;
    clipUploaded: boolean;
  } | null>(null);

  const uploadActiveIncident = useCallback(
    async (includeCombinedClip: boolean) => {
      const active = activeIncidentRef.current;
      if (!active) return;
      const { incident, event, uploadedIds } = active;
      const windowStart = incident.protectedWindow.start;
      const windowEnd = incident.protectedWindow.end;
      await uploadIncidentEvidence({
        incident,
        videoChunks: video.getChunksInWindow(windowStart, windowEnd),
        sensorWindow: {
          session: {
            id: session.id,
            startedAt: session.startedAt
          },
          event,
          gpsSamples: geo.samplesRef.current.filter((sample) => sample.timestamp >= windowStart && sample.timestamp <= windowEnd),
          motionSamples: motion.motionSamplesRef.current.filter((sample) => sample.timestamp >= windowStart && sample.timestamp <= windowEnd),
          orientationSamples: motion.orientationSamplesRef.current.filter((sample) => sample.timestamp >= windowStart && sample.timestamp <= windowEnd),
          hudFrames: video.hudFramesRef.current.filter((frame) => frame.timestamp >= windowStart && frame.timestamp <= windowEnd)
        },
        uploadedIds,
        includeCombinedClip: includeCombinedClip && !active.clipUploaded
      });
      if (includeCombinedClip) active.clipUploaded = true;
    },
    [geo.samplesRef, motion.motionSamplesRef, motion.orientationSamplesRef, session.id, session.startedAt, video]
  );

  const beginCloudIncident = useCallback(
    async (event: HighImpactEvent) => {
      if (settings.simulationMode) return;
      if (activeIncidentRef.current) return;
      try {
        const lastGps = geo.latestGpsRef.current;
        const incident = await createCloudIncident({
          sessionId: session.id,
          settings,
          event,
          lastKnownLocation: lastGps
            ? {
                latitude: lastGps.latitude,
                longitude: lastGps.longitude,
                accuracy: lastGps.accuracy,
                timestamp: lastGps.timestamp
              }
            : null
        });
        activeIncidentRef.current = {
          incident,
          event,
          uploadedIds: new Set(),
          clipUploaded: false
        };
        await uploadActiveIncident(false);
      } catch (error) {
        setWarnings((current) => [...current, error instanceof Error ? `Emergency cloud incident failed: ${error.message}` : "Emergency cloud incident failed."]);
      }
    },
    [geo.latestGpsRef, session.id, settings, uploadActiveIncident]
  );

  const addImpactEvent = useCallback((event: HighImpactEvent) => {
    setEvents((current) => [...current, event]);
    setSession((current) => ({ ...current, protected: true }));
    void beginCloudIncident(event);
  }, [beginCloudIncident]);
  const detectImpact = useHighImpactDetection(getImpactThreshold(settings.impactSensitivity), addImpactEvent);

  const start = useCallback(async (options: StartDriveOptions) => {
    const started = createSession(settings.retentionHours);
    activeIncidentRef.current = null;
    activeStartedAtRef.current = started.startedAt;
    lastSessionSnapshotAtRef.current = 0;
    simulationDistanceRef.current = 0;
    simulationLastRef.current = null;
    setSession(started);
    setWarnings([]);
    setElapsed(0);
    setGpsTrail([]);
    setEvents([]);
    setManualMarkers([]);
    setIsRecording(true);
    const videoPromise = video.start(options);
    const geoStarted = geo.start();
    const motionPromise = motion.start();
    const [videoStarted, motionStarted] = await Promise.all([videoPromise, motionPromise]);
    const nextWarnings = [video.error, settings.simulationMode ? null : geo.error, settings.simulationMode ? null : motion.error].filter((warning): warning is string => Boolean(warning));
    if (settings.simulationMode) nextWarnings.push("Simulation mode is active. GPS, braking, acceleration, gyro, and motion values are synthetic. Emergency cloud alerts are disabled.");
    if (!videoStarted) nextWarnings.push("Camera/video unavailable. Partial GPS and motion recording may continue.");
    if (!geoStarted && !settings.simulationMode) nextWarnings.push("Location unavailable. Video and motion can still continue.");
    if (!motionStarted && !settings.simulationMode) nextWarnings.push("Motion sensors unavailable. Video and GPS can still continue.");
    setWarnings(nextWarnings);
    setIsRecording(Boolean(videoStarted || geoStarted || motionStarted));
  }, [geo, motion, settings.retentionHours, settings.simulationMode, video]);

  const stop = useCallback(async () => {
    const gpsSamples = geo.stop();
    const { motionSamples, orientationSamples } = motion.stop();
    const videoBlob = await video.stop();
    await uploadActiveIncident(true).catch((error) => {
      setWarnings((current) => [...current, error instanceof Error ? `Final incident upload failed: ${error.message}` : "Final incident upload failed."]);
    });
    const endedAt = Date.now();
    let videoBlobId: string | null = null;
    if (videoBlob) {
      videoBlobId = createId("video");
      await saveVideoBlob(videoBlobId, videoBlob);
    }
    const finalSession: DriveSession = {
      ...session,
      endedAt,
      durationSeconds: Math.round((endedAt - session.startedAt) / 1000),
      videoBlobId,
      protected: session.protected || events.length > 0,
      gpsSamples,
      motionSamples,
      orientationSamples,
      hudFrames: video.hudFramesRef.current,
      highImpactEvents: events,
      manualMarkers,
      summary: buildSummary(gpsSamples, motionSamples, events, manualMarkers)
    };
    await saveSession(finalSession);
    setIsRecording(false);
    router.push("/review");
  }, [events, geo, manualMarkers, motion, router, session, uploadActiveIncident, video]);

  const markEvent = useCallback(() => {
    setManualMarkers((current) => [
      ...current,
      {
        id: createId("marker"),
        timestamp: Date.now(),
        label: "Manual marker",
        notes: "User marked an event during the drive."
      }
    ]);
  }, []);

  useEffect(() => {
    if (!isRecording) return;
    const updateRecordingState = () => {
      const now = Date.now();
      const duration = Math.max(0, Math.floor((now - activeStartedAtRef.current) / 1000));
      setElapsed(duration);
      if (now - lastSessionSnapshotAtRef.current < 5000) return;
      lastSessionSnapshotAtRef.current = now;
      setGpsTrail(geo.samplesRef.current.slice(-80));
      detectImpact(motion.motionSamplesRef.current, geo.samplesRef.current);
      const partial: DriveSession = {
        ...session,
        protected: session.protected || events.length > 0,
        durationSeconds: duration,
        gpsSamples: geo.samplesRef.current,
        motionSamples: motion.motionSamplesRef.current,
        orientationSamples: motion.orientationSamplesRef.current,
        hudFrames: video.hudFramesRef.current,
        highImpactEvents: events,
        manualMarkers,
        summary: buildSummary(geo.samplesRef.current, motion.motionSamplesRef.current, events, manualMarkers)
      };
      saveSession(partial).catch(console.error);
      const active = activeIncidentRef.current;
      if (active) {
        const includeCombinedClip = Date.now() >= active.incident.protectedWindow.end;
        uploadActiveIncident(includeCombinedClip)
          .then(() => {
            if (includeCombinedClip && active.clipUploaded && Date.now() > active.incident.protectedWindow.end + 5000) activeIncidentRef.current = null;
          })
          .catch((error) => {
            const message = error instanceof Error ? `Incident upload warning: ${error.message}` : "Incident upload warning.";
            setWarnings((current) => (current.includes(message) ? current : [...current, message]));
          });
      }
    };
    updateRecordingState();
    const timer = window.setInterval(updateRecordingState, 250);
    return () => window.clearInterval(timer);
  }, [detectImpact, events, geo.samplesRef, isRecording, manualMarkers, motion.motionSamplesRef, motion.orientationSamplesRef, session, uploadActiveIncident]);

  useEffect(() => {
    if (!isRecording || !settings.simulationMode) return;
    const tick = () => {
      const now = Date.now();
      const elapsedSeconds = (now - activeStartedAtRef.current) / 1000;
      const profile = simulationProfile(elapsedSeconds);
      const previous = simulationLastRef.current;
      const deltaSeconds = previous ? Math.max(0.05, (now - previous.timestamp) / 1000) : 0.25;
      const acceleration = previous ? (profile.speedMetresPerSecond - previous.speed) / deltaSeconds : profile.accelerationMetresPerSecondSquared;
      simulationDistanceRef.current += profile.speedMetresPerSecond * deltaSeconds;
      simulationLastRef.current = { timestamp: now, speed: profile.speedMetresPerSecond };

      const gpsSample: GpsSample = {
        timestamp: now,
        latitude: -42.8826,
        longitude: 147.3257 + simulationDistanceRef.current / 85000,
        accuracy: 4,
        speedMetresPerSecond: profile.speedMetresPerSecond,
        heading: 92,
        altitude: 18
      };
      const motionSample: MotionSample = {
        timestamp: now,
        accelerationX: acceleration,
        accelerationY: profile.braking ? -Math.abs(acceleration) * 0.18 : Math.max(0, acceleration) * 0.12,
        accelerationZ: 0.08 * Math.sin(elapsedSeconds * 3),
        accelerationIncludingGravityX: acceleration,
        accelerationIncludingGravityY: 0.2 * Math.sin(elapsedSeconds * 2.1),
        accelerationIncludingGravityZ: 9.81,
        rotationRateAlpha: 0.4 * Math.sin(elapsedSeconds * 0.4),
        rotationRateBeta: profile.braking ? -4.2 : profile.accelerationMetresPerSecondSquared > 0.2 ? 2.4 : 0.4,
        rotationRateGamma: 1.2 * Math.sin(elapsedSeconds * 0.7),
        interval: 250,
        magnitude: Math.abs(acceleration)
      };
      const orientationSample: OrientationSample = {
        timestamp: now,
        alpha: 1.5 * Math.sin(elapsedSeconds * 0.18),
        beta: profile.braking ? -5.5 : profile.accelerationMetresPerSecondSquared > 0.2 ? 3.2 : 0.8 * Math.sin(elapsedSeconds * 0.3),
        gamma: 2.2 * Math.sin(elapsedSeconds * 0.35)
      };
      geo.injectSample(gpsSample);
      motion.injectSamples(motionSample, orientationSample);
    };
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [geo.injectSample, isRecording, motion.injectSamples, settings.simulationMode]);

  useEffect(() => {
    const latest = geo.latestGps;
    if (!isRecording || !latest) return;
    const now = Date.now();
    const moved = Math.hypot(latest.latitude - lastWeatherFetchRef.current.latitude, latest.longitude - lastWeatherFetchRef.current.longitude) > 0.02;
    if (now - lastWeatherFetchRef.current.timestamp < 10 * 60 * 1000 && !moved) return;
    lastWeatherFetchRef.current.timestamp = now;
    lastWeatherFetchRef.current.latitude = latest.latitude;
    lastWeatherFetchRef.current.longitude = latest.longitude;
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latest.latitude}&longitude=${latest.longitude}&current=temperature_2m,weather_code,wind_speed_10m`)
      .then((response) => response.json())
      .then((data) => {
        setWeather({
          temperatureCelsius: typeof data?.current?.temperature_2m === "number" ? data.current.temperature_2m : null,
          windKmh: typeof data?.current?.wind_speed_10m === "number" ? data.current.wind_speed_10m : null,
          summary: weatherCodeLabel(data?.current?.weather_code),
          observedAt: Date.now()
        });
      })
      .catch(() => undefined);
  }, [geo.latestGps, isRecording]);

  useEffect(() => {
    const latest = geo.latestGps;
    if (!isRecording || !latest) return;
    if (settings.simulationMode) {
      setLocationLabel("Simulation Rd, Hobart 7000");
      return;
    }
    const now = Date.now();
    const moved = Math.hypot(latest.latitude - lastLocationFetchRef.current.latitude, latest.longitude - lastLocationFetchRef.current.longitude) > 0.002;
    if (now - lastLocationFetchRef.current.timestamp < 2 * 60 * 1000 && !moved) return;
    lastLocationFetchRef.current.timestamp = now;
    lastLocationFetchRef.current.latitude = latest.latitude;
    lastLocationFetchRef.current.longitude = latest.longitude;
    const controller = new AbortController();
    window.setTimeout(() => controller.abort(), 4500);
    fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latest.latitude}&lon=${latest.longitude}&zoom=18&addressdetails=1`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setLocationLabel(formatLocationLabel(data?.address)))
      .catch(() => undefined);
  }, [geo.latestGps, isRecording, settings.simulationMode]);

  return {
    settings,
    session,
    isRecording,
    elapsed,
    currentGps: geo.latestGps,
    locationLabel,
    weather,
    gpsTrail,
    currentMotion: motion.latestMotion,
    currentOrientation: motion.latestOrientation,
    stream: video.stream,
    hudTargets: video.hudTargets,
    videoSupported: video.recordingSupported,
    warnings: [...warnings, video.error, geo.error, motion.error].filter((warning): warning is string => Boolean(warning)),
    highImpactEvents: events,
    manualMarkers,
    start,
    stop,
    markEvent
  };
}

function weatherCodeLabel(code: unknown): string {
  if (typeof code !== "number") return "Weather";
  if (code === 0) return "Clear";
  if ([1, 2, 3].includes(code)) return "Clouds";
  if ([45, 48].includes(code)) return "Fog";
  if ([51, 53, 55, 56, 57].includes(code)) return "Drizzle";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "Rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Snow";
  if ([95, 96, 99].includes(code)) return "Storm";
  return "Weather";
}

function formatLocationLabel(address: Record<string, unknown> | null | undefined): string | null {
  if (!address) return null;
  const road = firstString(address.road, address.pedestrian, address.footway, address.cycleway, address.path);
  const suburb = firstString(address.suburb, address.neighbourhood, address.city_district, address.town, address.city, address.village);
  const postcode = firstString(address.postcode);
  const parts = [road, suburb, postcode].filter((part): part is string => Boolean(part));
  return parts.length ? parts.join(", ") : null;
}

function firstString(...values: unknown[]): string | null {
  const value = values.find((candidate) => typeof candidate === "string" && candidate.trim().length > 0);
  return typeof value === "string" ? value : null;
}

function calculateLongitudinalAcceleration(samples: { timestamp: number; speedMetresPerSecond: number | null }[]): number | null {
  const valid = samples.filter((sample) => sample.speedMetresPerSecond !== null);
  if (valid.length < 2) return null;
  const latest = valid[valid.length - 1];
  for (let index = valid.length - 2; index >= 0; index -= 1) {
    const previous = valid[index];
    const seconds = (latest.timestamp - previous.timestamp) / 1000;
    if (seconds < 0.35) continue;
    if (seconds > 4) break;
    return ((latest.speedMetresPerSecond ?? 0) - (previous.speedMetresPerSecond ?? 0)) / seconds;
  }
  return null;
}

function simulationProfile(elapsedSeconds: number): { speedMetresPerSecond: number; accelerationMetresPerSecondSquared: number; braking: boolean } {
  const cycle = elapsedSeconds % 48;
  if (cycle < 4) return { speedMetresPerSecond: 0, accelerationMetresPerSecondSquared: 0, braking: false };
  if (cycle < 14) {
    const acceleration = 1.7;
    return { speedMetresPerSecond: Math.min(16.7, (cycle - 4) * acceleration), accelerationMetresPerSecondSquared: acceleration, braking: false };
  }
  if (cycle < 22) return { speedMetresPerSecond: 16.7, accelerationMetresPerSecondSquared: 0, braking: false };
  if (cycle < 25) {
    const deceleration = -5.6;
    return { speedMetresPerSecond: Math.max(0, 16.7 + (cycle - 22) * deceleration), accelerationMetresPerSecondSquared: deceleration, braking: true };
  }
  if (cycle < 30) return { speedMetresPerSecond: 0, accelerationMetresPerSecondSquared: 0, braking: false };
  if (cycle < 39) {
    const acceleration = 1.25;
    return { speedMetresPerSecond: Math.min(11.1, (cycle - 30) * acceleration), accelerationMetresPerSecondSquared: acceleration, braking: false };
  }
  if (cycle < 43) return { speedMetresPerSecond: 11.1, accelerationMetresPerSecondSquared: 0, braking: false };
  const deceleration = -2.8;
  return { speedMetresPerSecond: Math.max(0, 11.1 + (cycle - 43) * deceleration), accelerationMetresPerSecondSquared: deceleration, braking: true };
}
