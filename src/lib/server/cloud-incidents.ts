import "server-only";

import crypto from "node:crypto";
import { Storage } from "@google-cloud/storage";
import { EVIDENCE_WARNING } from "@/lib/drive-utils";
import type { GpsSample, HighImpactEvent, IncidentRecord, IncidentUploadObject } from "@/types/drive";

type CreateIncidentInput = {
  sessionId: string;
  driverName: string;
  emergencyContactPhone: string;
  event: HighImpactEvent;
  lastKnownLocation: Pick<GpsSample, "latitude" | "longitude" | "accuracy" | "timestamp"> | null;
  origin: string;
};

type UploadRequest = {
  id: string;
  filename: string;
  contentType: string;
  kind: IncidentUploadObject["kind"];
  timestamp: number;
};

let storageInstance: Storage | null = null;

export function createToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function verifyIncidentToken(record: IncidentRecord, token: string | null): boolean {
  return Boolean(token && crypto.timingSafeEqual(Buffer.from(record.tokenHash), Buffer.from(hashToken(token))));
}

export async function createIncidentRecord(input: CreateIncidentInput): Promise<{ record: IncidentRecord; token: string }> {
  const incidentId = createIncidentId();
  const token = createToken();
  const reviewUrl = `${input.origin}/incident/${incidentId}?token=${encodeURIComponent(token)}`;
  const record: IncidentRecord = {
    id: incidentId,
    tokenHash: hashToken(token),
    sessionId: input.sessionId,
    driverName: input.driverName || "Unknown driver",
    emergencyContactPhone: input.emergencyContactPhone,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    event: input.event,
    protectedWindow: {
      start: input.event.timestamp - 2 * 60 * 1000,
      end: input.event.timestamp + 2 * 60 * 1000
    },
    reviewUrl,
    lastKnownLocation: input.lastKnownLocation,
    speedBeforeMetresPerSecond: input.event.speedBefore,
    speedAfterMetresPerSecond: input.event.speedAfter,
    confidenceScore: confidenceScore(input.event),
    lastUploadAt: null,
    uploads: [],
    sms: {
      status: "not_configured",
      provider: "none",
      sentAt: null,
      error: null
    },
    warning: EVIDENCE_WARNING
  };
  await writeIncidentRecord(record);
  return { record, token };
}

export async function getIncidentRecord(incidentId: string): Promise<IncidentRecord | null> {
  const file = incidentFile(incidentId);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [contents] = await file.download();
  return JSON.parse(contents.toString("utf8")) as IncidentRecord;
}

export async function writeIncidentRecord(record: IncidentRecord): Promise<void> {
  const updated: IncidentRecord = { ...record, updatedAt: Date.now() };
  await incidentFile(record.id).save(JSON.stringify(updated, null, 2), {
    contentType: "application/json",
    resumable: false,
    metadata: {
      cacheControl: "no-store"
    }
  });
}

export async function createSignedUploadUrls(incidentId: string, files: UploadRequest[]): Promise<Array<UploadRequest & { objectName: string; uploadUrl: string }>> {
  const expires = Date.now() + 15 * 60 * 1000;
  return await Promise.all(
    files.map(async (file) => {
      const objectName = `incidents/${incidentId}/uploads/${file.kind}/${safeObjectPart(file.timestamp.toString())}-${safeObjectPart(file.filename)}`;
      const [uploadUrl] = await bucket()
        .file(objectName)
        .getSignedUrl({
          version: "v4",
          action: "write",
          expires,
          contentType: file.contentType
        });
      return { ...file, objectName, uploadUrl };
    })
  );
}

export async function createSignedReadUrl(objectName: string): Promise<string> {
  const [url] = await bucket()
    .file(objectName)
    .getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + 60 * 60 * 1000
    });
  return url;
}

export async function appendIncidentUploads(incidentId: string, uploads: IncidentUploadObject[]): Promise<IncidentRecord | null> {
  const record = await getIncidentRecord(incidentId);
  if (!record) return null;
  const known = new Set(record.uploads.map((upload) => upload.objectName));
  const nextUploads = [...record.uploads];
  uploads.forEach((upload) => {
    if (!known.has(upload.objectName)) nextUploads.push(upload);
  });
  const updated: IncidentRecord = {
    ...record,
    lastUploadAt: uploads.length ? Date.now() : record.lastUploadAt,
    uploads: nextUploads.sort((a, b) => a.timestamp - b.timestamp)
  };
  await writeIncidentRecord(updated);
  return updated;
}

export async function sendIncidentSms(record: IncidentRecord): Promise<IncidentRecord> {
  if (!record.emergencyContactPhone) {
    const updated = { ...record, sms: { status: "not_configured", provider: "none", sentAt: null, error: "No emergency contact phone configured." } } satisfies IncidentRecord;
    await writeIncidentRecord(updated);
    return updated;
  }

  const message = buildIncidentSms(record);
  try {
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER) {
      await sendTwilioSms(record.emergencyContactPhone, message);
      const updated = { ...record, sms: { status: "sent", provider: "twilio", sentAt: Date.now(), error: null } } satisfies IncidentRecord;
      await writeIncidentRecord(updated);
      return updated;
    }
    if (process.env.CLICKSEND_USERNAME && process.env.CLICKSEND_API_KEY) {
      await sendClickSendSms(record.emergencyContactPhone, message);
      const updated = { ...record, sms: { status: "sent", provider: "clicksend", sentAt: Date.now(), error: null } } satisfies IncidentRecord;
      await writeIncidentRecord(updated);
      return updated;
    }
    const updated = { ...record, sms: { status: "not_configured", provider: "none", sentAt: null, error: "No SMS provider environment variables configured." } } satisfies IncidentRecord;
    await writeIncidentRecord(updated);
    return updated;
  } catch (error) {
    const updated = {
      ...record,
      sms: {
        status: "failed",
        provider: process.env.TWILIO_ACCOUNT_SID ? "twilio" : process.env.CLICKSEND_USERNAME ? "clicksend" : "none",
        sentAt: null,
        error: error instanceof Error ? error.message : "SMS send failed."
      }
    } satisfies IncidentRecord;
    await writeIncidentRecord(updated);
    return updated;
  }
}

function buildIncidentSms(record: IncidentRecord): string {
  const location = record.lastKnownLocation ? `${record.lastKnownLocation.latitude.toFixed(5)}, ${record.lastKnownLocation.longitude.toFixed(5)}` : "Unknown";
  return [
    "Black Box detected a possible high-impact vehicle incident.",
    `Driver name: ${record.driverName || "Unknown driver"}`,
    `Timestamp: ${new Date(record.event.timestamp).toLocaleString()}`,
    `Last known location: ${location}`,
    `Private review link: ${record.reviewUrl}`
  ].join("\n");
}

async function sendTwilioSms(to: string, body: string): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!accountSid || !authToken || !from) throw new Error("Twilio is not configured.");
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({ To: to, From: from, Body: body })
  });
  if (!response.ok) throw new Error(`Twilio SMS failed with HTTP ${response.status}.`);
}

async function sendClickSendSms(to: string, body: string): Promise<void> {
  const username = process.env.CLICKSEND_USERNAME;
  const apiKey = process.env.CLICKSEND_API_KEY;
  if (!username || !apiKey) throw new Error("ClickSend is not configured.");
  const response = await fetch("https://rest.clicksend.com/v3/sms/send", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${username}:${apiKey}`).toString("base64")}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messages: [
        {
          source: process.env.CLICKSEND_SOURCE ?? "BlackBox",
          to,
          body
        }
      ]
    })
  });
  if (!response.ok) throw new Error(`ClickSend SMS failed with HTTP ${response.status}.`);
}

function confidenceScore(event: HighImpactEvent): number {
  if (event.confidence === "high") return 0.92;
  if (event.confidence === "medium") return 0.68;
  return 0.42;
}

function incidentFile(incidentId: string) {
  return bucket().file(`incidents/${incidentId}/record.json`);
}

function bucket() {
  const bucketName = process.env.GCS_BUCKET_NAME;
  if (!bucketName) throw new Error("GCS_BUCKET_NAME is not configured.");
  return storage().bucket(bucketName);
}

function storage(): Storage {
  if (storageInstance) return storageInstance;
  const clientEmail = process.env.GCP_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GCP_PRIVATE_KEY?.replace(/\\n/g, "\n");
  storageInstance =
    clientEmail && privateKey
      ? new Storage({
          projectId: process.env.GCP_PROJECT_ID,
          credentials: { client_email: clientEmail, private_key: privateKey }
        })
      : new Storage({ projectId: process.env.GCP_PROJECT_ID });
  return storageInstance;
}

function createIncidentId(): string {
  return `incident-${Date.now()}-${crypto.randomBytes(5).toString("hex")}`;
}

function safeObjectPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 96);
}
