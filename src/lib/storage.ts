import type { DriveSession, GpsSample, MotionSample } from "@/types/drive";
import { csvEscape } from "@/lib/drive-utils";

const DB_NAME = "black-box-v4";
const DB_VERSION = 2;
const SESSION_STORE = "sessions";
const VIDEO_STORE = "videos";
const RECORDING_CHUNK_STORE = "recording-chunks";
const LAST_SESSION_KEY = "last";

type StoredRecordingChunk = {
  key: string;
  recordingId: string;
  sequence: number;
  blob: Blob;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SESSION_STORE)) db.createObjectStore(SESSION_STORE);
      if (!db.objectStoreNames.contains(VIDEO_STORE)) db.createObjectStore(VIDEO_STORE);
      if (!db.objectStoreNames.contains(RECORDING_CHUNK_STORE)) {
        const store = db.createObjectStore(RECORDING_CHUNK_STORE, { keyPath: "key" });
        store.createIndex("recordingId", "recordingId");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(storeName: string, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = run(tx.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function saveSession(session: DriveSession): Promise<void> {
  await withStore<IDBValidKey>(SESSION_STORE, "readwrite", (store) => store.put(session, LAST_SESSION_KEY));
}

export async function getLastSession(): Promise<DriveSession | null> {
  if (typeof indexedDB === "undefined") return null;
  return await withStore<DriveSession | undefined>(SESSION_STORE, "readonly", (store) => store.get(LAST_SESSION_KEY)).then((session) => session ?? null);
}

export async function deleteLastSession(): Promise<void> {
  const session = await getLastSession();
  await withStore<undefined>(SESSION_STORE, "readwrite", (store) => store.delete(LAST_SESSION_KEY));
  if (session?.videoBlobId) await deleteVideoBlob(session.videoBlobId);
}

export async function saveVideoBlob(id: string, blob: Blob): Promise<void> {
  await withStore<IDBValidKey>(VIDEO_STORE, "readwrite", (store) => store.put(blob, id));
}

export async function getVideoBlob(id: string): Promise<Blob | null> {
  return await withStore<Blob | undefined>(VIDEO_STORE, "readonly", (store) => store.get(id)).then((blob) => blob ?? null);
}

export async function deleteVideoBlob(id: string): Promise<void> {
  await withStore<undefined>(VIDEO_STORE, "readwrite", (store) => store.delete(id));
}

export async function saveRecordingChunk(recordingId: string, sequence: number, blob: Blob): Promise<void> {
  const chunk: StoredRecordingChunk = {
    key: `${recordingId}:${sequence.toString().padStart(8, "0")}`,
    recordingId,
    sequence,
    blob
  };
  await withStore<IDBValidKey>(RECORDING_CHUNK_STORE, "readwrite", (store) => store.put(chunk));
}

export async function getRecordingChunks(recordingId: string): Promise<Blob[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RECORDING_CHUNK_STORE, "readonly");
    const index = tx.objectStore(RECORDING_CHUNK_STORE).index("recordingId");
    const request = index.getAll(IDBKeyRange.only(recordingId));
    request.onsuccess = () => {
      const chunks = (request.result as StoredRecordingChunk[]).sort((a, b) => a.sequence - b.sequence);
      resolve(chunks.map((chunk) => chunk.blob));
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function deleteRecordingChunks(recordingId: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RECORDING_CHUNK_STORE, "readwrite");
    const index = tx.objectStore(RECORDING_CHUNK_STORE).index("recordingId");
    const request = index.openKeyCursor(IDBKeyRange.only(recordingId));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      tx.objectStore(RECORDING_CHUNK_STORE).delete(cursor.primaryKey);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function deleteExpiredSessions(): Promise<void> {
  const session = await getLastSession();
  if (session && !session.protected && session.expiresAt < Date.now()) await deleteLastSession();
}

export async function protectSession(): Promise<DriveSession | null> {
  const session = await getLastSession();
  if (!session) return null;
  const protectedSession = { ...session, protected: true };
  await saveSession(protectedSession);
  return protectedSession;
}

export function exportSessionJson(session: DriveSession): Blob {
  return new Blob([JSON.stringify(session, null, 2)], { type: "application/json" });
}

export function gpsCsv(samples: GpsSample[]): string {
  const headers = ["timestamp", "isoTime", "latitude", "longitude", "accuracy", "speedMetresPerSecond", "heading", "altitude"];
  const rows = samples.map((sample) =>
    [sample.timestamp, new Date(sample.timestamp).toISOString(), sample.latitude, sample.longitude, sample.accuracy, sample.speedMetresPerSecond, sample.heading, sample.altitude]
      .map(csvEscape)
      .join(",")
  );
  return [headers.join(","), ...rows].join("\n");
}

export function motionCsv(samples: MotionSample[]): string {
  const headers = [
    "timestamp",
    "isoTime",
    "accelerationX",
    "accelerationY",
    "accelerationZ",
    "accelerationIncludingGravityX",
    "accelerationIncludingGravityY",
    "accelerationIncludingGravityZ",
    "rotationRateAlpha",
    "rotationRateBeta",
    "rotationRateGamma",
    "interval",
    "magnitude"
  ];
  const rows = samples.map((sample) =>
    [
      sample.timestamp,
      new Date(sample.timestamp).toISOString(),
      sample.accelerationX,
      sample.accelerationY,
      sample.accelerationZ,
      sample.accelerationIncludingGravityX,
      sample.accelerationIncludingGravityY,
      sample.accelerationIncludingGravityZ,
      sample.rotationRateAlpha,
      sample.rotationRateBeta,
      sample.rotationRateGamma,
      sample.interval,
      sample.magnitude
    ]
      .map(csvEscape)
      .join(",")
  );
  return [headers.join(","), ...rows].join("\n");
}

export function exportSessionCsv(session: DriveSession, kind: "gps" | "motion"): Blob {
  const content = kind === "gps" ? gpsCsv(session.gpsSamples) : motionCsv(session.motionSamples);
  return new Blob([content], { type: "text/csv" });
}

export function buildTextSummary(session: DriveSession): Blob {
  const location = session.summary.lastKnownLocation;
  const lines = [
    "Black Box V4 Evidence Summary",
    "",
    `Drive start: ${new Date(session.startedAt).toLocaleString()}`,
    `Drive end: ${session.endedAt ? new Date(session.endedAt).toLocaleString() : "Unknown"}`,
    `Duration: ${session.durationSeconds} seconds`,
    `Max speed: ${(session.summary.maxSpeedMetresPerSecond * 3.6).toFixed(1)} km/h`,
    `Average speed: ${(session.summary.averageSpeedMetresPerSecond * 3.6).toFixed(1)} km/h`,
    `Number of GPS samples: ${session.summary.gpsSampleCount}`,
    `Number of motion samples: ${session.summary.motionSampleCount}`,
    `High-impact events: ${session.summary.highImpactEventCount}`,
    `Manual markers: ${session.summary.manualMarkerCount}`,
    `Last known location: ${location ? `${location.latitude}, ${location.longitude} accuracy ${location.accuracy ?? "unknown"}m` : "Unavailable"}`,
    "",
    session.summary.warning
  ];
  return new Blob([lines.join("\n")], { type: "text/plain" });
}
