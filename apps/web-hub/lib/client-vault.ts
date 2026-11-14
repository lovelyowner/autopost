/** Browser localStorage persistence for per-visitor credentials, presets, schedules, and history. */
import type { CampaignHistoryEntry, CampaignStateSnapshot } from "@polypost/node-api-worker";
import type { PresetProfile, ScheduledItem } from "@/lib/config-store";

const CREDS_KEY = "polypost_client_credentials_v1";
const PRESETS_KEY = "polypost_client_presets_v1";
const SCHEDULE_KEY = "polypost_client_schedule_v1";
const HISTORY_KEY = "polypost_client_history_v1";
const COMPANION_URL_KEY = "polypost_companion_url_v1";

function readStorageJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeStorageJson<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota errors in restricted browsing modes
  }
}

export function getClientCredentials(): Record<string, string> {
  return readStorageJson<Record<string, string>>(CREDS_KEY, {});
}

export function saveClientCredentials(updates: Record<string, string | null | undefined>): {
  updatedKeys: string[];
  removedKeys: string[];
  all: Record<string, string>;
} {
  const current = { ...getClientCredentials() };
  const updatedKeys: string[] = [];
  const removedKeys: string[] = [];

  for (const [rawKey, rawVal] of Object.entries(updates)) {
    const key = rawKey.trim();
    if (!key) continue;
    if (rawVal === null) {
      if (key in current) {
        delete current[key];
        removedKeys.push(key);
      }
      continue;
    }
    if (typeof rawVal === "string") {
      const trimmed = rawVal.trim();
      if (!trimmed || trimmed.startsWith("••••")) continue;
      current[key] = trimmed;
      updatedKeys.push(key);
    }
  }

  writeStorageJson(CREDS_KEY, current);
  return { updatedKeys, removedKeys, all: current };
}

export function clearClientCredentialKeys(keys: string[]): Record<string, string> {
  const clearMap: Record<string, null> = {};
  for (const key of keys) clearMap[key] = null;
  return saveClientCredentials(clearMap).all;
}

export function maskClientPreview(val: string | undefined, secret?: boolean): string {
  if (!val) return "";
  if (!secret) return val;
  if (val.length <= 6) return "••••••";
  return `••••${val.slice(-4)}`;
}

export function getClientPresets(): PresetProfile[] {
  return readStorageJson<PresetProfile[]>(PRESETS_KEY, []);
}

export function saveClientPreset(preset: PresetProfile): PresetProfile[] {
  const current = getClientPresets();
  const idx = current.findIndex((p) => p.id === preset.id);
  const next = idx >= 0 ? current.map((p, i) => (i === idx ? preset : p)) : [...current, preset];
  writeStorageJson(PRESETS_KEY, next);
  return next;
}

export function deleteClientPreset(id: string): PresetProfile[] {
  const next = getClientPresets().filter((p) => p.id !== id);
  writeStorageJson(PRESETS_KEY, next);
  return next;
}

export function mergePresetsWithClient(serverPresets: PresetProfile[]): PresetProfile[] {
  const byId = new Map<string, PresetProfile>();
  for (const p of serverPresets) byId.set(p.id, p);
  for (const p of getClientPresets()) byId.set(p.id, p);
  return Array.from(byId.values());
}

export function getClientSchedule(): ScheduledItem[] {
  return readStorageJson<ScheduledItem[]>(SCHEDULE_KEY, []);
}

export function addClientScheduledItems(items: ScheduledItem[]): ScheduledItem[] {
  const byId = new Map<string, ScheduledItem>();
  for (const existing of getClientSchedule()) byId.set(existing.id, existing);
  for (const item of items) byId.set(item.id, item);
  const next = Array.from(byId.values());
  writeStorageJson(SCHEDULE_KEY, next);
  return next;
}

export function deleteClientScheduledItem(id: string): ScheduledItem[] {
  const next = getClientSchedule().filter((i) => i.id !== id);
  writeStorageJson(SCHEDULE_KEY, next);
  return next;
}

export function mergeScheduleWithClient(serverItems: ScheduledItem[]): ScheduledItem[] {
  const byId = new Map<string, ScheduledItem>();
  for (const item of serverItems) byId.set(item.id, item);
  for (const item of getClientSchedule()) byId.set(item.id, item);
  return Array.from(byId.values());
}

export function getClientHistory(): CampaignHistoryEntry[] {
  return readStorageJson<CampaignHistoryEntry[]>(HISTORY_KEY, []);
}

export function saveClientHistoryEntry(
  entry: CampaignHistoryEntry | CampaignStateSnapshot,
): CampaignHistoryEntry[] {
  const existing = getClientHistory().find((e) => e.campaignId === entry.campaignId);
  const teasers = entry.teasers || [];
  const normalized: CampaignHistoryEntry = {
    campaignId: entry.campaignId,
    topic: entry.topic || existing?.topic || "PolyPost Campaign",
    masterPlatformId: entry.masterPlatformId || existing?.masterPlatformId || "unknown",
    accountId: entry.accountId || existing?.accountId || "default",
    mediaPath: entry.mediaPath,
    existingMasterUrl: entry.existingMasterUrl,
    firstCommentTemplate: entry.firstCommentTemplate,
    priceOverrides: entry.priceOverrides,
    accountOverrides: entry.accountOverrides,
    step: entry.step,
    liveMasterUrl: entry.liveMasterUrl,
    masterSimulated: entry.masterSimulated,
    masterError: entry.masterError,
    teaserCount: "teaserCount" in entry ? entry.teaserCount : teasers.length,
    publishedCount:
      "publishedCount" in entry
        ? entry.publishedCount
        : teasers.filter((t) => t.status === "published").length,
    failedCount:
      "failedCount" in entry
        ? entry.failedCount
        : teasers.filter((t) => t.status === "failed").length,
    teasers,
    createdAt: "createdAt" in entry ? entry.createdAt : existing?.createdAt || Date.now(),
    updatedAt: entry.updatedAt || Date.now(),
  };
  const current = getClientHistory().filter((e) => e.campaignId !== normalized.campaignId);
  const next = [normalized, ...current].slice(0, 100);
  writeStorageJson(HISTORY_KEY, next);
  return next;
}

export function deleteClientHistory(campaignId?: string, onlySimulated = false): CampaignHistoryEntry[] {
  const current = getClientHistory();
  const next = onlySimulated
    ? current.filter((e) => e.masterSimulated !== true)
    : campaignId
    ? current.filter((e) => e.campaignId !== campaignId)
    : [];
  writeStorageJson(HISTORY_KEY, next);
  return next;
}

export function mergeHistoryWithClient(serverHistory: CampaignHistoryEntry[]): CampaignHistoryEntry[] {
  const byId = new Map<string, CampaignHistoryEntry>();
  for (const item of serverHistory) byId.set(item.campaignId, item);
  for (const item of getClientHistory()) byId.set(item.campaignId, item);
  return Array.from(byId.values()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function getSavedCompanionUrl(): string {
  if (typeof window === "undefined") return "";
  return (window.localStorage.getItem(COMPANION_URL_KEY) || "").trim().replace(/\/+$/, "");
}

export function setSavedCompanionUrl(url: string): string {
  const normalized = url.trim().replace(/\/+$/, "");
  if (typeof window !== "undefined") {
    if (normalized) {
      window.localStorage.setItem(COMPANION_URL_KEY, normalized);
    } else {
      window.localStorage.removeItem(COMPANION_URL_KEY);
    }
  }
  return normalized;
}
