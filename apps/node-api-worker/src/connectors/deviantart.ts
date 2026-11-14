import { existsSync, openAsBlob } from "node:fs";
import { basename } from "node:path";
import { assertSimulationAllowed, type ConnectorResult, type PlatformConnector, type PostPayload } from "./types";

export class DeviantArtConnector implements PlatformConnector {
  constructor(
    public id = "deviantart_mature",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async publish(payload: PostPayload): Promise<ConnectorResult> {
    const accessToken = payload.credentials?.accessToken ?? process.env.DEVIANTART_ACCESS_TOKEN;

    if (!accessToken) {
      assertSimulationAllowed(
        payload.strictLive,
        "DeviantArt live publish requires DEVIANTART_ACCESS_TOKEN.",
      );
      return {
        success: true,
        platformId: this.id,
        simulated: true,
        publishedUrl: `https://www.deviantart.com/deviation/sim_${Date.now()}`,
        postId: `sim_${Date.now()}`,
      };
    }

    if (!payload.filePath || !existsSync(payload.filePath)) {
      throw new Error(`DeviantArt upload requires an existing local filePath (got: ${payload.filePath || "none"}).`);
    }

    const title = payload.text.split("\n")[0]?.slice(0, 50) || "Studio Release";
    const submitForm = new FormData();
    submitForm.append("access_token", accessToken);
    submitForm.append("title", title);
    submitForm.append(
      "artist_comments",
      payload.linkUrl && !payload.firstComment ? `${payload.text}\n\n${payload.linkUrl}` : payload.text,
    );
    submitForm.append("file", await openAsBlob(payload.filePath), basename(payload.filePath));
    (payload.tags || []).forEach((tag, idx) => submitForm.append(`tags[${idx}]`, tag));

    const stashRes = await this.fetchImpl("https://www.deviantart.com/api/v1/oauth2/stash/submit", {
      method: "POST",
      body: submitForm,
    });
    const stashJson = (await stashRes.json()) as { itemid?: number; error_description?: string };
    if (!stashRes.ok || !stashJson.itemid) {
      throw new Error(`DeviantArt Sta.sh upload failed: ${stashRes.status} ${stashJson.error_description ?? ""}`);
    }

    const pubForm = new URLSearchParams({
      access_token: accessToken,
      itemid: String(stashJson.itemid),
      is_mature: "true",
      agree_submission: "true",
      agree_tos: "true",
    });
    const pubRes = await this.fetchImpl("https://www.deviantart.com/api/v1/oauth2/stash/publish", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: pubForm,
    });
    const pubJson = (await pubRes.json()) as { url?: string; deviationid?: string; error_description?: string };
    if (!pubRes.ok || !pubJson.url) {
      throw new Error(`DeviantArt publish failed: ${pubRes.status} ${pubJson.error_description ?? ""}`);
    }

    return {
      success: true,
      platformId: this.id,
      simulated: false,
      publishedUrl: pubJson.url,
      postId: pubJson.deviationid ?? String(stashJson.itemid),
    };
  }
}
