import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type OAuthProviderId = "youtube" | "x" | "pinterest" | "tiktok" | "custom";

export interface OAuthTokenRecord {
  accountId: string;
  provider: OAuthProviderId;
  accessToken: string;
  refreshToken: string;
  expiresAtMs: number;
  clientId?: string;
  clientSecret?: string;
  tokenUrl?: string;
  updatedAtMs?: number;
}

const DEFAULT_TOKEN_ENDPOINTS: Record<OAuthProviderId, string> = {
  youtube: "https://oauth2.googleapis.com/token",
  x: "https://api.x.com/2/oauth2/token",
  pinterest: "https://api.pinterest.com/v5/oauth/token",
  tiktok: "https://open.tiktokapis.com/v2/oauth/token/",
  custom: "",
};

/** Default 15-minute lead buffer before expiry. */
export const DEFAULT_REFRESH_WINDOW_MS = 15 * 60 * 1000;

export class OAuthTokenManager {
  constructor(
    public readonly storePath: string = resolve(process.cwd(), "config/oauth-tokens.json"),
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  loadTokens(): OAuthTokenRecord[] {
    if (!existsSync(this.storePath)) return [];
    try {
      const raw = JSON.parse(readFileSync(this.storePath, "utf-8"));
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  saveTokens(records: OAuthTokenRecord[]): void {
    const dir = dirname(this.storePath);
    mkdirSync(dir, { recursive: true });
    writeFileSync(this.storePath, JSON.stringify(records, null, 2), "utf-8");
  }

  needsRefresh(record: OAuthTokenRecord, nowMs = Date.now(), windowMs = DEFAULT_REFRESH_WINDOW_MS): boolean {
    if (!record.refreshToken) return false;
    return record.expiresAtMs - nowMs <= windowMs;
  }

  async refreshToken(record: OAuthTokenRecord, nowMs = Date.now()): Promise<OAuthTokenRecord> {
    const endpoint = record.tokenUrl || DEFAULT_TOKEN_ENDPOINTS[record.provider];
    if (!endpoint) {
      throw new Error(`No OAuth token endpoint configured for provider '${record.provider}'.`);
    }

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: record.refreshToken,
    });
    if (record.clientId) body.set("client_id", record.clientId);
    if (record.clientSecret) body.set("client_secret", record.clientSecret);

    const res = await this.fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      throw new Error(`OAuth refresh failed for ${record.provider}/${record.accountId}: ${res.status} ${await res.text()}`);
    }

    const json = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    return {
      ...record,
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? record.refreshToken,
      expiresAtMs: nowMs + (json.expires_in ?? 3600) * 1000,
      updatedAtMs: nowMs,
    };
  }

  async refreshExpiring(nowMs = Date.now(), windowMs = DEFAULT_REFRESH_WINDOW_MS): Promise<{
    refreshed: string[];
    errors: Array<{ key: string; error: string }>;
  }> {
    const records = this.loadTokens();
    const refreshed: string[] = [];
    const errors: Array<{ key: string; error: string }> = [];
    let changed = false;

    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      if (!this.needsRefresh(rec, nowMs, windowMs)) continue;
      const key = `${rec.provider}:${rec.accountId}`;
      try {
        records[i] = await this.refreshToken(rec, nowMs);
        refreshed.push(key);
        changed = true;
      } catch (err: any) {
        errors.push({ key, error: err?.message ?? String(err) });
      }
    }

    if (changed) {
      this.saveTokens(records);
    }
    return { refreshed, errors };
  }

  startAutoRefreshLoop(intervalMs = 5 * 60 * 1000): () => void {
    const timer = setInterval(() => {
      void this.refreshExpiring().catch(() => {});
    }, intervalMs);
    if (typeof (timer as any).unref === "function") {
      (timer as any).unref();
    }
    return () => clearInterval(timer);
  }
}
