import { assertSimulationAllowed, type ConnectorResult, type PlatformConnector, type PostPayload } from "./types";

export class TumblrConnector implements PlatformConnector {
  constructor(public id = "tumblr") {}

  async publish(payload: PostPayload): Promise<ConnectorResult> {
    const accessToken = payload.credentials?.accessToken ?? process.env.TUMBLR_ACCESS_TOKEN;
    const blog = (payload.credentials?.blog ?? process.env.TUMBLR_BLOG ?? "")
      .replace(/^https?:\/\//i, "")
      .replace(/\/+$/, "")
      .trim();

    if (!accessToken || !blog) {
      assertSimulationAllowed(
        payload.strictLive,
        `Tumblr live publish requires TUMBLR_BLOG and TUMBLR_ACCESS_TOKEN.`,
      );
      return {
        success: true,
        platformId: this.id,
        simulated: true,
        publishedUrl: `https://${blog || "creator.tumblr.com"}/post/sim_${Date.now()}`,
        postId: `sim_${Date.now()}`,
      };
    }

    const blogIdentifier = blog.includes(".") ? blog : `${blog}.tumblr.com`;
    const bodyText =
      payload.firstComment || !payload.linkUrl
        ? payload.text
        : `${payload.text}\n\n${payload.linkUrl}`;

    const contentBlocks: Array<Record<string, any>> = [
      {
        type: "text",
        text: bodyText,
      },
    ];
    if (payload.linkUrl) {
      contentBlocks.push({
        type: "link",
        url: payload.linkUrl,
      });
    }

    const res = await fetch(`https://api.tumblr.com/v2/blog/${encodeURIComponent(blogIdentifier)}/posts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: contentBlocks,
        tags: Array.isArray(payload.tags) ? payload.tags.join(",") : undefined,
      }),
    });

    if (!res.ok) {
      throw new Error(`Tumblr post failed (${res.status}): ${await res.text()}`);
    }

    const json = (await res.json()) as { response?: { id?: string | number } };
    const postId = String(json.response?.id || Date.now());
    return {
      success: true,
      platformId: this.id,
      publishedUrl: `https://${blogIdentifier}/post/${postId}`,
      postId,
    };
  }
}
