import { createWriteStream, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { NextRequest, NextResponse } from "next/server";
import { resolveDataDir } from "@polypost/node-api-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".m4v",
  ".webm",
  ".mkv",
  ".avi",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
]);

function sanitizeUploadName(rawName: string): { fileName: string; ext: string } {
  const cleanBase = basename(rawName || "upload.mp4")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/^_+/, "");
  const ext = extname(cleanBase).toLowerCase() || ".mp4";
  const stem = cleanBase.slice(0, cleanBase.length - extname(cleanBase).length) || "media";
  return {
    fileName: `${Date.now()}_${stem.slice(0, 64)}${ext}`,
    ext,
  };
}

function pruneStaleUploads(uploadsDir: string, keepFile: string, maxFiles = 15, maxAgeMs = 86_400_000): number {
  let pruned = 0;
  const now = Date.now();
  try {
    const entries = readdirSync(uploadsDir)
      .map((name) => {
        const fullPath = join(uploadsDir, name);
        let mtimeMs = 0;
        try {
          mtimeMs = statSync(fullPath).mtimeMs;
        } catch {}
        return { name, fullPath, mtimeMs };
      })
      .filter((item) => item.fullPath !== keepFile && item.mtimeMs > 0)
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    entries.forEach((item, idx) => {
      if (idx >= maxFiles - 1 || now - item.mtimeMs > maxAgeMs) {
        try {
          unlinkSync(item.fullPath);
          pruned++;
        } catch {}
      }
    });
  } catch {}
  return pruned;
}

export async function POST(req: NextRequest) {
  let destPath = "";
  try {
    const contentType = req.headers.get("content-type") || "";
    const headerName = req.headers.get("x-file-name") || req.nextUrl.searchParams.get("filename") || "";

    const uploadsDir = join(resolveDataDir(), "uploads");
    mkdirSync(uploadsDir, { recursive: true });

    let originalName = headerName || "staged_media.mp4";
    let webStream: ReadableStream<Uint8Array> | null = null;

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const uploaded = form.get("file");
      if (!uploaded || typeof uploaded === "string") {
        return NextResponse.json({ error: "Missing 'file' field in multipart upload." }, { status: 400 });
      }
      originalName = uploaded.name || originalName;
      webStream = uploaded.stream() as ReadableStream<Uint8Array>;
    } else {
      if (!req.body) {
        return NextResponse.json({ error: "Empty upload body." }, { status: 400 });
      }
      webStream = req.body as ReadableStream<Uint8Array>;
    }

    const { fileName, ext } = sanitizeUploadName(originalName);
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return NextResponse.json(
        { error: `Unsupported media extension '${ext}'. Allowed: ${Array.from(ALLOWED_EXTENSIONS).join(", ")}` },
        { status: 400 },
      );
    }

    destPath = join(uploadsDir, fileName);
    const nodeReadable = Readable.fromWeb(webStream as any);
    await pipeline(nodeReadable, createWriteStream(destPath));

    const stat = statSync(destPath);
    if (stat.size === 0) {
      unlinkSync(destPath);
      return NextResponse.json({ error: "Uploaded file was 0 bytes." }, { status: 400 });
    }

    const sizeMb = Number((stat.size / (1024 * 1024)).toFixed(2));
    const prunedOldUploads = pruneStaleUploads(uploadsDir, destPath);
    return NextResponse.json({
      success: true,
      filePath: destPath,
      fileName,
      originalName,
      sizeBytes: stat.size,
      sizeMb,
      prunedOldUploads,
    });
  } catch (err: any) {
    if (destPath) {
      try {
        unlinkSync(destPath);
      } catch {}
    }
    return NextResponse.json({ error: err.message || "Media upload failed" }, { status: 500 });
  }
}
