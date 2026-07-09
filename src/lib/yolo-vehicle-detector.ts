"use client";

import type * as Ort from "onnxruntime-web/wasm";

export type VehicleClass = "car" | "bus" | "truck" | "motorcycle";

export type VehicleDetection = {
  id: string;
  label: VehicleClass;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
  appearanceSignature?: number[];
};

type Letterbox = {
  scale: number;
  padX: number;
  padY: number;
  sourceWidth: number;
  sourceHeight: number;
};

const COCO_VEHICLE_CLASSES: Record<number, VehicleClass> = {
  2: "car",
  3: "motorcycle",
  5: "bus",
  7: "truck"
};

const DEFAULT_MODEL_URL = "/models/yolov8n.onnx";
const ORT_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort.wasm.min.js";
const DEFAULT_INPUT_SIZE = 640;
const MAX_DETECTIONS = 24;
const NMS_IOU_THRESHOLD = 0.45;

declare global {
  interface Window {
    ort?: typeof Ort;
  }
}

let ortRuntimePromise: Promise<typeof Ort> | null = null;

export class YoloVehicleDetector {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  private constructor(
    private readonly ort: typeof import("onnxruntime-web/wasm"),
    private readonly session: Ort.InferenceSession,
    private readonly inputName: string,
    private readonly outputName: string,
    private readonly inputWidth: number,
    private readonly inputHeight: number
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = inputWidth;
    this.canvas.height = inputHeight;
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas preprocessing is unavailable in this browser.");
    this.ctx = ctx;
  }

  static async load(modelUrl = process.env.NEXT_PUBLIC_DASHCAM_YOLO_MODEL_URL ?? process.env.NEXT_PUBLIC_YOLO_MODEL_URL ?? DEFAULT_MODEL_URL): Promise<YoloVehicleDetector> {
    const ort = await loadOrtRuntime();
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/";

    const session = await ort.InferenceSession.create(modelUrl, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all"
    });
    const inputName = session.inputNames[0];
    const outputName = session.outputNames[0];
    return new YoloVehicleDetector(ort, session, inputName, outputName, DEFAULT_INPUT_SIZE, DEFAULT_INPUT_SIZE);
  }

  async detect(video: HTMLVideoElement, confidenceThreshold: number): Promise<VehicleDetection[]> {
    const { tensor, letterbox } = this.preprocess(video);
    const outputs = await this.session.run({ [this.inputName]: tensor });
    const output = outputs[this.outputName] ?? outputs[this.session.outputNames[0]];
    return decodeYoloOutput(output, letterbox, confidenceThreshold);
  }

  private preprocess(video: HTMLVideoElement): { tensor: Ort.Tensor; letterbox: Letterbox } {
    const sourceWidth = video.videoWidth || this.inputWidth;
    const sourceHeight = video.videoHeight || this.inputHeight;
    const scale = Math.min(this.inputWidth / sourceWidth, this.inputHeight / sourceHeight);
    const drawWidth = sourceWidth * scale;
    const drawHeight = sourceHeight * scale;
    const padX = (this.inputWidth - drawWidth) / 2;
    const padY = (this.inputHeight - drawHeight) / 2;

    this.ctx.fillStyle = "rgb(114,114,114)";
    this.ctx.fillRect(0, 0, this.inputWidth, this.inputHeight);
    this.ctx.drawImage(video, padX, padY, drawWidth, drawHeight);

    const image = this.ctx.getImageData(0, 0, this.inputWidth, this.inputHeight).data;
    const planeSize = this.inputWidth * this.inputHeight;
    const input = new Float32Array(planeSize * 3);
    for (let pixel = 0; pixel < planeSize; pixel += 1) {
      const offset = pixel * 4;
      input[pixel] = image[offset] / 255;
      input[pixel + planeSize] = image[offset + 1] / 255;
      input[pixel + planeSize * 2] = image[offset + 2] / 255;
    }

    return {
      tensor: new this.ort.Tensor("float32", input, [1, 3, this.inputHeight, this.inputWidth]),
      letterbox: { scale, padX, padY, sourceWidth, sourceHeight }
    };
  }
}

function decodeYoloOutput(output: Ort.Tensor, letterbox: Letterbox, confidenceThreshold: number): VehicleDetection[] {
  const data = output.data as Float32Array;
  const dims = output.dims;
  const candidates: VehicleDetection[] = [];

  if (dims.length === 3 && (dims[1] === 84 || dims[1] === 85 || dims[1] === 6)) {
    const features = dims[1];
    const boxes = dims[2];
    for (let index = 0; index < boxes; index += 1) {
      pushCandidate(candidates, data, index, features, boxes, true, letterbox, confidenceThreshold);
    }
  } else if (dims.length === 3 && (dims[2] === 84 || dims[2] === 85 || dims[2] === 6)) {
    const boxes = dims[1];
    const features = dims[2];
    for (let index = 0; index < boxes; index += 1) {
      pushCandidate(candidates, data, index, features, boxes, false, letterbox, confidenceThreshold);
    }
  }

  return nonMaxSuppression(candidates).slice(0, MAX_DETECTIONS);
}

function loadOrtRuntime(): Promise<typeof Ort> {
  if (window.ort) return Promise.resolve(window.ort);
  if (ortRuntimePromise) return ortRuntimePromise;
  ortRuntimePromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${ORT_SCRIPT_URL}"]`);
    const script = existing ?? document.createElement("script");
    script.src = ORT_SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      if (window.ort) resolve(window.ort);
      else reject(new Error("ONNX Runtime Web did not expose window.ort."));
    };
    script.onerror = () => reject(new Error("ONNX Runtime Web could not be loaded."));
    if (!existing) document.head.appendChild(script);
  });
  return ortRuntimePromise;
}

function pushCandidate(candidates: VehicleDetection[], data: Float32Array, index: number, features: number, boxes: number, transposed: boolean, letterbox: Letterbox, confidenceThreshold: number): void {
  const valueAt = (feature: number) => (transposed ? data[feature * boxes + index] : data[index * features + feature]);

  if (features === 6) {
    const classId = Math.round(valueAt(5));
    const label = COCO_VEHICLE_CLASSES[classId];
    const confidence = valueAt(4);
    if (!label || confidence < confidenceThreshold) return;
    const x1 = valueAt(0);
    const y1 = valueAt(1);
    const x2 = valueAt(2);
    const y2 = valueAt(3);
    candidates.push(toDetection(label, confidence, (x1 + x2) / 2, (y1 + y2) / 2, x2 - x1, y2 - y1, letterbox, candidates.length));
    return;
  }

  const classOffset = features === 85 ? 5 : 4;
  const objectness = features === 85 ? valueAt(4) : 1;
  let bestLabel: VehicleClass | null = null;
  let bestScore = 0;
  Object.entries(COCO_VEHICLE_CLASSES).forEach(([classId, label]) => {
    const score = objectness * valueAt(classOffset + Number(classId));
    if (score > bestScore) {
      bestScore = score;
      bestLabel = label;
    }
  });
  if (!bestLabel || bestScore < confidenceThreshold) return;
  candidates.push(toDetection(bestLabel, bestScore, valueAt(0), valueAt(1), valueAt(2), valueAt(3), letterbox, candidates.length));
}

function toDetection(label: VehicleClass, confidence: number, cx: number, cy: number, width: number, height: number, letterbox: Letterbox, index: number): VehicleDetection {
  const x = (cx - width / 2 - letterbox.padX) / letterbox.scale;
  const y = (cy - height / 2 - letterbox.padY) / letterbox.scale;
  return {
    id: `det-${index}`,
    label,
    confidence,
    x: clamp(x / letterbox.sourceWidth, 0, 1),
    y: clamp(y / letterbox.sourceHeight, 0, 1),
    width: clamp(width / letterbox.scale / letterbox.sourceWidth, 0, 1),
    height: clamp(height / letterbox.scale / letterbox.sourceHeight, 0, 1)
  };
}

function nonMaxSuppression(detections: VehicleDetection[]): VehicleDetection[] {
  const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);
  const kept: VehicleDetection[] = [];
  while (sorted.length) {
    const detection = sorted.shift();
    if (!detection) break;
    kept.push(detection);
    for (let index = sorted.length - 1; index >= 0; index -= 1) {
      if (sorted[index].label === detection.label && boxIoU(sorted[index], detection) > NMS_IOU_THRESHOLD) sorted.splice(index, 1);
    }
  }
  return kept;
}

function boxIoU(a: Pick<VehicleDetection, "x" | "y" | "width" | "height">, b: Pick<VehicleDetection, "x" | "y" | "width" | "height">): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
