"use client";

import { useCallback, useRef } from "react";
import { createId } from "@/lib/drive-utils";
import type { GpsSample, HighImpactEvent, MotionSample } from "@/types/drive";

export function useHighImpactDetection(threshold: number, onEvent: (event: HighImpactEvent) => void) {
  const lastEventAtRef = useRef(0);
  const cooldownMs = 12000;

  return useCallback(
    (motionSamples: MotionSample[], gpsSamples: GpsSample[]) => {
      const latestMotion = motionSamples.at(-1);
      if (!latestMotion || Date.now() - lastEventAtRef.current < cooldownMs) return;

      const recentGps = gpsSamples.filter((sample) => latestMotion.timestamp - sample.timestamp <= 6000);
      const firstGps = recentGps.at(0);
      const lastGps = recentGps.at(-1);
      const speedBefore = firstGps?.speedMetresPerSecond ?? null;
      const speedAfter = lastGps?.speedMetresPerSecond ?? null;
      const rapidDrop =
        speedBefore !== null && speedAfter !== null && speedBefore > 8 && speedBefore - speedAfter > 7 && latestMotion.timestamp - (firstGps?.timestamp ?? 0) < 6000;
      const spike = latestMotion.magnitude >= threshold;

      if (!spike && !rapidDrop) return;
      lastEventAtRef.current = Date.now();
      onEvent({
        id: createId("impact"),
        timestamp: latestMotion.timestamp,
        confidence: spike && rapidDrop ? "high" : spike ? "medium" : "low",
        triggerReasons: [spike ? `Acceleration magnitude ${latestMotion.magnitude.toFixed(1)} m/s² exceeded threshold` : "", rapidDrop ? "GPS speed dropped rapidly in a short window" : ""].filter(Boolean),
        speedBefore,
        speedAfter,
        peakAccelerationMagnitude: latestMotion.magnitude,
        notes: "Possible High Impact. Review context before treating as evidence."
      });
    },
    [onEvent, threshold]
  );
}
