"use client";

import { useCallback, useRef, useState } from "react";
import type { GpsSample } from "@/types/drive";

export function useGeolocationRecorder() {
  const [latestGps, setLatestGps] = useState<GpsSample | null>(null);
  const [error, setError] = useState<string | null>(null);
  const samplesRef = useRef<GpsSample[]>([]);
  const watchIdRef = useRef<number | null>(null);

  const start = useCallback(() => {
    if (!navigator.geolocation) {
      setError("Location is not supported in this browser.");
      return false;
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const sample: GpsSample = {
          timestamp: position.timestamp || Date.now(),
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          speedMetresPerSecond: position.coords.speed,
          heading: position.coords.heading,
          altitude: position.coords.altitude
        };
        samplesRef.current.push(sample);
        setLatestGps(sample);
      },
      (geoError) => setError(geoError.message),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );
    return true;
  }, []);

  const stop = useCallback(() => {
    if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
    watchIdRef.current = null;
    return samplesRef.current;
  }, []);

  return { latestGps, error, samplesRef, start, stop };
}
