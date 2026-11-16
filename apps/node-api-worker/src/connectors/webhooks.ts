import { createReadStream, existsSync } from "node:fs";
import { assertSimulationAllowed, type ConnectorResult, type PlatformConnector, type PostPayload } from "./types";

function resolveWebhookUrl(id: string, creds?: Record<string, string>): string | undefined {
  if (creds?.webhookUrl) return creds.webhookUrl;
  const upper = id.toUpperCase();
  return (
    process.env[`WEBHOOK_${upper}`] ||
    process.env[`WEBHOOK_${upper}_WEBHOOK`] ||
    process.env[`${upper}_WEBHOOK_URL`] ||
    undefined
  );
}

export class WebhookConnector implements PlatformConnector {
  constructor(public id: string = "discord_webhook") {}

  async publish(payload: PostPayload): Promise<ConnectorResult> {
    const webhookUrl = resolveWebhookUrl(this.id, payload.credentials);

    if (!webhookUrl) {
      assertSimulationAllowed(
        payload.strictLive,
        `Webhook live publish for ${this.id} requires WEBHOOK_${this.id.toUpperCase()}_WEBHOOK or WEBHOOK_${this.id.toUpperCase()} env var.`,
      );
      return {
        success: true,
        platformId: this.id,
        simulated: true,
        publishedUrl: `https://${this.id}.example.com/messages/sim_${Date.now()}`,
        postId: `sim_${Date.now()}`,
      };
    }

    const content =
      payload.firstComment || !payload.linkUrl
        ? payload.text
        : `${payload.text}\n\n${payload.linkUrl}`;

    const isSlack = this.id.includes("slack") || webhookUrl.includes("hooks.slack.com");

    if (!isSlack && payload.filePath && existsSync(payload.filePath)) {
      const formData = new FormData();
      formData.append("content", content);
      const nodeStream = createReadStream(payload.filePath);
      const fileName = payload.filePath.split("/").pop() || "media.bin";
      const isSpoiler = payload.extraParams?.spoilerAttachments ?? false;
      const targetFileName = isSpoiler ? `SPOILER_${fileName}` : fileName;
      formData.append("file", nodeStream as any, targetFileName);

      const res = await fetch(webhookUrl, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        throw new Error(`${this.id} post failed: ${res.status} ${await res.text()}`);
      }
    } else {
      const jsonBody = isSlack ? { text: content } : { content, text: content };
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(jsonBody),
      });

      if (!res.ok) {
        throw new Error(`${this.id} post failed: ${res.status} ${await res.text()}`);
      }
    }

    if (payload.firstComment) {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: payload.firstComment, text: payload.firstComment }),
      }).catch(() => {});
    }

    return {
      success: true,
      platformId: this.id,
      simulated: false,
      publishedUrl: webhookUrl,
    };
  }
}
