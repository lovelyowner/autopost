import { assertSimulationAllowed, type ConnectorResult, type PlatformConnector, type PostPayload } from "./types";

export class WordPressConnector implements PlatformConnector {
  constructor(public id = "wordpress") {}

  async publish(payload: PostPayload): Promise<ConnectorResult> {
    const rawSite = payload.credentials?.siteUrl ?? process.env.WORDPRESS_SITE_URL ?? "";
    const siteUrl = rawSite.replace(/\/+$/, "");
    const username = payload.credentials?.username ?? process.env.WORDPRESS_USERNAME;
    const appPassword = payload.credentials?.appPassword ?? process.env.WORDPRESS_APP_PASSWORD;

    if (!siteUrl || !username || !appPassword) {
      assertSimulationAllowed(
        payload.strictLive,
        "WordPress live publish requires WORDPRESS_SITE_URL, WORDPRESS_USERNAME, and WORDPRESS_APP_PASSWORD.",
      );
      return {
        success: true,
        platformId: this.id,
        simulated: true,
        publishedUrl: `${siteUrl || "https://wordpress.example.com"}/?p=${Date.now()}`,
        postId: String(Date.now()),
      };
    }

    const lines = (payload.text || "").split("\n").filter(Boolean);
    const title = (lines[0] || "New Release").slice(0, 140);
    const contentHtml = payload.linkUrl
      ? `<p>${payload.text.replace(/\n/g, "<br/>")}</p><p><a href="${payload.linkUrl}">${payload.linkUrl}</a></p>`
      : `<p>${payload.text.replace(/\n/g, "<br/>")}</p>`;

    const auth = Buffer.from(`${username}:${appPassword}`).toString("base64");
    const res = await fetch(`${siteUrl}/wp-json/wp/v2/posts`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title,
        content: contentHtml,
        status: "publish",
      }),
    });

    if (!res.ok) {
      throw new Error(`WordPress REST publish failed (${res.status}): ${await res.text()}`);
    }

    const json = (await res.json()) as { id?: number; link?: string };
    return {
      success: true,
      platformId: this.id,
      publishedUrl: json.link || `${siteUrl}/?p=${json.id}`,
      postId: String(json.id || Date.now()),
    };
  }
}

export class DevToConnector implements PlatformConnector {
  constructor(public id = "devto") {}

  async publish(payload: PostPayload): Promise<ConnectorResult> {
    const apiKey = payload.credentials?.apiKey ?? process.env.DEVTO_API_KEY;
    if (!apiKey) {
      assertSimulationAllowed(
        payload.strictLive,
        "Dev.to live publish requires DEVTO_API_KEY.",
      );
      return {
        success: true,
        platformId: this.id,
        simulated: true,
        publishedUrl: `https://dev.to/creator/sim-${Date.now()}`,
        postId: String(Date.now()),
      };
    }

    const lines = (payload.text || "").split("\n").filter(Boolean);
    const title = (lines[0] || "New Release").slice(0, 120);
    const bodyMarkdown = payload.linkUrl
      ? `${payload.text}\n\n[Watch Full Release](${payload.linkUrl})`
      : payload.text;

    const res = await fetch("https://dev.to/api/articles", {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        article: {
          title,
          published: true,
          body_markdown: bodyMarkdown,
          tags: (payload.tags || []).slice(0, 4).map((t) => t.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()),
        },
      }),
    });

    if (!res.ok) {
      throw new Error(`Dev.to publish failed (${res.status}): ${await res.text()}`);
    }

    const json = (await res.json()) as { id?: number; url?: string };
    return {
      success: true,
      platformId: this.id,
      publishedUrl: json.url || `https://dev.to/p/${json.id}`,
      postId: String(json.id || Date.now()),
    };
  }
}

export class RevoltStoatConnector implements PlatformConnector {
  constructor(public id = "stoat") {}

  async publish(payload: PostPayload): Promise<ConnectorResult> {
    const token = payload.credentials?.botToken ?? process.env.REVOLT_BOT_TOKEN;
    const channelId = payload.credentials?.channelId ?? process.env.REVOLT_CHANNEL_ID;
    const apiUrl = (
      payload.credentials?.apiUrl ??
      process.env.REVOLT_API_URL ??
      "https://api.revolt.chat"
    ).replace(/\/$/, "");
    if (!token || !channelId) {
      assertSimulationAllowed(
        payload.strictLive,
        "Stoat (Revolt) live publish requires REVOLT_BOT_TOKEN and REVOLT_CHANNEL_ID.",
      );
      return {
        success: true,
        platformId: this.id,
        simulated: true,
        publishedUrl: `https://app.revolt.chat/channel/${channelId || "general"}/${Date.now()}`,
        postId: String(Date.now()),
      };
    }

    const content =
      payload.firstComment || !payload.linkUrl
        ? payload.text
        : `${payload.text}\n${payload.linkUrl}`;

    const res = await fetch(`${apiUrl}/channels/${encodeURIComponent(channelId)}/messages`, {
      method: "POST",
      headers: {
        "x-bot-token": token,
        "x-session-token": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content }),
    });

    if (!res.ok) {
      throw new Error(`Stoat/Revolt message failed (${res.status}): ${await res.text()}`);
    }

    const json = (await res.json()) as { _id?: string };
    const msgId = json._id || String(Date.now());
    return {
      success: true,
      platformId: this.id,
      publishedUrl: `https://app.revolt.chat/channel/${channelId}/${msgId}`,
      postId: msgId,
    };
  }
}

export class VkConnector implements PlatformConnector {
  constructor(public id = "vk") {}

  async publish(payload: PostPayload): Promise<ConnectorResult> {
    const accessToken = payload.credentials?.accessToken ?? process.env.VK_ACCESS_TOKEN;
    const ownerId = payload.credentials?.ownerId ?? process.env.VK_OWNER_ID;
    if (!accessToken || !ownerId) {
      assertSimulationAllowed(
        payload.strictLive,
        "VK live publish requires VK_ACCESS_TOKEN and VK_OWNER_ID.",
      );
      return {
        success: true,
        platformId: this.id,
        simulated: true,
        publishedUrl: `https://vk.com/wall${ownerId || "1"}_${Date.now()}`,
        postId: String(Date.now()),
      };
    }

    const message =
      payload.firstComment || !payload.linkUrl
        ? payload.text
        : `${payload.text}\n${payload.linkUrl}`;

    const params = new URLSearchParams({
      owner_id: ownerId,
      message,
      v: "5.199",
      access_token: accessToken,
    });
    if (payload.linkUrl) {
      params.set("attachments", payload.linkUrl);
    }

    const res = await fetch(`https://api.vk.com/method/wall.post?${params.toString()}`, {
      method: "POST",
    });
    const json = (await res.json()) as { response?: { post_id?: number }; error?: { error_msg?: string } };
    if (!res.ok || json.error) {
      throw new Error(`VK wall.post failed: ${json.error?.error_msg || res.status}`);
    }

    const postId = json.response?.post_id || Date.now();
    return {
      success: true,
      platformId: this.id,
      publishedUrl: `https://vk.com/wall${ownerId}_${postId}`,
      postId: String(postId),
    };
  }
}
