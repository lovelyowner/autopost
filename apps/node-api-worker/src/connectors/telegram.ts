import { existsSync, openAsBlob } from "node:fs";
import { basename } from "node:path";
import { assertSimulationAllowed, type ConnectorResult, type PlatformConnector, type PostPayload } from "./types";

export class TelegramConnector implements PlatformConnector {
  id = "telegram";

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async publish(payload: PostPayload): Promise<ConnectorResult> {
    const botToken = payload.credentials?.botToken ?? process.env.TELEGRAM_BOT_TOKEN;
    const chatId = payload.credentials?.chatId ?? process.env.TELEGRAM_CHAT_ID;
    const apiBase = (payload.credentials?.apiBase ?? process.env.TELEGRAM_API_BASE ?? "https://api.telegram.org").replace(/\/$/, "");

    if (!botToken || !chatId) {
      assertSimulationAllowed(
        payload.strictLive,
        "Telegram live publish requires TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.",
      );
      return {
        success: true,
        platformId: this.id,
        simulated: true,
        publishedUrl: `https://t.me/channel/sim_${Date.now()}`,
        postId: `sim_${Date.now()}`,
      };
    }

    const caption =
      payload.firstComment || !payload.linkUrl
        ? payload.text
        : `${payload.text}\n\n${payload.linkUrl}`;

    let msgResult: { message_id: number; chat?: { username?: string } };

    if (payload.filePath && existsSync(payload.filePath)) {
      const isImg = payload.isStillImage ?? /\.(jpg|jpeg|png|webp|gif)$/i.test(payload.filePath);
      const method = isImg ? "sendPhoto" : "sendVideo";
      const field = isImg ? "photo" : "video";
      const form = new FormData();
      form.append("chat_id", chatId);
      form.append("caption", caption.slice(0, 1024));
      form.append(field, await openAsBlob(payload.filePath), basename(payload.filePath));

      const res = await this.fetchImpl(`${apiBase}/bot${botToken}/${method}`, {
        method: "POST",
        body: form,
      });
      const json = (await res.json()) as { ok: boolean; result?: any; description?: string };
      if (!res.ok || !json.ok) {
        throw new Error(`Telegram ${method} failed: ${res.status} ${json.description ?? ""}`);
      }
      msgResult = json.result;
    } else {
      const res = await this.fetchImpl(`${apiBase}/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: caption.slice(0, 4096),
          disable_web_page_preview: false,
        }),
      });
      const json = (await res.json()) as { ok: boolean; result?: any; description?: string };
      if (!res.ok || !json.ok) {
        throw new Error(`Telegram sendMessage failed: ${res.status} ${json.description ?? ""}`);
      }
      msgResult = json.result;
    }

    const msgId = String(msgResult.message_id);
    const chanSlug = msgResult.chat?.username ?? chatId.replace(/^@/, "");
    const publishedUrl = `https://t.me/${chanSlug}/${msgId}`;

    let firstCommentId: string | undefined;
    let firstCommentUrl: string | undefined;
    if (payload.firstComment) {
      const replyRes = await this.fetchImpl(`${apiBase}/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: payload.firstComment.slice(0, 4096),
          reply_to_message_id: msgResult.message_id,
        }),
      });
      if (replyRes.ok) {
        const replyJson = (await replyRes.json()) as { ok: boolean; result?: { message_id: number } };
        if (replyJson.ok && replyJson.result) {
          firstCommentId = String(replyJson.result.message_id);
          firstCommentUrl = `https://t.me/${chanSlug}/${firstCommentId}`;
        }
      }
    }

    return {
      success: true,
      platformId: this.id,
      simulated: false,
      publishedUrl,
      postId: msgId,
      firstCommentId,
      firstCommentUrl,
    };
  }
}
