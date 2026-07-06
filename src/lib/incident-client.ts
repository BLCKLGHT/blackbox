"use client";

import type { AppSettings, DriveSession, GpsSample, HighImpactEvent, HudFrame, IncidentUploadObject, MotionSample, OrientationSample, RecordedVideoChunk } from "@/types/drive";

export type CloudIncidentHandle = {
  incidentId: string;
  token: string;
  reviewUrl: string;
  protectedWindow: {
    start: number;
    end: number;
  };
};

type SensorWindow = {
  session: Pick<DriveSession, "id" | "startedAt">;
  event: HighImpactEvent;
  gpsSamples: GpsSample[];
  motionSamples: MotionSample[];
  orientationSamples: OrientationSample[];
  hudFrames: HudFrame[];
};

type UploadableIncidentFile = {
  id: string;
  filename: string;
  contentType: string;
  kind: IncidentUploadObject["kind"];
  timestamp: number;
  blob: Blob;
};

export async function createCloudIncident(input: {
  sessionId: string;
  settings: AppSettings;
  event: HighImpactEvent;
  lastKnownLocation: Pick<GpsSample, "latitude" | "longitude" | "accuracy" | "timestamp"> | null;
}): Promise<CloudIncidentHandle> {
  const response = await fetch("/api/incidents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: input.sessionId,
      driverName: input.settings.driverName,
      emergencyContactPhone: input.settings.emergencyContact.phone,
      event: input.event,
      lastKnownLocation: input.lastKnownLocation
    })
  });
  if (!response.ok) throw new Error(await responseText(response, "Could not create cloud incident."));
  return (await response.json()) as CloudIncidentHandle;
}

export async function uploadIncidentEvidence(input: {
  incident: CloudIncidentHandle;
  videoChunks: RecordedVideoChunk[];
  sensorWindow: SensorWindow;
  uploadedIds: Set<string>;
  includeCombinedClip: boolean;
}): Promise<void> {
  const files: UploadableIncidentFile[] = [];
  input.videoChunks.forEach((chunk) => {
    if (input.uploadedIds.has(chunk.id)) return;
    files.push({
      id: chunk.id,
      filename: `${chunk.id}.${extensionFor(chunk.contentType)}`,
      contentType: chunk.contentType || "video/webm",
      kind: "video-chunk",
      timestamp: chunk.timestamp,
      blob: chunk.blob
    });
  });

  const sensorId = `sensor-${Date.now()}`;
  if (!input.uploadedIds.has(sensorId)) {
    files.push({
      id: sensorId,
      filename: `${sensorId}.json`,
      contentType: "application/json",
      kind: "sensor-json",
      timestamp: Date.now(),
      blob: new Blob([JSON.stringify(input.sensorWindow, null, 2)], { type: "application/json" })
    });
  }

  if (input.includeCombinedClip && input.videoChunks.length) {
    const clipId = `incident-clip-${input.incident.incidentId}`;
    if (!input.uploadedIds.has(clipId)) {
      const contentType = input.videoChunks[0]?.contentType || "video/webm";
      files.push({
        id: clipId,
        filename: `${clipId}.${extensionFor(contentType)}`,
        contentType,
        kind: "video-clip",
        timestamp: input.incident.protectedWindow.start,
        blob: new Blob(input.videoChunks.map((chunk) => chunk.blob), { type: contentType })
      });
    }
  }

  if (!files.length) return;

  const signed = await fetch(`/api/incidents/${input.incident.incidentId}/uploads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: input.incident.token,
      files: files.map(({ blob: _blob, ...file }) => file)
    })
  });
  if (!signed.ok) throw new Error(await responseText(signed, "Could not sign incident uploads."));
  const { uploads } = (await signed.json()) as {
    uploads: Array<Omit<UploadableIncidentFile, "blob"> & { objectName: string; uploadUrl: string }>;
  };

  const completed: IncidentUploadObject[] = [];
  for (const upload of uploads) {
    const file = files.find((candidate) => candidate.id === upload.id);
    if (!file) continue;
    const put = await fetch(upload.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": file.contentType },
      body: file.blob
    });
    if (!put.ok) throw new Error(`Incident upload failed for ${file.filename}.`);
    input.uploadedIds.add(file.id);
    completed.push({
      id: file.id,
      kind: file.kind,
      objectName: upload.objectName,
      contentType: file.contentType,
      timestamp: file.timestamp,
      uploadedAt: Date.now(),
      sizeBytes: file.blob.size
    });
  }

  if (completed.length) {
    const response = await fetch(`/api/incidents/${input.incident.incidentId}/uploads`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: input.incident.token, uploads: completed })
    });
    if (!response.ok) throw new Error(await responseText(response, "Could not update incident upload metadata."));
  }
}

function extensionFor(contentType: string): string {
  if (contentType.includes("mp4")) return "mp4";
  if (contentType.includes("json")) return "json";
  return "webm";
}

async function responseText(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}
