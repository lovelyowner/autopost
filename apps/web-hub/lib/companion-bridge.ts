import { getSavedCompanionUrl, setSavedCompanionUrl } from "@/lib/client-vault";

export const DEFAULT_LOCAL_COMPANION_URL = "http://127.0.0.1:8001";
export const COMPANION_CHANGED_EVENT = "polypost:companion-changed";
export const CREDENTIALS_CHANGED_EVENT = "polypost:credentials-changed";

export function notifyCompanionChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(COMPANION_CHANGED_EVENT));
  }
}

export function notifyCredentialsChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CREDENTIALS_CHANGED_EVENT));
  }
}

const VAULT_TO_WORKER_PATH: Record<string, string> = {
  "/api/vault/profiles": "/api/profiles",
  "/api/vault/proxies": "/api/proxies",
  "/api/vault/proxies/test": "/api/proxies/test",
  "/api/vault/login": "/api/sessions/login",
  "/api/vault/login/complete": "/api/sessions/login/complete",
  "/api/vault/import": "/api/sessions/import",
  "/api/vault/health": "/api/sessions/health",
  "/api/vault/audit-all": "/api/sessions/audit-all",
  "/api/vault/inspect": "/api/sessions/inspect",
  "/api/vault/bundle": "/api/vault/bundle",
};

function mapVaultPathToWorkerPath(apiPath: string): string {
  if (VAULT_TO_WORKER_PATH[apiPath]) return VAULT_TO_WORKER_PATH[apiPath];
  if (apiPath.startsWith("/api/vault/profiles/")) {
    return apiPath.replace("/api/vault/profiles/", "/api/profiles/");
  }
  if (apiPath.startsWith("/api/vault/previews/")) {
    return apiPath.replace("/api/vault/previews/", "/api/previews/");
  }
  if (apiPath.startsWith("/api/vault/selectors")) {
    const query = apiPath.split("?")[1] || "";
    const params = new URLSearchParams(query);
    const platform = params.get("platform");
    if (platform) return `/api/selectors/${encodeURIComponent(platform)}`;
  }
  return apiPath;
}

export async function probeCompanionUrl(baseUrl: string): Promise<{ ok: boolean; profiles: any[] }> {
  const clean = baseUrl.trim().replace(/\/+$/, "");
  if (!clean) return { ok: false, profiles: [] };
  try {
    const healthRes = await fetch(`${clean}/health`, {
      mode: "cors",
      signal: AbortSignal.timeout(1800),
    });
    if (!healthRes.ok) return { ok: false, profiles: [] };
    const profRes = await fetch(`${clean}/api/profiles`, {
      mode: "cors",
      signal: AbortSignal.timeout(2000),
    });
    if (!profRes.ok) return { ok: true, profiles: [] };
    const profData = await profRes.json();
    return {
      ok: true,
      profiles: Array.isArray(profData.profiles) ? profData.profiles : [],
    };
  } catch {
    return { ok: false, profiles: [] };
  }
}

/** Auto-detect either saved custom companion URL or visitor's local 127.0.0.1:8001 worker. */
export async function detectActiveCompanion(): Promise<{
  url: string;
  profiles: any[];
} | null> {
  const saved = getSavedCompanionUrl();
  const candidates = Array.from(new Set([saved, DEFAULT_LOCAL_COMPANION_URL].filter(Boolean)));
  for (const candidate of candidates) {
    const probe = await probeCompanionUrl(candidate);
    if (probe.ok) {
      if (candidate !== saved) {
        setSavedCompanionUrl(candidate);
        notifyCompanionChanged();
      }
      return { url: candidate, profiles: probe.profiles };
    }
  }
  if (saved === DEFAULT_LOCAL_COMPANION_URL) {
    setSavedCompanionUrl("");
  }
  return null;
}

/**
 * Route a vault API request either to the configured browser-direct companion worker
 * or to the Next.js server `/api/vault/*` endpoint.
 */
export async function vaultApiFetch(
  apiPath: string,
  init?: RequestInit,
  preferDirectUrl?: string,
): Promise<Response> {
  const directBase = (preferDirectUrl ?? getSavedCompanionUrl()).trim().replace(/\/+$/, "");
  if (directBase) {
    const workerPath = mapVaultPathToWorkerPath(apiPath);
    if (workerPath.startsWith("/api/") && !workerPath.startsWith("/api/vault/")) {
      return fetch(`${directBase}${workerPath}`, {
        ...init,
        mode: "cors",
      });
    }
    if (apiPath === "/api/vault/bundle") {
      return fetch(`${directBase}/api/vault/bundle`, { ...init, mode: "cors" });
    }
  }
  return fetch(apiPath, init);
}

/**
 * Stream a selected file straight from the browser to the user's running local
 * Companion Worker (:8001) so even large videos stay local and bypass Vercel limits.
 */
export async function stageMediaToCompanion(
  companionBaseUrl: string,
  file: File,
): Promise<{ success: boolean; filePath: string; originalName: string; sizeMb: number }> {
  const clean = companionBaseUrl.trim().replace(/\/+$/, "");
  const res = await fetch(`${clean}/api/media/stage?filename=${encodeURIComponent(file.name)}`, {
    method: "POST",
    mode: "cors",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.detail || data.error || "Local companion staging failed");
  }
  return data;
}

export interface CompanionUploadParams {
  jobId: string;
  accountId: string;
  platformId: string;
  filePath?: string;
  mediaDataUrl?: string;
  title: string;
  description: string;
  tags?: string[];
  dryRun: boolean;
  confirmed2257Attestation?: boolean;
  recordsId2257?: string;
  extraParams?: Record<string, unknown>;
}

/**
 * Dispatch a stealth browser upload directly from the visitor's browser to their
 * local Chromium Companion Worker (:8001). Keeps cookies, proxies, and IP local.
 */
export async function dispatchCompanionUpload(
  companionBaseUrl: string,
  params: CompanionUploadParams,
): Promise<{
  success: boolean;
  simulated?: boolean;
  publishedUrl?: string;
  failureScreenshot?: string;
  error?: string;
}> {
  const clean = companionBaseUrl.trim().replace(/\/+$/, "");
  const res = await fetch(`${clean}/api/upload`, {
    method: "POST",
    mode: "cors",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      job_id: params.jobId,
      account_id: params.accountId || "default",
      platform_id: params.platformId,
      file_path: params.filePath || "",
      media_data_url: params.mediaDataUrl || undefined,
      title: params.title,
      description: params.description,
      tags: params.tags || [],
      dry_run: params.dryRun,
      confirmed_2257_attestation: Boolean(params.confirmed2257Attestation),
      records_id_2257: params.recordsId2257 || undefined,
      extra_params: params.extraParams || {},
    }),
    signal: AbortSignal.timeout(300_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail =
      typeof data.detail === "string"
        ? data.detail
        : data.detail?.message || data.error || `Companion upload HTTP ${res.status}`;
    return { success: false, error: detail };
  }
  return {
    success: Boolean(data.success),
    simulated: Boolean(data.dry_run),
    publishedUrl: data.published_url,
    failureScreenshot:
      typeof data.failure_screenshot === "string"
        ? data.failure_screenshot.split(/[\\/]/).pop()
        : undefined,
    error: data.error,
  };
}
