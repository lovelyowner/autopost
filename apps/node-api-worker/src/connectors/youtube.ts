import { existsSync, readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import { StealthWorkerBridgeConnector } from "./registry";
import { assertSimulationAllowed, type ConnectorResult, type PlatformConnector, type PostPayload } from "./types";

function detectVideoMimeType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case ".mov":
      return "video/quicktime";
    case ".webm":
      return "video/webm";
    case ".mkv":
      return "video/x-matroska";
    case ".avi":
      return "video/x-msvideo";
    default:
      return "video/mp4";
  }
}

export class YouTubeApiConnector implements PlatformConnector {
  id = "youtube";

  async publish(payload: PostPayload): Promise<ConnectorResult> {
    const stealthUrl = process.env.STEALTH_WORKER_URL ?? "http://localhost:8001";
    const targetAccount = payload.accountId?.trim();

    // 1. Prefer connected Stealth Browser Vault session if user connected YouTube Studio in Vault
    if (targetAccount) {
      try {
        const res = await fetch(`${stealthUrl}/api/profiles`, {
          signal: AbortSignal.timeout(1500),
        });
        if (res.ok) {
          const data = (await res.json()) as { profiles?: Array<{ account_id?: string }> };
          const hasVaultProfile = (data.profiles || []).some((p) => p.account_id === targetAccount);
          if (hasVaultProfile) {
            return await new StealthWorkerBridgeConnector(this.id, stealthUrl).publish(payload);
          }
        }
      } catch {
        // Stealth worker unreachable; fall through to YouTube Data API v3 check
      }
    }

    // 2. Otherwise use Google OAuth2 Access Token (GOOGLE_ACCESS_TOKEN) via YouTube Data API v3 resumable upload
    const accessToken = payload.credentials?.accessToken ?? process.env.GOOGLE_ACCESS_TOKEN;
    if (!accessToken) {
      assertSimulationAllowed(
        payload.strictLive,
        `YouTube live publish for '${targetAccount || "default"}' requires either a connected Browser Vault session or GOOGLE_ACCESS_TOKEN.`,
      );
      return {
        success: true,
        platformId: this.id,
        simulated: true,
        publishedUrl: `https://youtube.com/watch?v=sim_${Date.now()}`,
        postId: `sim_${Date.now()}`,
      };
    }

    if (!payload.filePath || !existsSync(payload.filePath)) {
      throw new Error("YouTube Data API v3 upload requires a valid local video file path.");
    }

    const fileSize = statSync(payload.filePath).size;
    const mimeType = detectVideoMimeType(payload.filePath);
    const lines = (payload.text || "").split("\n").filter(Boolean);
    const title = (lines[0] || "New Video").slice(0, 100);
    const description = payload.linkUrl && !payload.text.includes(payload.linkUrl)
      ? `${payload.text}\n\n${payload.linkUrl}`
      : payload.text;
    const privacyStatus = payload.extraParams?.privacyStatus || "public";

    const initRes = await fetch(
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Length": String(fileSize),
          "X-Upload-Content-Type": mimeType,
        },
        body: JSON.stringify({
          snippet: {
            title,
            description,
            tags: payload.tags?.slice(0, 15),
          },
          status: {
            privacyStatus,
          },
        }),
        signal: AbortSignal.timeout(20_000),
      },
    );

    if (!initRes.ok) {
      const errText = await initRes.text();
      return {
        success: false,
        platformId: this.id,
        error: `YouTube upload init failed (${initRes.status}): ${errText}`,
      };
    }

    const uploadUrl = initRes.headers.get("location");
    if (!uploadUrl) {
      return {
        success: false,
        platformId: this.id,
        error: "YouTube resumable upload missing Location header.",
      };
    }

    const bytes = readFileSync(payload.filePath);
    const putRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": mimeType,
        "Content-Length": String(bytes.byteLength),
      },
      body: bytes,
      signal: AbortSignal.timeout(300_000),
    });

    if (!putRes.ok) {
      const errText = await putRes.text();
      return {
        success: false,
        platformId: this.id,
        error: `YouTube video upload failed (${putRes.status}): ${errText}`,
      };
    }

    const uploaded = (await putRes.json()) as { id?: string };
    const videoId = uploaded?.id || `${Date.now()}`;
    return {
      success: true,
      platformId: this.id,
      simulated: false,
      publishedUrl: `https://www.youtube.com/watch?v=${videoId}`,
      postId: videoId,
    };
  }
}
