import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_MODEL_PATH,
  FFMPEG_BIN,
  OnnxNudeNetDetector,
  detectBestH264Encoder,
  longestSafeWindow,
  probe,
  runProcess,
  scanMedia,
} from "@polypost/media-reconciler";
import { resolveMonorepoRoot } from "@polypost/node-api-worker";

function findNudenetModelPath(): string | null {
  const candidates = [
    DEFAULT_MODEL_PATH,
    resolve(resolveMonorepoRoot(), process.env.NUDENET_MODEL ?? "models/nudenet-320n.onnx"),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const filePath = String(body.filePath || "").trim();
    const requestedStartSec = Math.max(0, Number(body.startSec) || 0);
    const extractPreview = Boolean(body.extractPreview);
    const scanSafety = Boolean(body.scanSafety);

    if (!filePath) {
      return NextResponse.json({ exists: false, error: "filePath is required" }, { status: 400 });
    }

    if (!existsSync(filePath)) {
      return NextResponse.json({
        exists: false,
        filePath,
        recommendedEncoder: await detectBestH264Encoder().catch(() => "libx264"),
        error: `File not found on disk: ${filePath}`,
      });
    }

    const stats = statSync(filePath);
    const meta = await probe(filePath);
    const recommendedEncoder = await detectBestH264Encoder().catch(() => "libx264");

    const maxSeek = meta.durationSec > 1 ? Math.max(0, meta.durationSec - 0.5) : 0;
    const clampedStartSec = meta.isStillImage ? 0 : Math.min(requestedStartSec, maxSeek);
    let recommendedStartSec = meta.isStillImage
      ? 0
      : meta.durationSec > 15
      ? Math.round(meta.durationSec * 0.25 * 10) / 10
      : 0;

    let safetyScan: Record<string, any> | undefined;
    if (scanSafety) {
      const modelPath = findNudenetModelPath();
      if (modelPath) {
        try {
          const scan = await scanMedia(filePath, new OnnxNudeNetDetector(modelPath));
          const safeWin = !scan.isStillImage ? longestSafeWindow(scan.frames) : null;
          if (safeWin) {
            recommendedStartSec = Math.round(safeWin.startSec * 10) / 10;
          }
          safetyScan = {
            available: true,
            sensitivityScore: Number(scan.sensitivityScore.toFixed(3)),
            framesScanned: scan.frames.length,
            safeWindow: safeWin,
          };
        } catch (err: any) {
          safetyScan = {
            available: false,
            error: err?.message ?? String(err),
          };
        }
      } else {
        safetyScan = {
          available: false,
          reason: "NudeNet ONNX model not downloaded yet (npm run models:fetch -w @polypost/media-reconciler).",
        };
      }
    }

    let previewDataUrl: string | undefined;
    if (extractPreview) {
      try {
        const frameArgs = [
          "-hide_banner",
          "-loglevel",
          "error",
          ...(meta.isStillImage ? [] : ["-ss", clampedStartSec.toFixed(2)]),
          "-i",
          filePath,
          "-frames:v",
          "1",
          "-vf",
          "scale='min(480,iw)':-2",
          "-f",
          "image2pipe",
          "-vcodec",
          "mjpeg",
          "pipe:1",
        ];
        const { stdout } = await runProcess(FFMPEG_BIN, frameArgs);
        if (stdout.length > 0) {
          previewDataUrl = `data:image/jpeg;base64,${stdout.toString("base64")}`;
        }
      } catch {
        // Non-fatal if frame extraction fails on an exotic container
      }
    }

    return NextResponse.json({
      exists: true,
      filePath,
      ...meta,
      sizeBytes: meta.sizeBytes || stats.size,
      sizeMb: Math.max(1, Math.round((meta.sizeBytes || stats.size) / (1024 * 1024))),
      recommendedEncoder,
      recommendedStartSec,
      previewStartSec: clampedStartSec,
      previewDataUrl,
      safetyScan,
    });
  } catch (err: any) {
    return NextResponse.json({ exists: false, error: err.message }, { status: 500 });
  }
}
