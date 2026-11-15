import { NextRequest, NextResponse } from "next/server";
import { reloadRootEnvToProcessEnv } from "@polypost/node-api-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    reloadRootEnvToProcessEnv();
    const body = await req.json();
    const provider = String(body.provider || "").trim().toLowerCase();
    const rawCreds =
      body.credentials && typeof body.credentials === "object"
        ? (body.credentials as Record<string, unknown>)
        : {};
    const cred = (key: string): string | undefined => {
      const val = rawCreds[key];
      if (typeof val === "string" && val.trim()) {
        return val.trim();
      }
      return process.env[key];
    };

    if (provider === "bluesky") {
      const identifier = cred("BLUESKY_IDENTIFIER");
      const password = cred("BLUESKY_PASSWORD");
      const host = (cred("BLUESKY_HOST") || "bsky.social").replace(/^https?:\/\//i, "").replace(/\/+$/, "");
      if (!identifier || !password) {
        return NextResponse.json({ ok: false, message: "Enter Bluesky Handle + App Password first." }, { status: 400 });
      }
      const res = await fetch(`https://${host}/xrpc/com.atproto.server.createSession`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password }),
        signal: AbortSignal.timeout(10_000),
      });
      const data = await res.json();
      if (!res.ok) {
        return NextResponse.json({ ok: false, message: `Bluesky rejected login: ${data.message || res.status}` });
      }
      return NextResponse.json({ ok: true, message: `Connected Bluesky account @${data.handle || identifier}.` });
    }

    if (provider === "mastodon") {
      const token = cred("MASTODON_ACCESS_TOKEN");
      const host = (cred("MASTODON_HOST") || "mastodon.social").replace(/^https?:\/\//i, "").replace(/\/+$/, "");
      if (!token) {
        return NextResponse.json({ ok: false, message: "Enter Mastodon Access Token first." }, { status: 400 });
      }
      const res = await fetch(`https://${host}/api/v1/accounts/verify_credentials`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      });
      const data = await res.json();
      if (!res.ok) {
        return NextResponse.json({ ok: false, message: `Mastodon verification failed: ${data.error || res.status}` });
      }
      return NextResponse.json({ ok: true, message: `Connected Mastodon account @${data.acct || data.username}@${host}.` });
    }

    if (provider === "telegram") {
      const token = cred("TELEGRAM_BOT_TOKEN");
      const chatId = cred("TELEGRAM_CHAT_ID");
      const apiBase = (cred("TELEGRAM_API_BASE") || "https://api.telegram.org").replace(/\/$/, "");
      if (!token || !chatId) {
        return NextResponse.json({ ok: false, message: "Enter Telegram Bot Token and Chat ID first." }, { status: 400 });
      }
      const res = await fetch(`${apiBase}/bot${token}/getMe`, { signal: AbortSignal.timeout(10_000) });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        return NextResponse.json({ ok: false, message: `Telegram getMe failed: ${data.description || res.status}` });
      }
      return NextResponse.json({
        ok: true,
        message: `Connected Telegram bot @${data.result?.username} for target ${chatId}.`,
      });
    }

    if (provider === "discord") {
      const url = cred("WEBHOOK_DISCORD_WEBHOOK") || cred("WEBHOOK_DISCORD") || cred("DISCORD_WEBHOOK_URL");
      const token = cred("DISCORD_ACCESS_TOKEN");
      if (!url && !token) {
        return NextResponse.json({ ok: false, message: "Enter Discord Webhook URL or connect Discord OAuth first." }, { status: 400 });
      }
      if (url) {
        const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) {
          return NextResponse.json({ ok: false, message: `Discord webhook returned HTTP ${res.status}.` });
        }
        const data = await res.json();
        return NextResponse.json({ ok: true, message: `Verified Discord webhook '${data.name || "Webhook"}'.` });
      }
      const res = await fetch("https://discord.com/api/v10/users/@me", {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      });
      const data = await res.json();
      return NextResponse.json({
        ok: Boolean(res.ok && data.id),
        message: res.ok && data.id
          ? `Connected Discord user @${data.username}.`
          : `Discord token check failed (${res.status}).`,
      });
    }

    if (provider === "fluxer") {
      const url = cred("WEBHOOK_FLUXER_WEBHOOK") || cred("WEBHOOK_FLUXER") || cred("FLUXER_WEBHOOK_URL");
      if (!url) {
        return NextResponse.json({ ok: false, message: "Enter Fluxer Webhook URL first." }, { status: 400 });
      }
      let validFormat = false;
      try {
        const parsed = new URL(url);
        validFormat = parsed.protocol === "https:" || parsed.protocol === "http:";
      } catch {}
      if (!validFormat) {
        return NextResponse.json({ ok: false, message: "Invalid Fluxer webhook URL format." });
      }
      try {
        const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(8_000) });
        if (res.ok) {
          return NextResponse.json({ ok: true, message: "Verified live Fluxer webhook endpoint." });
        }
        const postOnlyOk = res.status === 401 || res.status === 403 || res.status === 405;
        return NextResponse.json({
          ok: postOnlyOk,
          message: postOnlyOk
            ? `Fluxer webhook URL reachable and saved (POST-only webhook, HTTP ${res.status}).`
            : `Fluxer webhook check returned HTTP ${res.status}.`,
        });
      } catch {
        return NextResponse.json({ ok: true, message: "Fluxer webhook URL format valid and saved." });
      }
    }

    if (provider === "google" || provider === "youtube") {
      const token = cred("GOOGLE_ACCESS_TOKEN");
      if (!token) {
        return NextResponse.json({ ok: false, message: "Connect Google via 1-Click Sign-In or enter GOOGLE_ACCESS_TOKEN first." }, { status: 400 });
      }
      const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      });
      const data = await res.json();
      return NextResponse.json({
        ok: Boolean(res.ok && (data.email || data.sub)),
        message: res.ok && (data.email || data.sub)
          ? `Connected Google account ${data.email || data.name || data.sub}.`
          : `Google OAuth check failed (${res.status}).`,
      });
    }

    if (provider === "x") {
      const token = cred("X_BEARER_TOKEN");
      if (!token) {
        return NextResponse.json({ ok: false, message: "Connect X via 1-Click OAuth or enter X_BEARER_TOKEN first." }, { status: 400 });
      }
      const res = await fetch("https://api.x.com/2/users/me", {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      });
      const data = await res.json();
      return NextResponse.json({
        ok: Boolean(res.ok && data.data?.id),
        message: res.ok && data.data?.id
          ? `Connected X account @${data.data.username}.`
          : `X API verification failed (${data.detail || data.title || res.status}).`,
      });
    }

    if (provider === "slack") {
      const url = cred("WEBHOOK_SLACK_WEBHOOK") || cred("WEBHOOK_SLACK") || cred("SLACK_WEBHOOK_URL");
      if (!url) {
        return NextResponse.json({ ok: false, message: "Enter Slack Webhook URL first." }, { status: 400 });
      }
      const validFormat = /^https:\/\/hooks\.slack\.com\/services\/.+/.test(url);
      return NextResponse.json({
        ok: validFormat,
        message: validFormat
          ? "Slack Webhook URL format valid and saved (ready for live publish)."
          : "URL saved, but does not match https://hooks.slack.com/services/...",
      });
    }

    if (provider === "reddit") {
      const cid = cred("REDDIT_CLIENT_ID");
      const csec = cred("REDDIT_CLIENT_SECRET");
      const user = cred("REDDIT_USERNAME");
      const pass = cred("REDDIT_PASSWORD");
      const token = cred("REDDIT_ACCESS_TOKEN");
      const userAgent = cred("REDDIT_USER_AGENT") || "PolyPost/0.1.0";
      if (!token && (!cid || !csec || !user || !pass)) {
        return NextResponse.json({ ok: false, message: "Enter Reddit OAuth fields first." }, { status: 400 });
      }
      let bearer = token;
      if (!bearer) {
        const auth = Buffer.from(`${cid}:${csec}`).toString("base64");
        const tRes = await fetch("https://www.reddit.com/api/v1/access_token", {
          method: "POST",
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": userAgent,
          },
          body: new URLSearchParams({ grant_type: "password", username: user!, password: pass! }),
          signal: AbortSignal.timeout(10_000),
        });
        const tJson = await tRes.json();
        if (!tRes.ok || !tJson.access_token) {
          return NextResponse.json({ ok: false, message: `Reddit OAuth failed: ${tJson.error || tRes.status}` });
        }
        bearer = tJson.access_token;
      }
      const meRes = await fetch("https://oauth.reddit.com/api/v1/me", {
        headers: {
          Authorization: `Bearer ${bearer}`,
          "User-Agent": userAgent,
        },
        signal: AbortSignal.timeout(10_000),
      });
      const meJson = await meRes.json();
      return NextResponse.json({
        ok: meRes.ok,
        message: meRes.ok ? `Connected Reddit account /u/${meJson.name}.` : `Reddit check returned HTTP ${meRes.status}.`,
      });
    }

    if (provider === "e621") {
      const user = cred("E621_USERNAME");
      const apiKey = cred("E621_API_KEY");
      if (!user || !apiKey) {
        return NextResponse.json({ ok: false, message: "Enter e621 Username and API Key first." }, { status: 400 });
      }
      const auth = Buffer.from(`${user}:${apiKey}`).toString("base64");
      const res = await fetch(`https://e621.net/users/${encodeURIComponent(user)}.json`, {
        headers: {
          Authorization: `Basic ${auth}`,
          "User-Agent": cred("E621_USER_AGENT") || `PolyPost/0.1.0 (by ${user})`,
        },
        signal: AbortSignal.timeout(10_000),
      });
      return NextResponse.json({
        ok: res.ok,
        message: res.ok ? `Verified e621 credentials for ${user}.` : `e621 returned HTTP ${res.status}.`,
      });
    }

    if (provider === "deviantart") {
      const token = cred("DEVIANTART_ACCESS_TOKEN");
      if (!token) {
        return NextResponse.json({ ok: false, message: "Enter DeviantArt OAuth2 Access Token first." }, { status: 400 });
      }
      const res = await fetch(`https://www.deviantart.com/api/v1/oauth2/user/whoami?access_token=${encodeURIComponent(token)}`, {
        signal: AbortSignal.timeout(10_000),
      });
      const data = await res.json();
      return NextResponse.json({
        ok: res.ok && !data.error,
        message: res.ok && data.username ? `Connected DeviantArt account ${data.username}.` : `DeviantArt returned ${data.error_description || res.status}.`,
      });
    }

    if (provider === "inkbunny") {
      const user = cred("INKBUNNY_USERNAME");
      const pass = cred("INKBUNNY_PASSWORD");
      if (!user || !pass) {
        return NextResponse.json({ ok: false, message: "Enter Inkbunny Username + Password first." }, { status: 400 });
      }
      const res = await fetch("https://inkbunny.net/api_login.php", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ username: user, password: pass, output_mode: "json" }),
        signal: AbortSignal.timeout(10_000),
      });
      const data = await res.json();
      return NextResponse.json({
        ok: Boolean(res.ok && data.sid),
        message: data.sid ? `Verified Inkbunny API session for ${user}.` : `Inkbunny login failed: ${data.error_message || res.status}`,
      });
    }

    if (provider === "misskey") {
      const token = cred("MISSKEY_TOKEN");
      const host = (cred("MISSKEY_HOST") || "misskey.io").replace(/^https?:\/\//i, "").replace(/\/+$/, "");
      if (!token) {
        return NextResponse.json({ ok: false, message: "Enter Misskey API Token first." }, { status: 400 });
      }
      const res = await fetch(`https://${host}/api/i`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ i: token }),
        signal: AbortSignal.timeout(10_000),
      });
      const data = await res.json();
      return NextResponse.json({
        ok: Boolean(res.ok && data.username),
        message: res.ok && data.username ? `Connected Misskey @${data.username}@${host}.` : `Misskey check failed (${res.status}).`,
      });
    }

    if (provider === "lemmy") {
      const host = (cred("LEMMY_HOST") || "lemmy.world").replace(/^https?:\/\//i, "").replace(/\/+$/, "");
      const user = cred("LEMMY_USERNAME");
      const pass = cred("LEMMY_PASSWORD");
      if (!user || !pass) {
        return NextResponse.json({ ok: false, message: "Enter Lemmy Username + Password first." }, { status: 400 });
      }
      const res = await fetch(`https://${host}/api/v3/user/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username_or_email: user, password: pass }),
        signal: AbortSignal.timeout(10_000),
      });
      const data = await res.json();
      return NextResponse.json({
        ok: Boolean(res.ok && data.jwt),
        message: data.jwt ? `Verified Lemmy JWT login on ${host}.` : `Lemmy login failed (${res.status}).`,
      });
    }

    if (provider === "tumblr") {
      const token = cred("TUMBLR_ACCESS_TOKEN");
      const blog = cred("TUMBLR_BLOG");
      if (!token || !blog) {
        return NextResponse.json({ ok: false, message: "Enter Tumblr Blog + OAuth2 Access Token first." }, { status: 400 });
      }
      const res = await fetch("https://api.tumblr.com/v2/user/info", {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      });
      const data = await res.json();
      return NextResponse.json({
        ok: Boolean(res.ok && data.response?.user?.name),
        message: res.ok && data.response?.user?.name
          ? `Connected Tumblr user ${data.response.user.name} (${blog}).`
          : `Tumblr verification failed (${res.status}).`,
      });
    }

    if (provider === "nostr") {
      const priv = cred("NOSTR_PRIVATE_KEY");
      if (!priv) {
        return NextResponse.json({ ok: false, message: "Enter NOSTR_PRIVATE_KEY (64-char hex or nsec1...) first." }, { status: 400 });
      }
      const { deriveNostrPubkeyHex } = await import("@polypost/node-api-worker");
      const pubkey = deriveNostrPubkeyHex(priv);
      const relays = (cred("NOSTR_RELAYS") ?? "wss://relay.damus.io,wss://nos.lol").split(",").map((r) => r.trim()).filter(Boolean);
      return NextResponse.json({
        ok: true,
        message: `Valid Nostr keypair! Derived schnorr pubkey: ${pubkey.slice(0, 16)}... (${relays.length} relays configured).`,
      });
    }

    if (provider === "matrix") {
      const hs = (cred("MATRIX_HOMESERVER_URL") ?? "https://matrix-client.matrix.org").replace(/\/$/, "");
      const token = cred("MATRIX_ACCESS_TOKEN");
      if (!token) {
        return NextResponse.json({ ok: false, message: "Enter MATRIX_ACCESS_TOKEN first." }, { status: 400 });
      }
      const res = await fetch(`${hs}/_matrix/client/v3/account/whoami`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      });
      const data = await res.json();
      return NextResponse.json({
        ok: Boolean(res.ok && data.user_id),
        message: res.ok && data.user_id
          ? `Authenticated on Matrix as ${data.user_id}`
          : `Matrix whoami failed (${res.status}).`,
      });
    }

    if (provider === "farcaster") {
      const apiKey = cred("FARCASTER_NEYNAR_API_KEY");
      const signer = cred("FARCASTER_SIGNER_UUID");
      if (!apiKey || !signer) {
        return NextResponse.json({ ok: false, message: "Enter FARCASTER_NEYNAR_API_KEY and FARCASTER_SIGNER_UUID first." }, { status: 400 });
      }
      const res = await fetch(`https://api.neynar.com/v2/farcaster/signer?signer_uuid=${encodeURIComponent(signer)}`, {
        headers: { "x-api-key": apiKey },
        signal: AbortSignal.timeout(10_000),
      });
      const data = await res.json();
      return NextResponse.json({
        ok: Boolean(res.ok && data.signer_uuid),
        message: res.ok && data.signer_uuid
          ? `Connected Farcaster Signer (${data.status ?? "approved"} — FID ${data.fid ?? "linked"}).`
          : `Neynar signer check failed (${res.status}).`,
      });
    }

    if (provider === "wordpress") {
      const site = (cred("WORDPRESS_SITE_URL") ?? "").replace(/\/$/, "");
      const user = cred("WORDPRESS_USERNAME");
      const pass = cred("WORDPRESS_APP_PASSWORD");
      if (!site || !user || !pass) {
        return NextResponse.json({ ok: false, message: "Enter WordPress Site URL, Username, and Application Password first." }, { status: 400 });
      }
      const basic = Buffer.from(`${user}:${pass}`).toString("base64");
      const res = await fetch(`${site}/wp-json/wp/v2/users/me`, {
        headers: { Authorization: `Basic ${basic}` },
        signal: AbortSignal.timeout(10_000),
      });
      const data = await res.json();
      return NextResponse.json({
        ok: Boolean(res.ok && data.id),
        message: res.ok && data.id
          ? `Authenticated on WordPress as ${data.name ?? user} (#${data.id}).`
          : `WordPress REST auth failed (${res.status}).`,
      });
    }

    if (provider === "devto") {
      const apiKey = cred("DEVTO_API_KEY");
      if (!apiKey) {
        return NextResponse.json({ ok: false, message: "Enter DEVTO_API_KEY first." }, { status: 400 });
      }
      const res = await fetch("https://dev.to/api/users/me", {
        headers: { "api-key": apiKey },
        signal: AbortSignal.timeout(10_000),
      });
      const data = await res.json();
      return NextResponse.json({
        ok: Boolean(res.ok && data.username),
        message: res.ok && data.username
          ? `Authenticated on Dev.to as @${data.username}.`
          : `Dev.to verification failed (${res.status}).`,
      });
    }

    if (provider === "revolt" || provider === "stoat") {
      const apiUrl = (cred("REVOLT_API_URL") ?? "https://api.stoat.chat").replace(/\/$/, "");
      const token = cred("REVOLT_BOT_TOKEN");
      if (!token) {
        return NextResponse.json({ ok: false, message: "Enter REVOLT_BOT_TOKEN first." }, { status: 400 });
      }
      const res = await fetch(`${apiUrl}/users/@me`, {
        headers: { "x-bot-token": token, "x-session-token": token },
        signal: AbortSignal.timeout(10_000),
      });
      const data = await res.json();
      return NextResponse.json({
        ok: Boolean(res.ok && (data.username || data._id)),
        message: res.ok && (data.username || data._id)
          ? `Connected Stoat/Revolt account ${data.username ?? data._id}.`
          : `Stoat/Revolt verification failed (${res.status}).`,
      });
    }

    if (provider === "vk") {
      const token = cred("VK_ACCESS_TOKEN");
      if (!token) {
        return NextResponse.json({ ok: false, message: "Enter VK_ACCESS_TOKEN first." }, { status: 400 });
      }
      const res = await fetch(`https://api.vk.com/method/users.get?v=5.199&access_token=${encodeURIComponent(token)}`, {
        signal: AbortSignal.timeout(10_000),
      });
      const data = await res.json();
      const firstUser = data.response?.[0];
      return NextResponse.json({
        ok: Boolean(firstUser?.id),
        message: firstUser?.id
          ? `Authenticated on VK as ${firstUser.first_name ?? ""} ${firstUser.last_name ?? ""} (id${firstUser.id}).`
          : `VK API verification failed (${data.error?.error_msg ?? res.status}).`,
      });
    }

    return NextResponse.json({ ok: false, message: `No automated ping available for '${provider}'.` }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, message: `Connection test failed: ${err.message}` }, { status: 500 });
  }
}
