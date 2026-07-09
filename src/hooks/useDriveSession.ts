"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { buildSummary, createId, createSession } from "@/lib/drive-utils";
import { createCloudIncident, uploadIncidentEvidence, type CloudIncidentHandle } from "@/lib/incident-client";
import { getImpactThreshold, loadSettings } from "@/lib/settings";
import { saveSession, saveVideoBlob } from "@/lib/storage";
import type { DriveSession, HighImpactEvent, HudOverlayMetrics, ManualMarker, WeatherInfo } from "@/types/drive";
import { useGeolocationRecorder } from "./useGeolocationRecorder";
import { useHighImpactDetection } from "./useHighImpactDetection";
import { useMotionRecorder } from "./useMotionRecorder";
import { useVideoRecorder } from "./useVideoRecorder";
import type { CameraLens } from "@/types/drive";

type StartDriveOptions = {
  cameraLens: CameraLens;
  hudEnabled: boolean;
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
  const lastWeatherFetchRef = useRef({ timestamp: 0, latitude: 0, longitude: 0 });
  const getOverlayMetrics = useCallback(
    (): HudOverlayMetrics => ({
      timestamp: Date.now(),
      ownSpeedMetresPerSecond: geo.latestGpsRef.current?.speedMetresPerSecond ?? null,
      latitude: geo.latestGpsRef.current?.latitude ?? null,
      longitude: geo.latestGpsRef.current?.longitude ?? null,
      weather
    }),
    [geo.latestGpsRef, weather]
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
    const nextWarnings = [video.error, geo.error, motion.error].filter((warning): warning is string => Boolean(warning));
    if (!videoStarted) nextWarnings.push("Camera/video unavailable. Partial GPS and motion recording may continue.");
    if (!geoStarted) nextWarnings.push("Location unavailable. Video and motion can still continue.");
    if (!motionStarted) nextWarnings.push("Motion sensors unavailable. Video and GPS can still continue.");
    setWarnings(nextWarnings);
    setIsRecording(Boolean(videoStarted || geoStarted || motionStarted));
  }, [geo, motion, settings.retentionHours, video]);

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

  return {
    settings,
    session,
    isRecording,
    elapsed,
    currentGps: geo.latestGps,
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
