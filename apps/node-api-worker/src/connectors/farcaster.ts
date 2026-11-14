import { assertSimulationAllowed, type ConnectorResult, type PlatformConnector, type PostPayload } from "./types";

export class FarcasterConnector implements PlatformConnector {
  constructor(public id = "farcaster") {}

  async publish(payload: PostPayload): Promise<ConnectorResult> {
    const apiKey = payload.credentials?.apiKey ?? process.env.FARCASTER_NEYNAR_API_KEY;
    const signerUuid = payload.credentials?.signerUuid ?? process.env.FARCASTER_SIGNER_UUID;

    if (!apiKey || !signerUuid) {
      assertSimulationAllowed(
        payload.strictLive,
        "Farcaster (Warpcast) live publish requires FARCASTER_NEYNAR_API_KEY and FARCASTER_SIGNER_UUID.",
      );
      return {
        success: true,
        platformId: this.id,
        simulated: true,
        publishedUrl: `https://warpcast.com/~/conversations/0xsim${Date.now().toString(16)}`,
        postId: `0xsim${Date.now().toString(16)}`,
      };
    }

    const castText =
      payload.firstComment || !payload.linkUrl
        ? payload.text.slice(0, 320)
        : `${payload.text.slice(0, 240)}\n${payload.linkUrl}`;

    const embeds = payload.linkUrl && !payload.firstComment ? [{ url: payload.linkUrl }] : [];

    const res = await fetch("https://api.neynar.com/v2/farcaster/cast", {
      method: "POST",
      headers: {
        accept: "application/json",
        api_key: apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        signer_uuid: signerUuid,
        text: castText,
        embeds,
      }),
    });

    if (!res.ok) {
      throw new Error(`Farcaster Neynar cast failed (${res.status}): ${await res.text()}`);
    }

    const json = (await res.json()) as { cast?: { hash?: string } };
    const hash = json.cast?.hash || `0x${Date.now().toString(16)}`;
    const publishedUrl = `https://warpcast.com/~/conversations/${hash}`;

    let firstCommentId: string | undefined;
    let firstCommentUrl: string | undefined;
    if (payload.firstComment && json.cast?.hash) {
      const replyRes = await fetch("https://api.neynar.com/v2/farcaster/cast", {
        method: "POST",
        headers: {
          accept: "application/json",
          api_key: apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          signer_uuid: signerUuid,
          text: payload.firstComment.slice(0, 320),
          parent: json.cast.hash,
          embeds: payload.linkUrl ? [{ url: payload.linkUrl }] : [],
        }),
      });
      if (replyRes.ok) {
        const rJson = (await replyRes.json()) as { cast?: { hash?: string } };
        if (rJson.cast?.hash) {
          firstCommentId = rJson.cast.hash;
          firstCommentUrl = `https://warpcast.com/~/conversations/${rJson.cast.hash}`;
        }
      }
    }

    return {
      success: true,
      platformId: this.id,
      publishedUrl,
      postId: hash,
      firstCommentId,
      firstCommentUrl,
    };
  }
}
