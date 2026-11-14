import { createReadStream, existsSync, statSync } from "node:fs";
import { assertSimulationAllowed, type ConnectorResult, type PlatformConnector, type PostPayload } from "./types";

export class BlueskyConnector implements PlatformConnector {
  id = "bluesky";

  async publish(payload: PostPayload): Promise<ConnectorResult> {
    const identifier = payload.credentials?.identifier ?? process.env.BLUESKY_IDENTIFIER;
    const password = payload.credentials?.password ?? process.env.BLUESKY_PASSWORD;
    const host = payload.credentials?.host ?? process.env.BLUESKY_HOST ?? "bsky.social";

    if (!identifier || !password) {
      assertSimulationAllowed(
        payload.strictLive,
        "Bluesky live publish requires BLUESKY_IDENTIFIER and BLUESKY_PASSWORD (or account credentials).",
      );
      return {
        success: true,
        platformId: this.id,
        simulated: true,
        publishedUrl: `https://bsky.app/profile/${identifier || "user.bsky.social"}/post/sim_${Date.now()}`,
        postId: `sim_${Date.now()}`,
      };
    }

    // 1. Create AT Protocol session
    const sessionRes = await fetch(`https://${host}/xrpc/com.atproto.server.createSession`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password }),
    });

    if (!sessionRes.ok) {
      throw new Error(`Bluesky auth failed: ${sessionRes.status} ${await sessionRes.text()}`);
    }

    const session = (await sessionRes.json()) as { accessJwt: string; did: string; handle: string };
    let blobRef: any = null;

    // 2. Upload blob if local media file exists on disk
    if (payload.filePath && existsSync(payload.filePath)) {
      const stats = statSync(payload.filePath);
      const isImg = payload.isStillImage ?? true;
      const mimeType = isImg ? "image/jpeg" : "video/mp4";

      const nodeStream = createReadStream(payload.filePath);
      const uploadRes = await fetch(`https://${host}/xrpc/com.atproto.repo.uploadBlob`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.accessJwt}`,
          "Content-Type": mimeType,
          "Content-Length": String(stats.size),
        },
        body: nodeStream as any,
        duplex: "half",
      } as any);

      if (!uploadRes.ok) {
        throw new Error(`Bluesky blob upload failed: ${uploadRes.status} ${await uploadRes.text()}`);
      }

      const uploadJson = (await uploadRes.json()) as { blob: any };
      blobRef = uploadJson.blob;
    }

    // 3. Create main post record (omit inline link when posting link in first reply)
    const mainText =
      payload.firstComment || !payload.linkUrl
        ? payload.text
        : `${payload.text}\n\n${payload.linkUrl}`;

    const record: any = {
      $type: "app.bsky.feed.post",
      text: mainText,
      createdAt: new Date().toISOString(),
    };

    if (blobRef) {
      record.embed = {
        $type: "app.bsky.embed.images",
        images: [{ alt: payload.text.slice(0, 100), image: blobRef }],
      };
    }

    const postRes = await fetch(`https://${host}/xrpc/com.atproto.repo.createRecord`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.accessJwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        repo: session.did,
        collection: "app.bsky.feed.post",
        record,
      }),
    });

    if (!postRes.ok) {
      throw new Error(`Bluesky post creation failed: ${postRes.status} ${await postRes.text()}`);
    }

    const postJson = (await postRes.json()) as { uri: string; cid: string };
    const rkey = postJson.uri.split("/").pop();
    const publishedUrl = `https://bsky.app/profile/${session.handle}/post/${rkey}`;

    // 4. Optional First-Comment Funnel Reply
    let firstCommentId: string | undefined;
    let firstCommentUrl: string | undefined;
    if (payload.firstComment) {
      const replyRes = await fetch(`https://${host}/xrpc/com.atproto.repo.createRecord`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.accessJwt}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          repo: session.did,
          collection: "app.bsky.feed.post",
          record: {
            $type: "app.bsky.feed.post",
            text: payload.firstComment,
            reply: {
              root: { uri: postJson.uri, cid: postJson.cid },
              parent: { uri: postJson.uri, cid: postJson.cid },
            },
            createdAt: new Date().toISOString(),
          },
        }),
      });
      if (replyRes.ok) {
        const replyJson = (await replyRes.json()) as { uri: string; cid: string };
        firstCommentId = replyJson.uri;
        const replyRkey = replyJson.uri.split("/").pop();
        firstCommentUrl = `https://bsky.app/profile/${session.handle}/post/${replyRkey}`;
      }
    }

    return {
      success: true,
      platformId: this.id,
      simulated: false,
      publishedUrl,
      postId: postJson.uri,
      firstCommentId,
      firstCommentUrl,
    };
  }
}
