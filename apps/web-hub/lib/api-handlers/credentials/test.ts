import { NextRequest, NextResponse } from "next/server";
import { reloadRootEnvToProcessEnv } from "@polypost/node-api-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    reloadRootEnvToProcessEnv();
    const body = await req.json();
    const provider = String(body.provider || "").trim().toLowerCase();

    if (provider === "bluesky") {
      const identifier = process.env.BLUESKY_IDENTIFIER;
      const password = process.env.BLUESKY_PASSWORD;
      const host = process.env.BLUESKY_HOST || "bsky.social";
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
      const token = process.env.MASTODON_ACCESS_TOKEN;
      const host = process.env.MASTODON_HOST || "mastodon.social";
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
      const token = process.env.TELEGRAM_BOT_TOKEN;
      const chatId = process.env.TELEGRAM_CHAT_ID;
      const apiBase = (process.env.TELEGRAM_API_BASE || "https://api.telegram.org").replace(/\/$/, "");
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
      const url = process.env.WEBHOOK_DISCORD_WEBHOOK || process.env.WEBHOOK_DISCORD || process.env.DISCORD_WEBHOOK_URL;
      if (!url) {
        return NextResponse.json({ ok: false, message: "Enter Discord Webhook URL first." }, { status: 400 });
      }
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        return NextResponse.json({ ok: false, message: `Discord webhook returned HTTP ${res.status}.` });
      }
      const data = await res.json();
      return NextResponse.json({ ok: true, message: `Verified Discord webhook '${data.name || "Webhook"}'.` });
    }

    if (provider === "slack") {
      const url = process.env.WEBHOOK_SLACK_WEBHOOK || process.env.WEBHOOK_SLACK || process.env.SLACK_WEBHOOK_URL;
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
      const cid = process.env.REDDIT_CLIENT_ID;
      const csec = process.env.REDDIT_CLIENT_SECRET;
      const user = process.env.REDDIT_USERNAME;
      const pass = process.env.REDDIT_PASSWORD;
      const token = process.env.REDDIT_ACCESS_TOKEN;
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
            "User-Agent": process.env.REDDIT_USER_AGENT || "PolyPost/0.1.0",
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
          "User-Agent": process.env.REDDIT_USER_AGENT || "PolyPost/0.1.0",
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
      const user = process.env.E621_USERNAME;
      const apiKey = process.env.E621_API_KEY;
      if (!user || !apiKey) {
        return NextResponse.json({ ok: false, message: "Enter e621 Username and API Key first." }, { status: 400 });
      }
      const auth = Buffer.from(`${user}:${apiKey}`).toString("base64");
      const res = await fetch(`https://e621.net/users/${encodeURIComponent(user)}.json`, {
        headers: {
          Authorization: `Basic ${auth}`,
          "User-Agent": process.env.E621_USER_AGENT || `PolyPost/0.1.0 (by ${user})`,
        },
        signal: AbortSignal.timeout(10_000),
      });
      return NextResponse.json({
        ok: res.ok,
        message: res.ok ? `Verified e621 credentials for ${user}.` : `e621 returned HTTP ${res.status}.`,
      });
    }

    if (provider === "deviantart") {
      const token = process.env.DEVIANTART_ACCESS_TOKEN;
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
      const user = process.env.INKBUNNY_USERNAME;
      const pass = process.env.INKBUNNY_PASSWORD;
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
      const token = process.env.MISSKEY_TOKEN;
      const host = (process.env.MISSKEY_HOST || "misskey.io").replace(/^https?:\/\//i, "").replace(/\/+$/, "");
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
      const host = (process.env.LEMMY_HOST || "lemmy.world").replace(/^https?:\/\//i, "").replace(/\/+$/, "");
      const user = process.env.LEMMY_USERNAME;
      const pass = process.env.LEMMY_PASSWORD;
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
      const token = process.env.TUMBLR_ACCESS_TOKEN;
      const blog = process.env.TUMBLR_BLOG;
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
      const priv = process.env.NOSTR_PRIVATE_KEY;
      if (!priv) {
        return NextResponse.json({ ok: false, message: "Enter NOSTR_PRIVATE_KEY (64-char hex or nsec1...) first." }, { status: 400 });
      }
      const { deriveNostrPubkeyHex } = await import("@polypost/node-api-worker");
      const pubkey = deriveNostrPubkeyHex(priv);
      const relays = (process.env.NOSTR_RELAYS ?? "wss://relay.damus.io,wss://nos.lol").split(",").map((r) => r.trim()).filter(Boolean);
      return NextResponse.json({
        ok: true,
        message: `Valid Nostr keypair! Derived schnorr pubkey: ${pubkey.slice(0, 16)}... (${relays.length} relays configured).`,
      });
    }

    if (provider === "matrix") {
      const hs = (process.env.MATRIX_HOMESERVER_URL ?? "https://matrix-client.matrix.org").replace(/\/$/, "");
      const token = process.env.MATRIX_ACCESS_TOKEN;
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
      const apiKey = process.env.FARCASTER_NEYNAR_API_KEY;
      const signer = process.env.FARCASTER_SIGNER_UUID;
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
      const site = (process.env.WORDPRESS_SITE_URL ?? "").replace(/\/$/, "");
      const user = process.env.WORDPRESS_USERNAME;
      const pass = process.env.WORDPRESS_APP_PASSWORD;
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
      const apiKey = process.env.DEVTO_API_KEY;
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

    if (provider === "revolt") {
      const apiUrl = (process.env.REVOLT_API_URL ?? "https://api.revolt.chat").replace(/\/$/, "");
      const token = process.env.REVOLT_BOT_TOKEN;
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
      const token = process.env.VK_ACCESS_TOKEN;
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
