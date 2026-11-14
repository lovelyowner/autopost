import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { resolveMonorepoRoot } from "@polypost/node-api-worker";

export { resolveMonorepoRoot };

export interface PresetProfile {
  id: string;
  name: string;
  recordsId2257: string;
  custodianContact: string;
  ppvPriceUsd: number;
  watermarkPngPath: string;
  watermarkPosition: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  seoTags: string[];
  masterPlatformId?: string;
  targetPlatforms?: string[];
  accountId?: string;
  accountOverrides?: Record<string, string>;
  priceOverrides?: Record<string, string>;
  captionOverrides?: Record<string, string>;
  firstCommentTemplate?: string;
  existingMasterUrl?: string;
  staggerSec?: number;
}

export interface ScheduledItem {
  id: string;
  title: string;
  date: string;
  time: string;
  platforms: string[];
  masterPlatformId?: string;
  mediaPath?: string;
  accountId?: string;
  status: "scheduled" | "processing" | "published" | "failed";
  queuedJobId?: string;
  createdAt: number;
}

const DEFAULT_PRESETS: PresetProfile[] = [
  {
    id: "preset_studio_core",
    name: "Studio Nova - Standard 4K Solo",
    recordsId2257: "REC-2257-VAULT-NOVA-2026",
    custodianContact: "compliance@studionova.example.com",
    ppvPriceUsd: 14.99,
    watermarkPngPath: "/watermarks/nova_corner_white.png",
    watermarkPosition: "bottom-right",
    seoTags: [
      "amateur", "solo", "studio", "4k", "neon", "cyberpunk", "lifestyle",
      "cinematic", "behind the scenes", "exclusive", "verified", "aesthetic",
      "high contrast", "color grading", "indie creator", "vault release",
    ],
  },
  {
    id: "preset_collab_pair",
    name: "Verified Co-Performer Collab Tier",
    recordsId2257: "REC-2257-COLLAB-DUAL-77A",
    custodianContact: "records@creatorpartners.example.com",
    ppvPriceUsd: 24.99,
    watermarkPngPath: "/watermarks/collab_badge.png",
    watermarkPosition: "top-right",
    seoTags: [
      "collab", "duo", "verified", "full length", "4k 60fps", "ppv",
      "members exclusive", "club release", "amateur couple", "indie",
      "lifestyle", "bts", "deluxe edition", "dual angle", "raw master", "co-star",
    ],
  },
  {
    id: "preset_adult_clip_matrix",
    name: "VIP Clip Stores + Multi-X Roster (OF + C4S + MV + MYM + JFF)",
    recordsId2257: "REC-2257-VAULT-NOVA-2026",
    custodianContact: "compliance@studionova.example.com",
    ppvPriceUsd: 19.99,
    watermarkPngPath: "/watermarks/nova_corner_white.png",
    watermarkPosition: "bottom-right",
    masterPlatformId: "manyvids_store",
    targetPlatforms: [
      "manyvids_store",
      "onlyfans_feed",
      "clips4sale",
      "mym_fans",
      "justforfans",
      "fansly_wall",
      "x",
    ],
    accountId: "main_creator",
    accountOverrides: {
      x: "x_acc_1, x_acc_2, x_acc_3",
    },
    staggerSec: 15,
    seoTags: [
      "exclusive", "4k", "full release", "clip store", "vip", "new drop",
      "behind the scenes", "verified", "solo", "studio",
    ],
  },
  {
    id: "preset_alt_video_trio",
    name: "Alt-Tech Video Matrix (Rumble + BitChute + Odysee + X)",
    recordsId2257: "REC-2257-VAULT-NOVA-2026",
    custodianContact: "compliance@studionova.example.com",
    ppvPriceUsd: 9.99,
    watermarkPngPath: "/watermarks/nova_corner_white.png",
    watermarkPosition: "bottom-left",
    masterPlatformId: "rumble",
    targetPlatforms: ["rumble", "bitchute", "odysee", "x", "telegram", "bluesky"],
    accountId: "main_creator",
    staggerSec: 5,
    seoTags: [
      "uncensored", "4k", "vlog", "commentary", "creator", "exclusive",
    ],
  },
];

function futureIsoDate(daysAhead: number): string {
  return new Date(Date.now() + daysAhead * 86_400_000).toISOString().slice(0, 10);
}

const DEFAULT_SCHEDULE: ScheduledItem[] = [
  {
    id: "post_001",
    title: "Cyberpunk Studio 4K Solo",
    date: futureIsoDate(1),
    time: "18:00 UTC",
    platforms: ["youtube", "fansly_wall", "bluesky", "x", "discord"],
    masterPlatformId: "youtube",
    status: "scheduled",
    createdAt: Date.now() - 3600_000,
  },
  {
    id: "post_002",
    title: "Neon Lighting BTS Teaser",
    date: futureIsoDate(2),
    time: "20:30 UTC",
    platforms: ["pornhub_video", "manyvids_store", "telegram"],
    masterPlatformId: "pornhub_video",
    status: "scheduled",
    createdAt: Date.now() - 1800_000,
  },
];

function ensureJsonFile<T>(relPath: string, seed: T): T {
  const fullPath = resolve(resolveMonorepoRoot(), relPath);
  if (!existsSync(fullPath)) {
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, JSON.stringify(seed, null, 2), "utf-8");
    return seed;
  }
  try {
    return JSON.parse(readFileSync(fullPath, "utf-8")) as T;
  } catch {
    return seed;
  }
}

function writeJsonFile<T>(relPath: string, data: T): void {
  const fullPath = resolve(resolveMonorepoRoot(), relPath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, JSON.stringify(data, null, 2), "utf-8");
}

export function loadPresets(): PresetProfile[] {
  return ensureJsonFile<PresetProfile[]>("config/presets.json", DEFAULT_PRESETS);
}

export function upsertPreset(preset: PresetProfile): PresetProfile[] {
  const current = loadPresets();
  const idx = current.findIndex((p) => p.id === preset.id);
  const updated = idx >= 0
    ? current.map((p, i) => (i === idx ? preset : p))
    : [...current, preset];
  writeJsonFile("config/presets.json", updated);
  return updated;
}

export function deletePreset(id: string): PresetProfile[] {
  const updated = loadPresets().filter((p) => p.id !== id);
  writeJsonFile("config/presets.json", updated);
  return updated;
}

export function loadSchedule(): ScheduledItem[] {
  return ensureJsonFile<ScheduledItem[]>("config/schedule.json", DEFAULT_SCHEDULE);
}

export function addScheduledItems(items: ScheduledItem[]): ScheduledItem[] {
  const updated = [...loadSchedule(), ...items];
  writeJsonFile("config/schedule.json", updated);
  return updated;
}

export function deleteScheduledItem(id: string): ScheduledItem[] {
  const updated = loadSchedule().filter((item) => item.id !== id);
  writeJsonFile("config/schedule.json", updated);
  return updated;
}
