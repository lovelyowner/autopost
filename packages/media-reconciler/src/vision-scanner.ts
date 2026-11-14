import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { FFMPEG_BIN, probe, runProcess } from "./ffprobe";

export type RoiBox = [x: number, y: number, w: number, h: number];

export interface Detection {
  label: string;
  score: number;
  box: RoiBox;
}

export interface FrameScan {
  timeSec: number;
  score: number;
  detections: Detection[];
}

export interface ScanResult {
  filePath: string;
  sensitivityScore: number;
  frames: FrameScan[];
  isStillImage: boolean;
  durationSec: number;
  width: number;
  height: number;
}

/** Labels emitted by the NudeNet v3 detector, in model output order. */
export const NUDENET_LABELS = [
  "FEMALE_GENITALIA_COVERED", "FACE_FEMALE", "BUTTOCKS_EXPOSED", "FEMALE_BREAST_EXPOSED",
  "FEMALE_GENITALIA_EXPOSED", "MALE_BREAST_EXPOSED", "ANUS_EXPOSED", "FEET_EXPOSED",
  "BELLY_COVERED", "FEET_COVERED", "ARMPITS_COVERED", "ARMPITS_EXPOSED", "FACE_MALE",
  "BELLY_EXPOSED", "MALE_GENITALIA_EXPOSED", "ANUS_COVERED", "FEMALE_BREAST_COVERED", "BUTTOCKS_COVERED",
] as const;

/** Labels that make media unsuitable for platforms with a strict SFW policy. */
export const SENSITIVE_LABELS = new Set<string>([
  "BUTTOCKS_EXPOSED", "FEMALE_BREAST_EXPOSED", "FEMALE_GENITALIA_EXPOSED", "ANUS_EXPOSED", "MALE_GENITALIA_EXPOSED",
]);

export const SAFE_THRESHOLD = 0.2;
export const MODEL_INPUT = 320;
export const DEFAULT_MODEL_PATH = resolve(process.cwd(), process.env.NUDENET_MODEL ?? "models/nudenet-320n.onnx");

export interface Detector {
  /** rgb is MODEL_INPUT x MODEL_INPUT x 3 letterboxed pixels. Boxes are returned in letterboxed input space. */
  detect(rgb: Uint8Array): Promise<Detection[]>;
}

export class OnnxNudeNetDetector implements Detector {
  private session: unknown;
  constructor(private readonly modelPath = DEFAULT_MODEL_PATH, private readonly minScore = 0.25) {}

  private async getSession(): Promise<{ run: (feeds: Record<string, unknown>) => Promise<Record<string, { data: Float32Array; dims: number[] }>>; inputNames: string[]; outputNames: string[] }> {
    if (!this.session) {
      if (!existsSync(this.modelPath)) {
        throw new Error(`NudeNet model not found at ${this.modelPath}. Run: npm run models:fetch -w @polypost/media-reconciler`);
      }
      const ort: any = await import("onnxruntime-node" as string);
      this.session = await ort.InferenceSession.create(this.modelPath);
    }
    return this.session as never;
  }

  async detect(rgb: Uint8Array): Promise<Detection[]> {
    const ort: any = await import("onnxruntime-node" as string);
    const session = await this.getSession();
    const size = MODEL_INPUT * MODEL_INPUT;
    const chw = new Float32Array(3 * size);
    for (let i = 0; i < size; i++) {
      chw[i] = rgb[i * 3] / 255;
      chw[size + i] = rgb[i * 3 + 1] / 255;
      chw[2 * size + i] = rgb[i * 3 + 2] / 255;
    }
    const input = new ort.Tensor("float32", chw, [1, 3, MODEL_INPUT, MODEL_INPUT]);
    const output = await session.run({ [session.inputNames[0]]: input });
    const tensor = output[session.outputNames[0]];
    return decodeYoloOutput(tensor.data, tensor.dims, this.minScore);
  }
}

/** Decodes a YOLOv8 [1, 4 + classes, anchors] tensor and applies per-class NMS. */
export function decodeYoloOutput(data: Float32Array, dims: number[], minScore: number, iouThreshold = 0.45): Detection[] {
  const rows = dims[1];
  const anchors = dims[2];
  const classes = rows - 4;
  const raw: Detection[] = [];
  for (let a = 0; a < anchors; a++) {
    let best = -1;
    let bestScore = 0;
    for (let c = 0; c < classes; c++) {
      const s = data[(4 + c) * anchors + a];
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    if (best < 0 || bestScore < minScore) continue;
    const cx = data[a];
    const cy = data[anchors + a];
    const w = data[2 * anchors + a];
    const h = data[3 * anchors + a];
    raw.push({ label: NUDENET_LABELS[best] ?? `class_${best}`, score: bestScore, box: [cx - w / 2, cy - h / 2, w, h] });
  }
  raw.sort((x, y) => y.score - x.score);
  const kept: Detection[] = [];
  for (const d of raw) {
    if (kept.every((k) => k.label !== d.label || iou(k.box, d.box) < iouThreshold)) kept.push(d);
  }
  return kept;
}

export function iou(a: RoiBox, b: RoiBox): number {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]);
  const y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a[2] * a[3] + b[2] * b[3] - inter;
  return union <= 0 ? 0 : inter / union;
}

/** Maps a box from letterboxed model space back to source pixel coordinates. */
export function unletterbox(box: RoiBox, srcW: number, srcH: number): RoiBox {
  const scale = Math.min(MODEL_INPUT / srcW, MODEL_INPUT / srcH);
  const padX = (MODEL_INPUT - srcW * scale) / 2;
  const padY = (MODEL_INPUT - srcH * scale) / 2;
  const x = Math.max(0, (box[0] - padX) / scale);
  const y = Math.max(0, (box[1] - padY) / scale);
  const w = Math.min(srcW - x, box[2] / scale);
  const h = Math.min(srcH - y, box[3] / scale);
  return [Math.round(x), Math.round(y), Math.round(w), Math.round(h)];
}

export function frameSensitivity(detections: Detection[]): number {
  return detections.reduce((m, d) => (SENSITIVE_LABELS.has(d.label) ? Math.max(m, d.score) : m), 0);
}

/** Streams 2 FPS letterboxed RGB keyframes (or the single still image) out of ffmpeg. */
export async function extractKeyframes(filePath: string, fps = 2): Promise<Uint8Array[]> {
  const pad = `scale=${MODEL_INPUT}:${MODEL_INPUT}:force_original_aspect_ratio=decrease,pad=${MODEL_INPUT}:${MODEL_INPUT}:(ow-iw)/2:(oh-ih)/2:color=black`;
  const { stdout } = await runProcess(FFMPEG_BIN, [
    "-v", "error", "-i", filePath, "-vf", `fps=${fps},${pad}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1",
  ]);
  const frameBytes = MODEL_INPUT * MODEL_INPUT * 3;
  const frames: Uint8Array[] = [];
  for (let off = 0; off + frameBytes <= stdout.length; off += frameBytes) {
    frames.push(new Uint8Array(stdout.buffer, stdout.byteOffset + off, frameBytes));
  }
  return frames;
}

export async function scanMedia(filePath: string, detector: Detector = new OnnxNudeNetDetector(), fps = 2): Promise<ScanResult> {
  const info = await probe(filePath);
  const frames = await extractKeyframes(filePath, info.isStillImage ? 1 : fps);
  const scans: FrameScan[] = [];
  for (let i = 0; i < frames.length; i++) {
    const dets = (await detector.detect(frames[i])).map((d) => ({ ...d, box: unletterbox(d.box, info.width, info.height) }));
    scans.push({ timeSec: info.isStillImage ? 0 : i / fps, score: frameSensitivity(dets), detections: dets });
  }
  return {
    filePath,
    sensitivityScore: scans.reduce((m, f) => Math.max(m, f.score), 0),
    frames: scans,
    isStillImage: info.isStillImage,
    durationSec: info.durationSec,
    width: info.width,
    height: info.height,
  };
}

/** Longest run of consecutive keyframes whose score stays under the safe threshold. */
export function longestSafeWindow(frames: FrameScan[], fps = 2, threshold = SAFE_THRESHOLD): { startSec: number; endSec: number } | null {
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  for (let i = 0; i <= frames.length; i++) {
    const safe = i < frames.length && frames[i].score < threshold;
    if (safe && curStart < 0) curStart = i;
    if (!safe && curStart >= 0) {
      if (i - curStart > bestLen) {
        bestLen = i - curStart;
        bestStart = curStart;
      }
      curStart = -1;
    }
  }
  if (bestLen === 0) return null;
  return { startSec: frames[bestStart].timeSec, endSec: frames[bestStart].timeSec + bestLen / fps };
}
