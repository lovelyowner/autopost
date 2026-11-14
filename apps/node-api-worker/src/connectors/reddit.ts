import { assertSimulationAllowed, type ConnectorResult, type PlatformConnector, type PostPayload } from "./types";

export class RedditConnector implements PlatformConnector {
  constructor(
    public id = "reddit",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async publish(payload: PostPayload): Promise<ConnectorResult> {
    const clientId = payload.credentials?.clientId ?? process.env.REDDIT_CLIENT_ID;
    const clientSecret = payload.credentials?.clientSecret ?? process.env.REDDIT_CLIENT_SECRET;
    const username = payload.credentials?.username ?? process.env.REDDIT_USERNAME;
    const password = payload.credentials?.password ?? process.env.REDDIT_PASSWORD;
    let bearerToken = payload.credentials?.accessToken ?? process.env.REDDIT_ACCESS_TOKEN;

    const subreddit = (
      payload.extraParams?.subreddit ??
      payload.credentials?.subreddit ??
      process.env.REDDIT_SUBREDDIT ??
      ""
    ).replace(/^r\//i, "");

    if (!bearerToken && (!clientId || !clientSecret || !username || !password)) {
      assertSimulationAllowed(
        payload.strictLive,
        `Reddit (${this.id}) live publish requires REDDIT_ACCESS_TOKEN or REDDIT_CLIENT_ID/REDDIT_CLIENT_SECRET/REDDIT_USERNAME/REDDIT_PASSWORD.`,
      );
      return {
        success: true,
        platformId: this.id,
        simulated: true,
        publishedUrl: `https://reddit.com/r/${subreddit || "test"}/comments/sim_${Date.now()}`,
        postId: `t3_sim_${Date.now()}`,
      };
    }

    const userAgent = process.env.REDDIT_USER_AGENT || "PolyPost/0.1.0 (creator automation)";

    if (!bearerToken) {
      const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
      const tokenRes = await this.fetchImpl("https://www.reddit.com/api/v1/access_token", {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": userAgent,
        },
        body: new URLSearchParams({
          grant_type: "password",
          username: username!,
          password: password!,
        }),
      });
      if (!tokenRes.ok) {
        throw new Error(`Reddit OAuth token failed: ${tokenRes.status} ${await tokenRes.text()}`);
      }
      const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: string };
      if (!tokenJson.access_token) {
        throw new Error(`Reddit OAuth token error: ${tokenJson.error ?? "missing access_token"}`);
      }
      bearerToken = tokenJson.access_token;
    }

    const title = payload.text.split("\n")[0]?.slice(0, 300) || "New Release";
    const kind = payload.linkUrl && !payload.firstComment ? "link" : "self";
    const submitForm = new URLSearchParams({
      api_type: "json",
      sr: subreddit || "u_" + (username || "me"),
      kind,
      title,
      nsfw: this.id === "reddit_nsfw" ? "true" : "false",
    });
    if (kind === "link" && payload.linkUrl) {
      submitForm.set("url", payload.linkUrl);
    } else {
      submitForm.set("text", payload.text);
    }

    const submitRes = await this.fetchImpl("https://oauth.reddit.com/api/submit", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": userAgent,
      },
      body: submitForm,
    });
    const submitJson = (await submitRes.json()) as {
      json?: { data?: { url?: string; name?: string; id?: string }; errors?: any[] };
    };
    if (!submitRes.ok || (submitJson.json?.errors && submitJson.json.errors.length > 0)) {
      throw new Error(
        `Reddit submit failed: ${submitRes.status} ${JSON.stringify(submitJson.json?.errors ?? submitJson)}`,
      );
    }

    const postFullname = submitJson.json?.data?.name;
    const publishedUrl = submitJson.json?.data?.url ?? `https://reddit.com/${submitJson.json?.data?.id ?? ""}`;

    let firstCommentId: string | undefined;
    if (payload.firstComment && postFullname) {
      const commentRes = await this.fetchImpl("https://oauth.reddit.com/api/comment", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": userAgent,
        },
        body: new URLSearchParams({
          api_type: "json",
          thing_id: postFullname,
          text: payload.firstComment,
        }),
      });
      if (commentRes.ok) {
        const cJson = (await commentRes.json()) as any;
        firstCommentId = cJson?.json?.data?.things?.[0]?.data?.name;
      }
    }

    return {
      success: true,
      platformId: this.id,
      simulated: false,
      publishedUrl,
      postId: postFullname,
      firstCommentId,
    };
  }
}
