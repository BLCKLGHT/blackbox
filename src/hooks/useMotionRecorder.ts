"use client";

import { useCallback, useRef, useState } from "react";
import { calculateMagnitude } from "@/lib/drive-utils";
import type { MotionSample, OrientationSample } from "@/types/drive";

type DeviceMotionPermissionEvent = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<PermissionState>;
};

type DeviceOrientationPermissionEvent = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<PermissionState>;
};

export function useMotionRecorder() {
  const [latestMotion, setLatestMotion] = useState<MotionSample | null>(null);
  const [latestOrientation, setLatestOrientation] = useState<OrientationSample | null>(null);
  const [error, setError] = useState<string | null>(null);
  const motionSamplesRef = useRef<MotionSample[]>([]);
  const orientationSamplesRef = useRef<OrientationSample[]>([]);
  const latestMotionRef = useRef<MotionSample | null>(null);
  const latestOrientationRef = useRef<OrientationSample | null>(null);
  const lastMotionUiAtRef = useRef(0);
  const lastOrientationUiAtRef = useRef(0);
  const lastMotionStoredAtRef = useRef(0);
  const lastOrientationStoredAtRef = useRef(0);
  const orientationBaselineRef = useRef<OrientationSample | null>(null);

  const requestMotionPermission = useCallback(() => {
    if (typeof DeviceMotionEvent === "undefined") {
      return Promise.resolve<PermissionState>("denied");
    }
    const motionEvent = DeviceMotionEvent as DeviceMotionPermissionEvent;
    if (typeof motionEvent.requestPermission === "function") {
      return motionEvent.requestPermission();
    }
    return Promise.resolve<PermissionState>("granted");
  }, []);

  const requestOrientationPermission = useCallback(() => {
    if (typeof DeviceOrientationEvent === "undefined") {
      return Promise.resolve<PermissionState>("denied");
    }
    const orientationEvent = DeviceOrientationEvent as DeviceOrientationPermissionEvent;
    if (typeof orientationEvent.requestPermission === "function") {
      return orientationEvent.requestPermission();
    }
    return Promise.resolve<PermissionState>("granted");
  }, []);

  const onMotion = useCallback((event: DeviceMotionEvent) => {
    const magnitude = calculateMagnitude(event.acceleration?.x ?? null, event.acceleration?.y ?? null, event.acceleration?.z ?? null);
    const sample: MotionSample = {
      timestamp: Date.now(),
      accelerationX: event.acceleration?.x ?? null,
      accelerationY: event.acceleration?.y ?? null,
      accelerationZ: event.acceleration?.z ?? null,
      accelerationIncludingGravityX: event.accelerationIncludingGravity?.x ?? null,
      accelerationIncludingGravityY: event.accelerationIncludingGravity?.y ?? null,
      accelerationIncludingGravityZ: event.accelerationIncludingGravity?.z ?? null,
      rotationRateAlpha: event.rotationRate?.alpha ?? null,
      rotationRateBeta: event.rotationRate?.beta ?? null,
      rotationRateGamma: event.rotationRate?.gamma ?? null,
      interval: event.interval ?? null,
      magnitude
    };
    latestMotionRef.current = sample;
    if (sample.timestamp - lastMotionStoredAtRef.current >= 100) {
      lastMotionStoredAtRef.current = sample.timestamp;
      motionSamplesRef.current.push(sample);
    }
    if (sample.timestamp - lastMotionUiAtRef.current > 100) {
      lastMotionUiAtRef.current = sample.timestamp;
      setLatestMotion(sample);
    }
  }, []);

  const onOrientation = useCallback((event: DeviceOrientationEvent) => {
    const rawSample: OrientationSample = {
      timestamp: Date.now(),
      alpha: event.alpha,
      beta: event.beta,
      gamma: event.gamma
    };
    if (!orientationBaselineRef.current) orientationBaselineRef.current = rawSample;
    const baseline = orientationBaselineRef.current;
    const zeroedSample: OrientationSample = {
      timestamp: rawSample.timestamp,
      alpha: zeroAngle(rawSample.alpha, baseline.alpha),
      beta: zeroLinear(rawSample.beta, baseline.beta),
      gamma: zeroLinear(rawSample.gamma, baseline.gamma)
    };
    latestOrientationRef.current = zeroedSample;
    if (zeroedSample.timestamp - lastOrientationStoredAtRef.current >= 100) {
      lastOrientationStoredAtRef.current = zeroedSample.timestamp;
      orientationSamplesRef.current.push(rawSample);
    }
    if (zeroedSample.timestamp - lastOrientationUiAtRef.current > 100) {
      lastOrientationUiAtRef.current = zeroedSample.timestamp;
      setLatestOrientation(zeroedSample);
    }
  }, []);

  const start = useCallback(async () => {
    motionSamplesRef.current = [];
    orientationSamplesRef.current = [];
    orientationBaselineRef.current = null;
    lastMotionUiAtRef.current = 0;
    lastOrientationUiAtRef.current = 0;
    lastMotionStoredAtRef.current = 0;
    lastOrientationStoredAtRef.current = 0;
    setLatestMotion(null);
    setLatestOrientation(null);
    latestMotionRef.current = null;
    latestOrientationRef.current = null;
    setError(null);
    const motionPermissionPromise = requestMotionPermission();
    const orientationPermissionPromise = requestOrientationPermission();
    const [motionPermission, orientationPermission] = await Promise.all([motionPermissionPromise, orientationPermissionPromise]);
    const motionGranted = motionPermission === "granted";
    const orientationGranted = orientationPermission === "granted";

    if (motionGranted) window.addEventListener("devicemotion", onMotion);
    if (orientationGranted) window.addEventListener("deviceorientation", onOrientation);

    if (!motionGranted && !orientationGranted) {
      setError("Motion and gyro permission were denied or unavailable. GPS and video can still continue.");
      return false;
    }
    if (!orientationGranted) setError("Gyro orientation permission was denied or unavailable. Motion force may still continue.");
    if (!motionGranted) setError("Motion permission was denied or unavailable. Gyro orientation may still continue.");
    return true;
  }, [onMotion, onOrientation, requestMotionPermission, requestOrientationPermission]);

  const stop = useCallback(() => {
    window.removeEventListener("devicemotion", onMotion);
    window.removeEventListener("deviceorientation", onOrientation);
    return { motionSamples: motionSamplesRef.current, orientationSamples: orientationSamplesRef.current };
  }, [onMotion, onOrientation]);

  const injectSamples = useCallback((motionSample: MotionSample, orientationSample: OrientationSample) => {
    motionSamplesRef.current.push(motionSample);
    orientationSamplesRef.current.push(orientationSample);
    latestMotionRef.current = motionSample;
    latestOrientationRef.current = orientationSample;
    setLatestMotion(motionSample);
    setLatestOrientation(orientationSample);
  }, []);

  return { latestMotion, latestOrientation, latestMotionRef, latestOrientationRef, error, motionSamplesRef, orientationSamplesRef, start, stop, injectSamples };
}

function zeroLinear(value: number | null, baseline: number | null): number | null {
  if (value === null || baseline === null) return value;
  return value - baseline;
}

function zeroAngle(value: number | null, baseline: number | null): number | null {
  if (value === null || baseline === null) return value;
  const diff = value - baseline;
  if (diff > 180) return diff - 360;
  if (diff < -180) return diff + 360;
  return diff;
}
