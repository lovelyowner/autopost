import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { CampaignStateSnapshot, CampaignStep, TeaserProgressState } from "./funnel_flow";

export interface CampaignHistoryEntry {
  campaignId: string;
  topic: string;
  masterPlatformId: string;
  accountId: string;
  mediaPath?: string;
  existingMasterUrl?: string;
  firstCommentTemplate?: string;
  priceOverrides?: Record<string, number>;
  accountOverrides?: Record<string, string>;
  step: CampaignStep;
  liveMasterUrl?: string;
  masterSimulated?: boolean;
  masterError?: string;
  teaserCount: number;
  publishedCount: number;
  failedCount: number;
  teasers: TeaserProgressState[];
  createdAt: number;
  updatedAt: number;
}

const MAX_HISTORY_ENTRIES = 100;

export function resolveMonorepoRoot(): string {
  let curr = process.cwd();
  for (let i = 0; i < 6; i++) {
    const pkgPath = resolve(curr, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        if (pkg.name === "polypost") return curr;
      } catch {}
    }
    const parent = dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
  return process.cwd();
}

export function resolveDataDir(overrideDir?: string): string {
  if (overrideDir) return resolve(overrideDir);
  if (process.env.POLYPOST_DATA_DIR) return resolve(process.env.POLYPOST_DATA_DIR);
  return join(resolveMonorepoRoot(), "data");
}

function historyFilePath(dataDir?: string): string {
  return join(resolveDataDir(dataDir), "campaign-history.json");
}

function atomicWriteJson(targetPath: string, data: unknown): void {
  mkdirSync(dirname(targetPath), { recursive: true });
  const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
  renameSync(tmpPath, targetPath);
}

export function loadCampaignHistory(limit = 50, dataDir?: string): CampaignHistoryEntry[] {
  const filePath = historyFilePath(dataDir);
  if (!existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8"));
    if (!Array.isArray(parsed)) return [];
    const sorted = (parsed as CampaignHistoryEntry[]).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return limit > 0 ? sorted.slice(0, limit) : sorted;
  } catch {
    return [];
  }
}

export function getCampaignHistoryEntry(campaignId: string, dataDir?: string): CampaignHistoryEntry | undefined {
  return loadCampaignHistory(0, dataDir).find((entry) => entry.campaignId === campaignId);
}

export function recordCampaignHistory(
  snapshot: CampaignStateSnapshot,
  dataDir?: string,
): CampaignHistoryEntry {
  const filePath = historyFilePath(dataDir);
  const existing = loadCampaignHistory(0, dataDir);
  const prev = existing.find((e) => e.campaignId === snapshot.campaignId);

  const publishedCount = snapshot.teasers.filter((t) => t.status === "published").length;
  const failedCount = snapshot.teasers.filter((t) => t.status === "failed").length;

  const merged: CampaignHistoryEntry = {
    campaignId: snapshot.campaignId,
    topic: snapshot.topic || prev?.topic || snapshot.campaignId,
    masterPlatformId: snapshot.masterPlatformId || prev?.masterPlatformId || "unknown",
    accountId: snapshot.accountId || prev?.accountId || "default",
    mediaPath: snapshot.mediaPath ?? prev?.mediaPath,
    existingMasterUrl: snapshot.existingMasterUrl ?? prev?.existingMasterUrl,
    firstCommentTemplate: snapshot.firstCommentTemplate ?? prev?.firstCommentTemplate,
    priceOverrides: snapshot.priceOverrides ?? prev?.priceOverrides,
    accountOverrides: snapshot.accountOverrides ?? prev?.accountOverrides,
    step: snapshot.step,
    liveMasterUrl: snapshot.liveMasterUrl ?? prev?.liveMasterUrl,
    masterSimulated: snapshot.masterSimulated ?? prev?.masterSimulated,
    masterError: snapshot.masterError ?? prev?.masterError,
    teaserCount: snapshot.teasers.length,
    publishedCount,
    failedCount,
    teasers: snapshot.teasers,
    createdAt: prev?.createdAt ?? snapshot.updatedAt ?? Date.now(),
    updatedAt: snapshot.updatedAt || Date.now(),
  };

  const next = [merged, ...existing.filter((e) => e.campaignId !== snapshot.campaignId)].slice(
    0,
    MAX_HISTORY_ENTRIES,
  );
  atomicWriteJson(filePath, next);
  return merged;
}

export function deleteCampaignHistory(campaignId?: string, dataDir?: string): { deleted: number } {
  const filePath = historyFilePath(dataDir);
  const existing = loadCampaignHistory(0, dataDir);
  if (!campaignId) {
    atomicWriteJson(filePath, []);
    return { deleted: existing.length };
  }
  const remaining = existing.filter((e) => e.campaignId !== campaignId);
  const deleted = existing.length - remaining.length;
  atomicWriteJson(filePath, remaining);
  return { deleted };
}

export function deleteSimulatedCampaignHistory(
  dataDir?: string,
): { deleted: number; kept: number } {
  const filePath = historyFilePath(dataDir);
  const existing = loadCampaignHistory(0, dataDir);
  const remaining = existing.filter((e) => {
    const isSimulated =
      e.masterSimulated === true ||
      (e.masterSimulated === undefined &&
        e.teasers.length > 0 &&
        e.teasers.every((t) => t.simulated === true));
    return !isSimulated;
  });
  const deleted = existing.length - remaining.length;
  atomicWriteJson(filePath, remaining);
  return { deleted, kept: remaining.length };
}
