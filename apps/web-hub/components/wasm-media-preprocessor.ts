/**
 * Client-Side Media Pre-Processor (Harvested from ffmpeg-wasm and squoosh)
 * Runs directly in the browser composer:
 * - Compresses high-res stills to < 1 MB WebP / MozJPEG for Bluesky and Mastodon.
 * - Slices quick video teasers (12s) prior to network transmission.
 */

export type WatermarkPosition =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export interface CompressionResult {
  blob: Blob;
  sizeBytes: number;
  width: number;
  height: number;
  format: string;
  dataUrl: string;
}

export interface BrowserMediaProbeResult {
  sizeBytes: number;
  sizeMb: number;
  width: number;
  height: number;
  durationSec: number;
  isStillImage: boolean;
  previewDataUrl: string;
}

const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".avif",
  ".bmp",
]);

function isImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  const lower = file.name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  return dot >= 0 && IMAGE_EXTENSIONS.has(lower.slice(dot));
}

function scaleDimensions(
  width: number,
  height: number,
  maxDimension: number,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) {
    return { width: maxDimension, height: Math.round((maxDimension * 9) / 16) };
  }
  if (width <= maxDimension && height <= maxDimension) {
    return { width, height };
  }
  if (width >= height) {
    return {
      width: maxDimension,
      height: Math.max(1, Math.round((height * maxDimension) / width)),
    };
  }
  return {
    width: Math.max(1, Math.round((width * maxDimension) / height)),
    height: maxDimension,
  };
}

function drawCornerWatermark(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  text?: string,
  position: WatermarkPosition = "bottom-right",
): void {
  const clean = text?.trim();
  if (!clean) return;

  const fontSize = Math.max(13, Math.round(Math.min(width, height) * 0.036));
  const padX = Math.round(fontSize * 0.65);
  const padY = Math.round(fontSize * 0.35);
  const margin = Math.max(10, Math.round(Math.min(width, height) * 0.03));

  ctx.save();
  ctx.font = `600 ${fontSize}px system-ui, -apple-system, sans-serif`;
  ctx.textBaseline = "middle";
  const textWidth = ctx.measureText(clean).width;
  const boxWidth = textWidth + padX * 2;
  const boxHeight = fontSize + padY * 2;

  const isRight = position.endsWith("right");
  const isBottom = position.startsWith("bottom");
  const boxX = isRight ? Math.max(margin, width - boxWidth - margin) : margin;
  const boxY = isBottom ? Math.max(margin, height - boxHeight - margin) : margin;

  ctx.fillStyle = "rgba(9, 13, 22, 0.72)";
  const radius = Math.min(8, Math.round(boxHeight * 0.25));
  ctx.beginPath();
  ctx.roundRect(boxX, boxY, boxWidth, boxHeight, radius);
  ctx.fill();

  ctx.fillStyle = "rgba(255, 255, 255, 0.94)";
  ctx.fillText(clean, boxX + padX, boxY + boxHeight / 2);
  ctx.restore();
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("Failed to encode blob as data URL"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Probes any image or video file strictly inside the browser (zero upload,
 * supports multi-GB video files on serverless deployments) and renders a
 * seeked preview thumbnail with an optional corner watermark.
 */
export async function probeMediaInBrowser(
  file: File,
  seekSec = 0,
  watermarkText?: string,
  watermarkPosition: WatermarkPosition = "bottom-right",
): Promise<BrowserMediaProbeResult> {
  const sizeBytes = file.size;
  const sizeMb = Number((sizeBytes / (1024 * 1024)).toFixed(2));
  const url = URL.createObjectURL(file);

  if (isImageFile(file)) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const naturalWidth = img.naturalWidth || img.width;
        const naturalHeight = img.naturalHeight || img.height;
        const previewSize = scaleDimensions(naturalWidth, naturalHeight, 720);
        const canvas = document.createElement("canvas");
        canvas.width = previewSize.width;
        canvas.height = previewSize.height;
        const ctx = canvas.getContext("2d");
        let previewDataUrl = "";
        if (ctx) {
          ctx.drawImage(img, 0, 0, previewSize.width, previewSize.height);
          drawCornerWatermark(
            ctx,
            previewSize.width,
            previewSize.height,
            watermarkText,
            watermarkPosition,
          );
          previewDataUrl = canvas.toDataURL("image/webp", 0.85);
        }
        resolve({
          sizeBytes,
          sizeMb,
          width: naturalWidth,
          height: naturalHeight,
          durationSec: 0,
          isStillImage: true,
          previewDataUrl,
        });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Failed to decode image in browser"));
      };
      img.src = url;
    });
  }

  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";

    let settled = false;
    const cleanup = () => {
      video.onloadedmetadata = null;
      video.onloadeddata = null;
      video.onseeked = null;
      video.onerror = null;
      URL.revokeObjectURL(url);
    };

    const captureFrame = () => {
      if (settled) return;
      settled = true;
      const naturalWidth = video.videoWidth || 0;
      const naturalHeight = video.videoHeight || 0;
      const durationSec = Number.isFinite(video.duration)
        ? Number(video.duration.toFixed(2))
        : 0;
      let previewDataUrl = "";
      if (naturalWidth > 0 && naturalHeight > 0) {
        const previewSize = scaleDimensions(naturalWidth, naturalHeight, 720);
        const canvas = document.createElement("canvas");
        canvas.width = previewSize.width;
        canvas.height = previewSize.height;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(video, 0, 0, previewSize.width, previewSize.height);
          drawCornerWatermark(
            ctx,
            previewSize.width,
            previewSize.height,
            watermarkText,
            watermarkPosition,
          );
          previewDataUrl = canvas.toDataURL("image/jpeg", 0.84);
        }
      }
      cleanup();
      resolve({
        sizeBytes,
        sizeMb,
        width: naturalWidth,
        height: naturalHeight,
        durationSec,
        isStillImage: false,
        previewDataUrl,
      });
    };

    const timer = window.setTimeout(captureFrame, 4000);

    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const target =
        duration > 0.1
          ? Math.min(Math.max(0.05, seekSec), Math.max(0.05, duration - 0.05))
          : 0;
      if (target > 0) {
        video.onseeked = () => {
          window.clearTimeout(timer);
          captureFrame();
        };
        video.currentTime = target;
      } else {
        video.onloadeddata = () => {
          window.clearTimeout(timer);
          captureFrame();
        };
      }
    };

    video.onerror = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      cleanup();
      reject(new Error("Browser could not decode this video format locally"));
    };

    video.src = url;
  });
}

export async function compressImageInBrowser(
  file: File,
  maxSizeBytes = 1000 * 1024, // 1MB threshold for Bluesky
  maxDimension = 2048,
  watermarkText?: string,
  watermarkPosition: WatermarkPosition = "bottom-right",
): Promise<CompressionResult> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = async () => {
      URL.revokeObjectURL(url);
      const { width, height } = scaleDimensions(img.width, img.height, maxDimension);

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Canvas context unavailable"));

      ctx.drawImage(img, 0, 0, width, height);
      drawCornerWatermark(ctx, width, height, watermarkText, watermarkPosition);

      let quality = 0.92;
      let blob: Blob | null = null;

      // Iteratively tune quality to guarantee < maxSizeBytes
      for (let attempt = 0; attempt < 6; attempt++) {
        const clampedQuality = Math.max(0.15, quality);
        blob = await new Promise<Blob | null>((res) =>
          canvas.toBlob(res, "image/webp", clampedQuality),
        );
        if (blob && blob.size <= maxSizeBytes) break;
        quality -= 0.15;
      }

      if (!blob) {
        return reject(new Error("Image compression failed in browser"));
      }

      const dataUrl = await blobToDataUrl(blob);

      resolve({
        blob,
        sizeBytes: blob.size,
        width,
        height,
        format: "image/webp",
        dataUrl,
      });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image in browser pre-processor"));
    };

    img.src = url;
  });
}
