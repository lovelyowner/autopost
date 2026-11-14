import { assertSimulationAllowed, type ConnectorResult, type PlatformConnector, type PostPayload } from "./types";

export class LemmyConnector implements PlatformConnector {
  constructor(public id = "lemmy") {}

  async publish(payload: PostPayload): Promise<ConnectorResult> {
    const rawHost = payload.credentials?.host ?? process.env.LEMMY_HOST ?? "lemmy.world";
    const host = rawHost.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
    const username = payload.credentials?.username ?? process.env.LEMMY_USERNAME;
    const password = payload.credentials?.password ?? process.env.LEMMY_PASSWORD;
    let jwt = payload.credentials?.accessToken ?? process.env.LEMMY_JWT;
    const communityName = (
      payload.extraParams?.subreddit ??
      payload.credentials?.community ??
      process.env.LEMMY_COMMUNITY ??
      ""
    )
      .replace(/^[!c/]+/i, "")
      .trim();

    if (!jwt && (!username || !password)) {
      assertSimulationAllowed(
        payload.strictLive,
        `Lemmy/PieFed (${this.id}) live publish requires LEMMY_USERNAME + LEMMY_PASSWORD (or LEMMY_JWT) and LEMMY_COMMUNITY.`,
      );
      return {
        success: true,
        platformId: this.id,
        simulated: true,
        publishedUrl: `https://${host}/post/sim_${Date.now()}`,
        postId: `sim_${Date.now()}`,
      };
    }

    if (!jwt) {
      const loginRes = await fetch(`https://${host}/api/v3/user/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username_or_email: username,
          password,
        }),
      });
      if (!loginRes.ok) {
        throw new Error(`Lemmy login failed (${loginRes.status}): ${await loginRes.text()}`);
      }
      const loginJson = (await loginRes.json()) as { jwt?: string };
      if (!loginJson.jwt) {
        throw new Error("Lemmy login did not return a JWT token.");
      }
      jwt = loginJson.jwt;
    }

    if (!communityName) {
      throw new Error("Lemmy publish requires LEMMY_COMMUNITY (or per-account override alias:community).");
    }

    const commRes = await fetch(
      `https://${host}/api/v3/community?name=${encodeURIComponent(communityName)}`,
      {
        headers: { Authorization: `Bearer ${jwt}` },
      },
    );
    if (!commRes.ok) {
      throw new Error(`Lemmy community lookup '${communityName}' failed (${commRes.status})`);
    }
    const commJson = (await commRes.json()) as { community_view?: { community?: { id?: number } } };
    const communityId = commJson.community_view?.community?.id;
    if (!communityId) {
      throw new Error(`Lemmy community '${communityName}' not found on ${host}`);
    }

    const lines = (payload.text || "").split("\n").filter(Boolean);
    const title = (lines[0] || "New Release").slice(0, 190);
    const postRes = await fetch(`https://${host}/api/v3/post`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: title,
        community_id: communityId,
        url: payload.linkUrl || undefined,
        body: payload.text,
        auth: jwt,
      }),
    });

    if (!postRes.ok) {
      throw new Error(`Lemmy post creation failed (${postRes.status}): ${await postRes.text()}`);
    }
    const postJson = (await postRes.json()) as {
      post_view?: { post?: { id?: number; ap_id?: string } };
    };
    const postId = postJson.post_view?.post?.id;
    const publishedUrl =
      postJson.post_view?.post?.ap_id || `https://${host}/post/${postId ?? Date.now()}`;

    let firstCommentId: string | undefined;
    let firstCommentUrl: string | undefined;
    if (payload.firstComment && typeof postId === "number") {
      const commentRes = await fetch(`https://${host}/api/v3/comment`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: payload.firstComment,
          post_id: postId,
          auth: jwt,
        }),
      });
      if (commentRes.ok) {
        const cJson = (await commentRes.json()) as { comment_view?: { comment?: { id?: number } } };
        if (cJson.comment_view?.comment?.id) {
          firstCommentId = String(cJson.comment_view.comment.id);
          firstCommentUrl = `https://${host}/comment/${firstCommentId}`;
        }
      }
    }

    return {
      success: true,
      platformId: this.id,
      publishedUrl,
      postId: String(postId ?? Date.now()),
      firstCommentId,
      firstCommentUrl,
    };
  }
}
