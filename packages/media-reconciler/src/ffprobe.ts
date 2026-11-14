import { spawn } from "node:child_process";

export interface ProbeResult {
  durationSec: number;
  width: number;
  height: number;
  hasAudio: boolean;
  sizeBytes: number;
  isStillImage: boolean;
}

export const FFMPEG_BIN = process.env.FFMPEG_PATH ?? "ffmpeg";
export const FFPROBE_BIN = process.env.FFPROBE_PATH ?? "ffprobe";

export function runProcess(bin: string, args: string[], opts: { collectStdout?: boolean } = {}): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let err = "";
    child.stdout.on("data", (d: Buffer) => {
      if (opts.collectStdout !== false) out.push(d);
    });
    child.stderr.on("data", (d: Buffer) => {
      err += d.toString();
      if (err.length > 64_000) err = err.slice(-32_000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise({ stdout: Buffer.concat(out), stderr: err });
      else reject(new Error(`${bin} exited with ${code}: ${err.slice(-2000)}`));
    });
  });
}

const STILL_CODECS = new Set(["mjpeg", "png", "webp", "bmp", "gif", "tiff", "jpegls"]);

export async function probe(filePath: string): Promise<ProbeResult> {
  const { stdout } = await runProcess(FFPROBE_BIN, [
    "-v", "error",
    "-show_entries", "format=duration,size:stream=codec_type,codec_name,width,height,nb_frames",
    "-of", "json",
    filePath,
  ]);
  const data = JSON.parse(stdout.toString()) as {
    format?: { duration?: string; size?: string };
    streams?: Array<{ codec_type: string; codec_name?: string; width?: number; height?: number; nb_frames?: string }>;
  };
  const video = data.streams?.find((s) => s.codec_type === "video");
  const durationSec = Number(data.format?.duration ?? 0) || 0;
  const isStillImage = !!video && STILL_CODECS.has(video.codec_name ?? "") && (durationSec === 0 || video.nb_frames === "1" || durationSec < 0.1);
  return {
    durationSec,
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    hasAudio: !!data.streams?.some((s) => s.codec_type === "audio"),
    sizeBytes: Number(data.format?.size ?? 0),
    isStillImage,
  };
}
