import { extname } from "node:path";
import { bitrateForBudget, PROMO_CUT_MAX_MB, PROMO_CUT_SECONDS, TEASER_MAX_MB, TEASER_SECONDS } from "@polypost/platform-registry";
import { FFMPEG_BIN, probe, runProcess, type ProbeResult } from "./ffprobe";

export type H264Encoder = "libx264" | "h264_nvenc" | "h264_vaapi" | "h264_videotoolbox";

export interface CommonReconcileOptions {
  /** Extra user-supplied ffmpeg output options, inserted right before the output path. */
  customFfmpegArgs?: string[];
  /** Drop camera EXIF, GPS location and container tags (-map_metadata -1). Defaults to true. */
  stripMetadata?: boolean;
  /** Hardware or software H.264 video encoder. Defaults to "libx264". */
  videoEncoder?: H264Encoder;
}

export interface Watermark {
  pngPath?: string;
  text?: string;
  /** Overlay position, defaults to bottom-right. */
  position?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
}

export interface PrivacyCleanJob extends CommonReconcileOptions {
  mode: "privacy_clean";
  input: string;
  output: string;
  siblingIndex?: number;
}

export interface FunnelBridgeJob extends CommonReconcileOptions {
  mode: "funnel_bridge";
  input: string;
  output: string;
  startSec: number;
  durationSec?: number;
  maxMb?: number;
  watermark?: Watermark;
}

export interface PromoCutJob extends CommonReconcileOptions {
  mode: "promo_cut";
  input: string;
  output: string;
  startSec?: number;
  durationSec?: number;
  maxMb?: number;
  watermark?: Watermark;
}

export interface ImageToShortJob extends CommonReconcileOptions {
  mode: "image_to_short";
  input: string;
  output: string;
  durationSec?: number;
  fps?: number;
  width?: number;
  height?: number;
}

export type ReconcileJob = PrivacyCleanJob | FunnelBridgeJob | PromoCutJob | ImageToShortJob;

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp"]);

export function isImagePath(p: string): boolean {
  return IMAGE_EXT.has(extname(p).toLowerCase());
}

function metadataArgs(opts: CommonReconcileOptions): string[] {
  return opts.stripMetadata === false ? [] : ["-map_metadata", "-1", "-map_chapters", "-1"];
}

function tail(opts: CommonReconcileOptions, output: string): string[] {
  return [...metadataArgs(opts), ...(opts.customFfmpegArgs ?? []), output];
}

function overlayXY(pos: Watermark["position"]): string {
  switch (pos) {
    case "top-left":
      return "x=24:y=24";
    case "top-right":
      return "x=W-w-24:y=24";
    case "bottom-left":
      return "x=24:y=H-h-24";
    default:
      return "x=W-w-24:y=H-h-24";
  }
}

function escapeDrawtext(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\u2019").replace(/%/g, "\\%");
}

/** Builds the filter graph that scales to maxHeight and burns an optional PNG or text watermark. */
function watermarkGraph(maxHeight: number, wm?: Watermark): { inputs: string[]; graph: string } {
  const scale = `scale=-2:'min(${maxHeight},ih)',format=yuv420p`;
  if (wm?.pngPath) {
    return {
      inputs: ["-i", wm.pngPath],
      graph: `[0:v]${scale}[base];[1:v]scale=240:-1,format=rgba,colorchannelmixer=aa=0.85[wm];[base][wm]overlay=${overlayXY(wm.position)}[v]`,
    };
  }
  if (wm?.text) {
    const y = wm.position?.startsWith("top") ? "24" : "h-th-24";
    const x = wm.position?.endsWith("left") ? "24" : "w-tw-24";
    return {
      inputs: [],
      graph: `[0:v]${scale},drawtext=text='${escapeDrawtext(wm.text)}':fontcolor=white@0.9:fontsize=h/24:box=1:boxcolor=black@0.45:boxborderw=12:x=${x}:y=${y}[v]`,
    };
  }
  return { inputs: [], graph: `[0:v]${scale}[v]` };
}

export function buildPrivacyCleanArgs(job: PrivacyCleanJob): string[] {
  if (isImagePath(job.input)) {
    const ext = extname(job.output).toLowerCase();
    const codec = ext === ".png" ? ["-c:v", "png"] : ext === ".webp" ? ["-c:v", "libwebp", "-quality", "92"] : ["-c:v", "mjpeg", "-q:v", "2"];
    const sibIdx = job.siblingIndex ?? 0;
    const vfArgs =
      sibIdx > 0
        ? [
            "-vf",
            `eq=brightness=${(((sibIdx % 5) + 1) * 0.004).toFixed(3)}:contrast=${(1 + ((sibIdx % 5) + 1) * 0.005).toFixed(3)}`,
          ]
        : [];
    return ["-y", "-i", job.input, ...vfArgs, "-frames:v", "1", ...codec, ...tail(job, job.output)];
  }
  return ["-y", "-i", job.input, "-map", "0", "-c", "copy", "-movflags", "+faststart", ...tail(job, job.output)];
}

function videoEncoderArgs(encoder: H264Encoder = "libx264"): string[] {
  if (encoder === "h264_nvenc") return ["-c:v", "h264_nvenc", "-preset", "p4", "-pix_fmt", "yuv420p"];
  if (encoder === "h264_vaapi") return ["-c:v", "h264_vaapi"];
  if (encoder === "h264_videotoolbox") return ["-c:v", "h264_videotoolbox", "-pix_fmt", "yuv420p"];
  return ["-c:v", "libx264", "-preset", "veryfast", "-profile:v", "high", "-pix_fmt", "yuv420p"];
}

function budgetEncode(maxMb: number, durationSec: number, encoder: H264Encoder = "libx264"): string[] {
  const kbps = bitrateForBudget(maxMb, durationSec, 128);
  return [
    ...videoEncoderArgs(encoder),
    "-b:v", `${kbps}k`, "-maxrate", `${kbps}k`, "-bufsize", `${kbps * 2}k`,
    "-c:a", "aac", "-b:a", "128k", "-ac", "2",
    "-movflags", "+faststart",
  ];
}

export function buildFunnelBridgeArgs(job: FunnelBridgeJob, hasAudio = true): string[] {
  const duration = job.durationSec ?? TEASER_SECONDS;
  const maxMb = job.maxMb ?? TEASER_MAX_MB;
  const wm = watermarkGraph(1080, job.watermark);
  return [
    "-y", "-ss", job.startSec.toFixed(3), "-t", String(duration), "-i", job.input,
    ...wm.inputs,
    "-filter_complex", wm.graph,
    "-map", "[v]", ...(hasAudio ? ["-map", "0:a:0?"] : []),
    ...budgetEncode(maxMb, duration, job.videoEncoder),
    ...tail(job, job.output),
  ];
}

export function buildPromoCutArgs(job: PromoCutJob, hasAudio = true): string[] {
  const duration = job.durationSec ?? PROMO_CUT_SECONDS;
  const maxMb = job.maxMb ?? PROMO_CUT_MAX_MB;
  const wm = watermarkGraph(1080, job.watermark);
  return [
    "-y", "-ss", (job.startSec ?? 0).toFixed(3), "-t", String(duration), "-i", job.input,
    ...wm.inputs,
    "-filter_complex", wm.graph,
    "-map", "[v]", ...(hasAudio ? ["-map", "0:a:0?"] : []),
    ...budgetEncode(maxMb, duration, job.videoEncoder),
    ...tail(job, job.output),
  ];
}

export function buildImageToShortArgs(job: ImageToShortJob): string[] {
  const d = job.durationSec ?? 6;
  const fps = job.fps ?? 30;
  const w = job.width ?? 1080;
  const h = job.height ?? 1920;
  const frames = Math.round(d * fps);
  const graph =
    `[0:v]scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase,crop=${w * 2}:${h * 2},` +
    `zoompan=z='min(zoom+0.0015,1.25)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=${fps},format=yuv420p[v]`;
  const shortEncodeArgs =
    job.videoEncoder && job.videoEncoder !== "libx264"
      ? videoEncoderArgs(job.videoEncoder)
      : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20"];
  return [
    "-y", "-i", job.input,
    "-f", "lavfi", "-t", String(d), "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
    "-filter_complex", graph,
    "-map", "[v]", "-map", "1:a",
    ...shortEncodeArgs, "-r", String(fps),
    "-c:a", "aac", "-b:a", "128k",
    "-t", String(d), "-shortest", "-movflags", "+faststart",
    ...tail(job, job.output),
  ];
}

let cachedDetectedEncoder: H264Encoder | null = null;

/** Probes ffmpeg's compiled encoders and picks hardware acceleration when available, defaulting to libx264. */
export async function detectBestH264Encoder(
  runner: (bin: string, args: string[]) => Promise<{ stdout: Buffer; stderr: string }> = runProcess,
  bypassCache = false,
): Promise<H264Encoder> {
  if (!bypassCache && cachedDetectedEncoder) return cachedDetectedEncoder;
  const preferred: H264Encoder[] = ["h264_nvenc", "h264_vaapi", "h264_videotoolbox"];
  let chosen: H264Encoder = "libx264";
  try {
    const { stdout } = await runner(FFMPEG_BIN, ["-hide_banner", "-encoders"]);
    const listing = stdout.toString("utf-8");
    const hit = preferred.find((enc) => listing.includes(enc));
    if (hit) chosen = hit;
  } catch {
    chosen = "libx264";
  }
  if (!bypassCache) cachedDetectedEncoder = chosen;
  return chosen;
}

export function buildArgs(job: ReconcileJob, hasAudio = true): string[] {
  switch (job.mode) {
    case "privacy_clean":
      return buildPrivacyCleanArgs(job);
    case "funnel_bridge":
      return buildFunnelBridgeArgs(job, hasAudio);
    case "promo_cut":
      return buildPromoCutArgs(job, hasAudio);
    case "image_to_short":
      return buildImageToShortArgs(job);
  }
}

export interface ReconcileOutput {
  output: string;
  args: string[];
  probe: ProbeResult;
}

/** Runs ffmpeg for the job. ffmpeg reads and writes on disk, so nothing is buffered in Node memory. */
export async function reconcile(job: ReconcileJob): Promise<ReconcileOutput> {
  const hasAudio = job.mode === "image_to_short" || job.mode === "privacy_clean" ? true : (await probe(job.input)).hasAudio;
  const args = buildArgs(job, hasAudio);
  await runProcess(FFMPEG_BIN, ["-hide_banner", "-loglevel", "error", ...args], { collectStdout: false });
  return { output: job.output, args, probe: await probe(job.output) };
}
