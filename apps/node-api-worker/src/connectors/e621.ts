import { existsSync, openAsBlob } from "node:fs";
import { basename } from "node:path";
import { assertSimulationAllowed, type ConnectorResult, type PlatformConnector, type PostPayload } from "./types";

export class E621Connector implements PlatformConnector {
  id = "e621";

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async publish(payload: PostPayload): Promise<ConnectorResult> {
    const username = payload.credentials?.username ?? process.env.E621_USERNAME;
    const apiKey = payload.credentials?.apiKey ?? process.env.E621_API_KEY;
    const userAgent = process.env.E621_USER_AGENT || `PolyPost/0.1.0 (by ${username || "polypost"})`;

    if (!username || !apiKey) {
      assertSimulationAllowed(
        payload.strictLive,
        "e621 live publish requires E621_USERNAME and E621_API_KEY.",
      );
      return {
        success: true,
        platformId: this.id,
        simulated: true,
        publishedUrl: `https://e621.net/posts/sim_${Date.now()}`,
        postId: `sim_${Date.now()}`,
      };
    }

    if (!payload.filePath || !existsSync(payload.filePath)) {
      throw new Error(`e621 upload requires an existing local filePath (got: ${payload.filePath || "none"}).`);
    }

    const tags = (payload.tags && payload.tags.length > 0 ? payload.tags : ["digital_media"])
      .map((t) => t.trim().replace(/\s+/g, "_"))
      .join(" ");
    const form = new FormData();
    form.append("upload[file]", await openAsBlob(payload.filePath), basename(payload.filePath));
    form.append("upload[tag_string]", tags);
    form.append("upload[rating]", String(payload.extraParams?.rating || "q"));
    form.append("upload[description]", payload.linkUrl ? `${payload.text}\n\n${payload.linkUrl}` : payload.text);
    if (payload.linkUrl) {
      form.append("upload[source]", payload.linkUrl);
    }

    const auth = Buffer.from(`${username}:${apiKey}`).toString("base64");
    const res = await this.fetchImpl("https://e621.net/uploads.json", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "User-Agent": userAgent,
      },
      body: form,
    });
    const json = (await res.json()) as { success?: boolean; post_id?: number; message?: string; reason?: string };
    if (!res.ok || json.success === false) {
      throw new Error(`e621 upload failed: ${res.status} ${json.message || json.reason || ""}`);
    }

    const postId = String(json.post_id ?? Date.now());
    return {
      success: true,
      platformId: this.id,
      simulated: false,
      publishedUrl: `https://e621.net/posts/${postId}`,
      postId,
    };
  }
}
