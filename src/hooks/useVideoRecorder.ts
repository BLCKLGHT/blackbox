"use client";

import { useCallback, useRef, useState } from "react";
import { getVideoConstraints } from "@/lib/settings";
import type { VideoQuality } from "@/types/drive";

export function useVideoRecorder(quality: VideoQuality, audio: boolean) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [recordingSupported, setRecordingSupported] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera access is not supported in this browser.");
      return false;
    }
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: getVideoConstraints(quality),
        audio
      });
      setStream(mediaStream);

      if (typeof MediaRecorder === "undefined") {
        setRecordingSupported(false);
        setError("Video recording is not supported in this browser. Sensor and GPS logging can still continue.");
        return true;
      }

      const recorder = new MediaRecorder(mediaStream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.start(1000);
      recorderRef.current = recorder;
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Camera permission was denied.");
      return false;
    }
  }, [audio, quality]);

  const stop = useCallback(async () => {
    const recorder = recorderRef.current;
    const stopped = new Promise<Blob | null>((resolve) => {
      if (!recorder || recorder.state === "inactive") {
        resolve(chunksRef.current.length ? new Blob(chunksRef.current, { type: "video/webm" }) : null);
        return;
      }
      recorder.onstop = () => resolve(chunksRef.current.length ? new Blob(chunksRef.current, { type: recorder.mimeType || "video/webm" }) : null);
      recorder.stop();
    });
    stream?.getTracks().forEach((track) => track.stop());
    setStream(null);
    return stopped;
  }, [stream]);

  return { stream, recordingSupported, error, start, stop };
}
