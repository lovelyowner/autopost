import { existsSync, openAsBlob } from "node:fs";
import { basename } from "node:path";
import { assertSimulationAllowed, type ConnectorResult, type PlatformConnector, type PostPayload } from "./types";

export class MisskeyConnector implements PlatformConnector {
  constructor(public id = "misskey") {}

  async publish(payload: PostPayload): Promise<ConnectorResult> {
    const token = payload.credentials?.accessToken ?? process.env.MISSKEY_TOKEN;
    const rawHost = payload.credentials?.host ?? process.env.MISSKEY_HOST ?? "misskey.io";
    const host = rawHost.replace(/^https?:\/\//i, "").replace(/\/+$/, "");

    if (!token) {
      assertSimulationAllowed(
        payload.strictLive,
        `Misskey (${this.id}) live publish requires MISSKEY_TOKEN (and optional MISSKEY_HOST).`,
      );
      return {
        success: true,
        platformId: this.id,
        simulated: true,
        publishedUrl: `https://${host}/notes/sim_${Date.now()}`,
        postId: `sim_${Date.now()}`,
      };
    }

    const fileIds: string[] = [];
    if (payload.filePath && existsSync(payload.filePath)) {
      const formData = new FormData();
      formData.append("i", token);
      formData.append("file", await openAsBlob(payload.filePath), basename(payload.filePath));
      if (payload.text) {
        formData.append("comment", payload.text.slice(0, 120));
      }

      const driveRes = await fetch(`https://${host}/api/drive/files/create`, {
        method: "POST",
        body: formData,
      });

      if (!driveRes.ok) {
        throw new Error(`Misskey drive upload failed: ${driveRes.status} ${await driveRes.text()}`);
      }
      const driveJson = (await driveRes.json()) as { id?: string };
      if (driveJson.id) {
        fileIds.push(driveJson.id);
      }
    }

    const noteText =
      payload.firstComment || !payload.linkUrl
        ? payload.text
        : `${payload.text}\n\n${payload.linkUrl}`;

    const noteBody: Record<string, any> = {
      i: token,
      text: noteText,
      visibility: "public",
    };
    if (fileIds.length > 0) {
      noteBody.fileIds = fileIds;
    }

    const createRes = await fetch(`https://${host}/api/notes/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(noteBody),
    });

    if (!createRes.ok) {
      throw new Error(`Misskey note creation failed: ${createRes.status} ${await createRes.text()}`);
    }

    const createJson = (await createRes.json()) as { createdNote?: { id?: string } };
    const noteId = createJson.createdNote?.id || `mk_${Date.now()}`;
    const publishedUrl = `https://${host}/notes/${noteId}`;

    let firstCommentId: string | undefined;
    let firstCommentUrl: string | undefined;
    if (payload.firstComment && createJson.createdNote?.id) {
      const replyRes = await fetch(`https://${host}/api/notes/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          i: token,
          text: payload.firstComment,
          replyId: createJson.createdNote.id,
          visibility: "public",
        }),
      });
      if (replyRes.ok) {
        const replyJson = (await replyRes.json()) as { createdNote?: { id?: string } };
        if (replyJson.createdNote?.id) {
          firstCommentId = replyJson.createdNote.id;
          firstCommentUrl = `https://${host}/notes/${firstCommentId}`;
        }
      }
    }

    return {
      success: true,
      platformId: this.id,
      publishedUrl,
      postId: noteId,
      firstCommentId,
      firstCommentUrl,
    };
  }
}
