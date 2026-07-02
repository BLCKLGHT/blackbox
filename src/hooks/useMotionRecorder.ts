"use client";

import { useCallback, useRef, useState } from "react";
import { calculateMagnitude } from "@/lib/drive-utils";
import type { MotionSample, OrientationSample } from "@/types/drive";

type DeviceMotionPermissionEvent = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<PermissionState>;
};

export function useMotionRecorder() {
  const [latestMotion, setLatestMotion] = useState<MotionSample | null>(null);
  const [error, setError] = useState<string | null>(null);
  const motionSamplesRef = useRef<MotionSample[]>([]);
  const orientationSamplesRef = useRef<OrientationSample[]>([]);

  const requestMotionPermission = useCallback(async () => {
    if (typeof DeviceMotionEvent === "undefined") {
      setError("Motion sensors are not supported in this browser.");
      return false;
    }
    const motionEvent = DeviceMotionEvent as DeviceMotionPermissionEvent;
    if (typeof motionEvent.requestPermission === "function") {
      const result = await motionEvent.requestPermission();
      if (result !== "granted") {
        setError("Motion permission was denied. GPS and video can still continue.");
        return false;
      }
    }
    return true;
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
    if (motionSamplesRef.current.length % 5 === 0) setLatestMotion(sample);
  }, []);

  const onOrientation = useCallback((event: DeviceOrientationEvent) => {
    orientationSamplesRef.current.push({
      timestamp: Date.now(),
      alpha: event.alpha,
      beta: event.beta,
      gamma: event.gamma
    });
  }, []);

  const start = useCallback(async () => {
    const permitted = await requestMotionPermission();
    if (!permitted) return false;
    window.addEventListener("devicemotion", onMotion);
    window.addEventListener("deviceorientation", onOrientation);
    return true;
  }, [onMotion, onOrientation, requestMotionPermission]);

  const stop = useCallback(() => {
    window.removeEventListener("devicemotion", onMotion);
    window.removeEventListener("deviceorientation", onOrientation);
    return { motionSamples: motionSamplesRef.current, orientationSamples: orientationSamplesRef.current };
  }, [onMotion, onOrientation]);

  return { latestMotion, error, motionSamplesRef, orientationSamplesRef, start, stop };
}
