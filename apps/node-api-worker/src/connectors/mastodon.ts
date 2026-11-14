import { existsSync, openAsBlob } from "node:fs";
import { basename } from "node:path";
import { assertSimulationAllowed, type ConnectorResult, type PlatformConnector, type PostPayload } from "./types";

export class MastodonConnector implements PlatformConnector {
  constructor(public id = "mastodon") {}

  async publish(payload: PostPayload): Promise<ConnectorResult> {
    const accessToken = payload.credentials?.accessToken ?? process.env.MASTODON_ACCESS_TOKEN;
    const host = payload.credentials?.host ?? process.env.MASTODON_HOST ?? "mastodon.social";

    if (!accessToken) {
      assertSimulationAllowed(
        payload.strictLive,
        `Mastodon/Fediverse (${this.id}) live publish requires MASTODON_ACCESS_TOKEN.`,
      );
      return {
        success: true,
        platformId: this.id,
        simulated: true,
        publishedUrl: `https://${host}/@user/sim_${Date.now()}`,
        postId: `sim_${Date.now()}`,
      };
    }

    let mediaId: string | undefined;

    if (payload.filePath && existsSync(payload.filePath)) {
      const formData = new FormData();
      formData.append("file", await openAsBlob(payload.filePath), basename(payload.filePath));
      formData.append("description", payload.text.slice(0, 100));

      const mediaRes = await fetch(`https://${host}/api/v1/media`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        body: formData,
      });

      if (!mediaRes.ok) {
        throw new Error(`Mastodon media upload failed: ${mediaRes.status} ${await mediaRes.text()}`);
      }

      const mediaJson = (await mediaRes.json()) as { id: string };
      mediaId = mediaJson.id;
    }

    const statusText =
      payload.firstComment || !payload.linkUrl
        ? payload.text
        : `${payload.text}\n\n${payload.linkUrl}`;

    const body: Record<string, any> = {
      status: statusText,
    };
    if (mediaId) {
      body.media_ids = [mediaId];
    }

    const postRes = await fetch(`https://${host}/api/v1/statuses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!postRes.ok) {
      throw new Error(`Mastodon status failed: ${postRes.status} ${await postRes.text()}`);
    }

    const postJson = (await postRes.json()) as { id: string; url: string };

    let firstCommentId: string | undefined;
    let firstCommentUrl: string | undefined;
    if (payload.firstComment) {
      const replyRes = await fetch(`https://${host}/api/v1/statuses`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status: payload.firstComment,
          in_reply_to_id: postJson.id,
        }),
      });
      if (replyRes.ok) {
        const replyJson = (await replyRes.json()) as { id: string; url: string };
        firstCommentId = replyJson.id;
        firstCommentUrl = replyJson.url;
      }
    }

    return {
      success: true,
      platformId: this.id,
      simulated: false,
      publishedUrl: postJson.url,
      postId: postJson.id,
      firstCommentId,
      firstCommentUrl,
    };
  }
}
