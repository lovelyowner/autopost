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
