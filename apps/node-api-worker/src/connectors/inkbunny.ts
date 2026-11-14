import { existsSync, openAsBlob } from "node:fs";
import { basename } from "node:path";
import { assertSimulationAllowed, type ConnectorResult, type PlatformConnector, type PostPayload } from "./types";

export class InkbunnyConnector implements PlatformConnector {
  id = "inkbunny";

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async publish(payload: PostPayload): Promise<ConnectorResult> {
    let sid = payload.credentials?.sid ?? process.env.INKBUNNY_SID;
    const username = payload.credentials?.username ?? process.env.INKBUNNY_USERNAME;
    const password = payload.credentials?.password ?? process.env.INKBUNNY_PASSWORD;

    if (!sid && (!username || !password)) {
      assertSimulationAllowed(
        payload.strictLive,
        "Inkbunny live publish requires INKBUNNY_SID or INKBUNNY_USERNAME + INKBUNNY_PASSWORD.",
      );
      return {
        success: true,
        platformId: this.id,
        simulated: true,
        publishedUrl: `https://inkbunny.net/s/sim_${Date.now()}`,
        postId: `sim_${Date.now()}`,
      };
    }

    if (!payload.filePath || !existsSync(payload.filePath)) {
      throw new Error(`Inkbunny upload requires an existing local filePath (got: ${payload.filePath || "none"}).`);
    }

    if (!sid) {
      const loginRes = await this.fetchImpl("https://inkbunny.net/api_login.php", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ username: username!, password: password!, output_mode: "json" }),
      });
      const loginJson = (await loginRes.json()) as { sid?: string; error_message?: string };
      if (!loginRes.ok || !loginJson.sid) {
        throw new Error(`Inkbunny login failed: ${loginJson.error_message ?? loginRes.status}`);
      }
      sid = loginJson.sid;
    }

    const upForm = new FormData();
    upForm.append("sid", sid);
    upForm.append("output_mode", "json");
    upForm.append("uploadedfile[0]", await openAsBlob(payload.filePath), basename(payload.filePath));
    const upRes = await this.fetchImpl("https://inkbunny.net/api_upload.php", { method: "POST", body: upForm });
    const upJson = (await upRes.json()) as { submission_id?: string | number; error_message?: string };
    if (!upRes.ok || !upJson.submission_id) {
      throw new Error(`Inkbunny upload failed: ${upJson.error_message ?? upRes.status}`);
    }

    const subId = String(upJson.submission_id);
    const editRes = await this.fetchImpl("https://inkbunny.net/api_editsubmission.php", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        sid,
        submission_id: subId,
        output_mode: "json",
        title: payload.text.split("\n")[0]?.slice(0, 120) || "New Release",
        desc: payload.linkUrl && !payload.firstComment ? `${payload.text}\n\n${payload.linkUrl}` : payload.text,
        keywords: (payload.tags || []).join(","),
        public: "yes",
      }),
    });
    const editJson = (await editRes.json()) as { error_message?: string };
    if (!editRes.ok || editJson.error_message) {
      throw new Error(`Inkbunny publish edit failed: ${editJson.error_message ?? editRes.status}`);
    }

    return {
      success: true,
      platformId: this.id,
      simulated: false,
      publishedUrl: `https://inkbunny.net/s/${subId}`,
      postId: subId,
    };
  }
}
