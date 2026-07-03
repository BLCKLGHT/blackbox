"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { buildSummary, createId, createSession } from "@/lib/drive-utils";
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

  const addImpactEvent = useCallback((event: HighImpactEvent) => {
    setEvents((current) => [...current, event]);
  }, []);
  const detectImpact = useHighImpactDetection(getImpactThreshold(settings.impactSensitivity), addImpactEvent);

  const start = useCallback(async (options: StartDriveOptions) => {
    const started = createSession(settings.retentionHours);
    setSession(started);
    setWarnings([]);
    setElapsed(0);
    setGpsTrail([]);
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
  }, [events, geo, manualMarkers, motion, router, session, video]);

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
    const timer = window.setInterval(() => {
      const duration = Math.round((Date.now() - session.startedAt) / 1000);
      setElapsed(duration);
      setGpsTrail(geo.samplesRef.current.slice(-80));
      detectImpact(motion.motionSamplesRef.current, geo.samplesRef.current);
      const partial: DriveSession = {
        ...session,
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
    }, 1000);
    return () => window.clearInterval(timer);
  }, [detectImpact, events, geo.samplesRef, isRecording, manualMarkers, motion.motionSamplesRef, motion.orientationSamplesRef, session]);

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
