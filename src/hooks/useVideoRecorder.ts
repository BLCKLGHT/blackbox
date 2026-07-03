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
  const mimeTypeRef = useRef("video/webm");

  const getSupportedMimeType = useCallback(() => {
    if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return "";
    const candidates = ["video/mp4;codecs=h264", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
    return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
  }, []);

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

      const mimeType = getSupportedMimeType();
      const recorder = mimeType ? new MediaRecorder(mediaStream, { mimeType }) : new MediaRecorder(mediaStream);
      mimeTypeRef.current = recorder.mimeType || mimeType || "video/webm";
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
        resolve(chunksRef.current.length ? new Blob(chunksRef.current, { type: mimeTypeRef.current }) : null);
        return;
      }
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        window.setTimeout(() => {
          resolve(chunksRef.current.length ? new Blob(chunksRef.current, { type: recorder.mimeType || mimeTypeRef.current }) : null);
        }, 80);
      };
      if (typeof recorder.requestData === "function") recorder.requestData();
      recorder.stop();
    });
    stream?.getTracks().forEach((track) => track.stop());
    setStream(null);
    return stopped;
  }, [stream]);

  return { stream, recordingSupported, error, start, stop };
}
