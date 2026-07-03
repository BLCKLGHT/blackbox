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
  const lastMotionUiAtRef = useRef(0);
  const lastOrientationUiAtRef = useRef(0);

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
    motionSamplesRef.current.push(sample);
    if (sample.timestamp - lastMotionUiAtRef.current > 100) {
      lastMotionUiAtRef.current = sample.timestamp;
      setLatestMotion(sample);
    }
  }, []);

  const onOrientation = useCallback((event: DeviceOrientationEvent) => {
    const sample = {
      timestamp: Date.now(),
      alpha: event.alpha,
      beta: event.beta,
      gamma: event.gamma
    };
    orientationSamplesRef.current.push(sample);
    if (sample.timestamp - lastOrientationUiAtRef.current > 100) {
      lastOrientationUiAtRef.current = sample.timestamp;
      setLatestOrientation(sample);
    }
  }, []);

  const start = useCallback(async () => {
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

  return { latestMotion, latestOrientation, error, motionSamplesRef, orientationSamplesRef, start, stop };
}
