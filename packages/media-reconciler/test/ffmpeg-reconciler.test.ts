import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildArgs,
  decodeYoloOutput,
  detectBestH264Encoder,
  FFMPEG_BIN,
  FFPROBE_BIN,
  longestSafeWindow,
  planMediaForPlatforms,
  probe,
  reconcile,
  runProcess,
  unletterbox,
  type Detector,
  type FrameScan,
  type ScanResult,
  scanMedia,
} from "../src/index";

let dir: string;
let video: string;
let image: string;
let png: string;

async function tags(file: string): Promise<Record<string, string>> {
  const { stdout } = await runProcess(FFPROBE_BIN, ["-v", "error", "-show_entries", "format_tags", "-of", "json", file]);
  return (JSON.parse(stdout.toString()).format?.tags ?? {}) as Record<string, string>;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "polypost-reconciler-"));
  video = join(dir, "master.mp4");
  image = join(dir, "still.jpg");
  png = join(dir, "wm.png");
  await runProcess(FFMPEG_BIN, [
    "-y", "-v", "error",
    "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=20",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=20",
    "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest",
    "-metadata", "title=Camera Roll 0042",
    "-metadata", "location=+40.6892-074.0445/",
    "-metadata", "make=PhoneCam",
    video,
  ]);
  await runProcess(FFMPEG_BIN, ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=1600x1200", "-frames:v", "1", image]);
  await runProcess(FFMPEG_BIN, ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=white@0.8:s=400x100,format=rgba", "-frames:v", "1", png]);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("ffmpeg reconciler", () => {
  it("strips camera, GPS and container metadata in privacy_clean", async () => {
    expect((await tags(video)).location).toBeDefined();
    const out = join(dir, "clean.mp4");
    await reconcile({ mode: "privacy_clean", input: video, output: out });
    const t = await tags(out);
    expect(t.location).toBeUndefined();
    expect(t.title).toBeUndefined();
    expect(t.make).toBeUndefined();
    expect((await probe(out)).durationSec).toBeGreaterThan(19);
  });

  it("inserts customFfmpegArgs right before the output path", () => {
    const args = buildArgs({ mode: "privacy_clean", input: "in.mp4", output: "out.mp4", customFfmpegArgs: ["-metadata", "comment=PolyPost"] });
    expect(args.slice(-3)).toEqual(["-metadata", "comment=PolyPost", "out.mp4"]);
    expect(args).toContain("-map_metadata");
    const kept = buildArgs({ mode: "privacy_clean", input: "in.mp4", output: "out.mp4", stripMetadata: false });
    expect(kept).not.toContain("-map_metadata");

    const nvencArgs = buildArgs({ mode: "promo_cut", input: "in.mp4", output: "out.mp4", videoEncoder: "h264_nvenc" });
    expect(nvencArgs).toContain("h264_nvenc");

    const vaapiShortArgs = buildArgs({ mode: "image_to_short", input: "img.jpg", output: "short.mp4", videoEncoder: "h264_vaapi" });
    expect(vaapiShortArgs).toContain("h264_vaapi");
  });

  it("auto-detects hardware H.264 encoder when available and falls back to libx264", async () => {
    const pickedNvenc = await detectBestH264Encoder(
      async () => ({ stdout: Buffer.from(" V..... h264_nvenc NVIDIA NVENC H.264 encoder\n"), stderr: "" }),
      true,
    );
    expect(pickedNvenc).toBe("h264_nvenc");

    const pickedFallback = await detectBestH264Encoder(
      async () => ({ stdout: Buffer.from(" V..... libx264 libx264 H.264\n"), stderr: "" }),
      true,
    );
    expect(pickedFallback).toBe("libx264");
  });

  it("cuts a 12-second watermarked funnel teaser under 9.5 MB", async () => {
    const out = join(dir, "teaser.mp4");
    const res = await reconcile({ mode: "funnel_bridge", input: video, output: out, startSec: 4, watermark: { pngPath: png } });
    expect(res.probe.durationSec).toBeGreaterThan(11.5);
    expect(res.probe.durationSec).toBeLessThan(12.6);
    expect(statSync(out).size).toBeLessThan(9.5 * 1024 * 1024);
    expect(res.probe.hasAudio).toBe(true);
    expect(res.probe.height).toBe(720);
  });

  it("builds a text-watermarked promo cut", async () => {
    const out = join(dir, "promo.mp4");
    const res = await reconcile({ mode: "promo_cut", input: video, output: out, durationSec: 8, maxMb: 5, watermark: { text: "store.example/clip: 50% off", position: "top-left" } });
    expect(res.probe.durationSec).toBeGreaterThan(7.5);
    expect(statSync(out).size).toBeLessThan(5 * 1024 * 1024);
  });

  it("synthesizes a 6-second 1080x1920 short with silent stereo audio from a still", async () => {
    const out = join(dir, "short.mp4");
    const res = await reconcile({ mode: "image_to_short", input: image, output: out });
    expect(res.probe.width).toBe(1080);
    expect(res.probe.height).toBe(1920);
    expect(res.probe.hasAudio).toBe(true);
    expect(res.probe.durationSec).toBeGreaterThan(5.8);
    expect(res.probe.durationSec).toBeLessThan(6.3);
  });
});

describe("vision scanner", () => {
  it("decodes YOLOv8 output with NMS", () => {
    const anchors = 3;
    const rows = 4 + 18;
    const data = new Float32Array(rows * anchors);
    const set = (r: number, a: number, v: number) => (data[r * anchors + a] = v);
    [[100, 100, 40, 40], [102, 101, 40, 40], [250, 250, 20, 20]].forEach(([cx, cy, w, h], a) => {
      set(0, a, cx); set(1, a, cy); set(2, a, w); set(3, a, h);
    });
    set(4 + 3, 0, 0.9);
    set(4 + 3, 1, 0.8);
    set(4 + 1, 2, 0.7);
    const dets = decodeYoloOutput(data, [1, rows, anchors], 0.25);
    expect(dets).toHaveLength(2);
    expect(dets[0].box).toEqual([80, 80, 40, 40]);
  });

  it("maps letterboxed boxes back to source coordinates", () => {
    expect(unletterbox([0, 70, 320, 180], 1280, 720)).toEqual([0, 0, 1280, 720]);
  });

  it("scans keyframes at 2 FPS through an injected detector", async () => {
    let calls = 0;
    const detector: Detector = {
      async detect() {
        calls++;
        return calls > 10 && calls <= 14 ? [{ label: "BUTTOCKS_EXPOSED", score: 0.81, box: [10, 10, 50, 50] }] : [];
      },
    };
    const scan = await scanMedia(video, detector);
    expect(scan.frames.length).toBeGreaterThanOrEqual(39);
    expect(scan.sensitivityScore).toBeCloseTo(0.81);
    expect(scan.frames[10].detections[0].box[2]).toBeGreaterThan(50);
    expect(longestSafeWindow(scan.frames)).toEqual({ startSec: 7, endSec: scan.frames.length / 2 });
  });
});

describe("media policy", () => {
  const frames = (scores: number[]): FrameScan[] => scores.map((score, i) => ({ timeSec: i / 2, score, detections: [] }));
  const scan = (scores: number[], still = false): ScanResult => ({
    filePath: "x", sensitivityScore: Math.max(...scores), frames: frames(scores), isStillImage: still, durationSec: scores.length / 2, width: 1920, height: 1080,
  });

  it("fails closed on strict platforms without a scan", () => {
    const [ig] = planMediaForPlatforms({ scan: null, masterMb: 50, isStillImage: false, platformIds: ["instagram"] });
    expect(ig.action).toBe("blocked");
  });

  it("routes a teaser from a safe window to strict platforms and the master to adult hosts", () => {
    const s = scan([...Array(30).fill(0.05), ...Array(10).fill(0.9)]);
    const plan = Object.fromEntries(planMediaForPlatforms({ scan: s, masterMb: 300, isStillImage: false, platformIds: ["youtube", "fansly_vault", "x"] }).map((p) => [p.platformId, p]));
    expect(plan.youtube.action).toBe("funnel_teaser");
    expect(plan.youtube.teaserWindow).toEqual({ startSec: 0, endSec: 12 });
    expect(plan.fansly_vault.action).toBe("publish");
    expect(plan.fansly_vault.requires2257Attestation).toBe(true);
    expect(plan.x.action).toBe("link_only");
  });

  it("blocks strict platforms when no safe window is long enough", () => {
    const s = scan([...Array(10).fill(0.05), ...Array(30).fill(0.9)]);
    const [tt] = planMediaForPlatforms({ scan: s, masterMb: 300, isStillImage: false, platformIds: ["tiktok"] });
    expect(tt.action).toBe("blocked");
  });

  it("converts stills for video-only hosts and suggests neutral tags for safe media on adult hosts", () => {
    const s = scan([0.02], true);
    const plan = Object.fromEntries(planMediaForPlatforms({ scan: s, masterMb: 2, isStillImage: true, platformIds: ["pornhub_shorties", "rumble", "bluesky"] }).map((p) => [p.platformId, p]));
    expect(plan.pornhub_shorties.action).toBe("image_to_short");
    expect(plan.pornhub_shorties.requires2257Attestation).toBe(true);
    expect(plan.rumble.action).toBe("image_to_short");
    expect(plan.bluesky.action).toBe("publish");
    const [mv] = planMediaForPlatforms({ scan: scan([0.02]), masterMb: 20, isStillImage: false, platformIds: ["manyvids_club"] });
    expect(mv.suggestedTags).toEqual(["SFW", "Lifestyle", "Behind The Scenes"]);
    expect(mv.publicPreviewSuggested).toBe(true);
  });
});

