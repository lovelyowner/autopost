import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { assertSimulationAllowed, type ConnectorResult, type PlatformConnector, type PostPayload } from "./types";

export class MatrixConnector implements PlatformConnector {
  constructor(public id = "matrix") {}

  async publish(payload: PostPayload): Promise<ConnectorResult> {
    const rawServer = payload.credentials?.homeserver ?? process.env.MATRIX_HOMESERVER ?? "matrix.org";
    const homeserver = rawServer.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
    const accessToken = payload.credentials?.accessToken ?? process.env.MATRIX_ACCESS_TOKEN;
    const roomId = payload.credentials?.roomId ?? process.env.MATRIX_ROOM_ID;

    if (!accessToken || !roomId) {
      assertSimulationAllowed(
        payload.strictLive,
        "Matrix live publish requires MATRIX_ACCESS_TOKEN and MATRIX_ROOM_ID.",
      );
      return {
        success: true,
        platformId: this.id,
        simulated: true,
        publishedUrl: `https://matrix.to/#/${encodeURIComponent(roomId || "!room:matrix.org")}/$sim_${Date.now()}`,
        postId: `$sim_${Date.now()}`,
      };
    }

    let mediaMxcUrl: string | undefined;
    if (payload.filePath && existsSync(payload.filePath)) {
      const fileName = basename(payload.filePath);
      const uploadRes = await fetch(
        `https://${homeserver}/_matrix/media/v3/upload?filename=${encodeURIComponent(fileName)}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": payload.isStillImage ? "image/jpeg" : "video/mp4",
          },
          body: readFileSync(payload.filePath),
        },
      );
      if (uploadRes.ok) {
        const upJson = (await uploadRes.json()) as { content_uri?: string };
        mediaMxcUrl = upJson.content_uri;
      }
    }

    const bodyText =
      payload.firstComment || !payload.linkUrl
        ? payload.text
        : `${payload.text}\n\n${payload.linkUrl}`;

    const txnId = `polypost_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const msgContent: Record<string, any> = mediaMxcUrl
      ? {
          msgtype: payload.isStillImage ? "m.image" : "m.video",
          body: bodyText,
          url: mediaMxcUrl,
        }
      : {
          msgtype: "m.text",
          body: bodyText,
        };

    const sendRes = await fetch(
      `https://${homeserver}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(msgContent),
      },
    );

    if (!sendRes.ok) {
      throw new Error(`Matrix room send failed (${sendRes.status}): ${await sendRes.text()}`);
    }

    const sendJson = (await sendRes.json()) as { event_id?: string };
    const eventId = sendJson.event_id || `$${txnId}`;
    const publishedUrl = `https://matrix.to/#/${encodeURIComponent(roomId)}/${encodeURIComponent(eventId)}`;

    let firstCommentId: string | undefined;
    let firstCommentUrl: string | undefined;
    if (payload.firstComment && sendJson.event_id) {
      const replyTxn = `${txnId}_reply`;
      const replyRes = await fetch(
        `https://${homeserver}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${replyTxn}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            msgtype: "m.text",
            body: payload.firstComment,
            "m.relates_to": {
              "m.in_reply_to": {
                event_id: sendJson.event_id,
              },
            },
          }),
        },
      );
      if (replyRes.ok) {
        const rJson = (await replyRes.json()) as { event_id?: string };
        if (rJson.event_id) {
          firstCommentId = rJson.event_id;
          firstCommentUrl = `https://matrix.to/#/${encodeURIComponent(roomId)}/${encodeURIComponent(rJson.event_id)}`;
        }
      }
    }

    return {
      success: true,
      platformId: this.id,
      publishedUrl,
      postId: eventId,
      firstCommentId,
      firstCommentUrl,
    };
  }
}
