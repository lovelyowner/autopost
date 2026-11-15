import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  generateNostrKeypair,
  reloadRootEnvToProcessEnv,
  upsertRootEnvCredentials,
} from "@polypost/node-api-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function resolveOrigin(req: NextRequest): string {
  const proto = req.headers.get("x-forwarded-proto") || req.nextUrl.protocol.replace(":", "") || "https";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || req.nextUrl.host;
  if (host) {
    return `${proto}://${host}`;
  }
  return req.nextUrl.origin;
}

function normalizeHost(raw: string, fallback: string): string {
  const clean = String(raw || fallback)
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
  if (!clean || !/^[a-zA-Z0-9.-]+(?::\d+)?$/.test(clean)) {
    throw new Error(`Invalid instance hostname '${raw}'.`);
  }
  return clean;
}

function createPkcePair() {
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}

function maybeSaveLocalEnv(creds: Record<string, string>): boolean {
  if (process.env.VERCEL) return false;
  try {
    upsertRootEnvCredentials(creds);
    return true;
  } catch {
    return false;
  }
}

export async function GET() {
  reloadRootEnvToProcessEnv();
  return NextResponse.json({
    cloudMode: Boolean(process.env.VERCEL),
    oauthReady: {
      nostr: true,
      mastodon: true,
      misskey: true,
      stoat: true,
      bluesky: true,
      fluxer: true,
      telegram: true,
      slack: true,
      google: Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID),
      discord: Boolean(process.env.DISCORD_OAUTH_CLIENT_ID && process.env.DISCORD_OAUTH_CLIENT_SECRET),
      x: Boolean(process.env.X_OAUTH_CLIENT_ID),
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    reloadRootEnvToProcessEnv();
    const body = (await req.json()) as Record<string, any>;
    const action = String(body.action || "").trim().toLowerCase();

    if (action === "nostr_generate") {
      const relays =
        typeof body.relays === "string" && body.relays.trim()
          ? body.relays.trim()
          : "wss://relay.damus.io,wss://nos.lol,wss://relay.primal.net";
      const { privateKeyHex, publicKeyHex } = generateNostrKeypair();
      const credentials = {
        NOSTR_PRIVATE_KEY: privateKeyHex,
        NOSTR_RELAYS: relays,
      };
      maybeSaveLocalEnv(credentials);
      return NextResponse.json({
        ok: true,
        provider: "nostr",
        publicKeyHex,
        credentials,
        message: `Created Nostr identity ${publicKeyHex.slice(0, 12)}... and connected ${relays.split(",").length} relays.`,
      });
    }

    if (action === "stoat_login") {
      const apiUrl = String(body.apiUrl || "https://api.revolt.chat")
        .trim()
        .replace(/\/+$/, "");
      const email = String(body.email || "").trim();
      const password = String(body.password || "");
      const providedChannelId = String(body.channelId || "").trim();

      if (!/^https?:\/\/.+/.test(apiUrl)) {
        return NextResponse.json({ ok: false, message: "Enter a valid Stoat/Revolt API URL (e.g. https://api.revolt.chat)." }, { status: 400 });
      }
      if (!email || !password) {
        return NextResponse.json({ ok: false, message: "Enter your Stoat/Revolt email and password." }, { status: 400 });
      }

      const loginRes = await fetch(`${apiUrl}/auth/session/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          friendly_name: "PolyPost 1-Click",
        }),
        signal: AbortSignal.timeout(12_000),
      });

      const loginJson = (await loginRes.json().catch(() => ({}))) as Record<string, any>;
      if (!loginRes.ok || (!loginJson.token && loginJson.result !== "Success")) {
        if (loginJson.result === "MFA") {
          return NextResponse.json(
            { ok: false, message: "Account has 2FA enabled. Please connect using a Stoat Bot Token instead." },
            { status: 400 },
          );
        }
        return NextResponse.json(
          { ok: false, message: `Stoat sign-in failed (${loginRes.status}): ${loginJson.type || loginJson.error || "Invalid credentials"}` },
          { status: 400 },
        );
      }

      const token = String(loginJson.token || "");
      let username = email;
      const discoveredChannels: Array<{ id: string; label: string }> = [];

      try {
        const meRes = await fetch(`${apiUrl}/users/@me`, {
          headers: { "x-session-token": token },
          signal: AbortSignal.timeout(8_000),
        });
        if (meRes.ok) {
          const me = (await meRes.json()) as Record<string, any>;
          if (me.username) username = String(me.username);
        }
      } catch {}

      try {
        const dmRes = await fetch(`${apiUrl}/users/dms`, {
          headers: { "x-session-token": token },
          signal: AbortSignal.timeout(8_000),
        });
        if (dmRes.ok) {
          const dms = (await dmRes.json()) as Array<Record<string, any>>;
          if (Array.isArray(dms)) {
            for (const ch of dms.slice(0, 12)) {
              if (ch?._id) {
                discoveredChannels.push({
                  id: String(ch._id),
                  label: String(ch.name || ch.channel_type || ch._id),
                });
              }
            }
          }
        }
      } catch {}

      const finalChannelId = providedChannelId || discoveredChannels[0]?.id || "";
      const credentials: Record<string, string> = {
        REVOLT_API_URL: apiUrl,
        REVOLT_BOT_TOKEN: token,
        ...(finalChannelId ? { REVOLT_CHANNEL_ID: finalChannelId } : {}),
      };
      maybeSaveLocalEnv(credentials);

      return NextResponse.json({
        ok: true,
        provider: "stoat",
        username,
        discoveredChannels,
        credentials,
        message: finalChannelId
          ? `Signed into Stoat as @${username} and linked channel ${finalChannelId}.`
          : `Signed into Stoat as @${username}. Paste a target Channel ID below to finish live channel routing.`,
      });
    }

    if (action === "start") {
      const provider = String(body.provider || "").trim().toLowerCase();
      const origin = resolveOrigin(req);
      const rawRedirect = String(body.redirectPath || "/vault").trim();
      const redirectPath = rawRedirect.startsWith("/") && !rawRedirect.startsWith("//") ? rawRedirect : "/vault";
      const redirectUri = `${origin}${redirectPath}`;
      const state = `${provider}.${randomBytes(12).toString("hex")}`;

      if (provider === "mastodon") {
        const host = normalizeHost(String(body.host || "mastodon.social"), "mastodon.social");
        const appRes = await fetch(`https://${host}/api/v1/apps`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_name: "PolyPost 1-Click",
            redirect_uris: redirectUri,
            scopes: "read write:statuses write:media",
            website: origin,
          }),
          signal: AbortSignal.timeout(12_000),
        });
        const app = (await appRes.json().catch(() => ({}))) as Record<string, any>;
        if (!appRes.ok || !app.client_id) {
          return NextResponse.json(
            { ok: false, message: `Could not register OAuth app on ${host} (${app.error || appRes.status}).` },
            { status: 400 },
          );
        }
        const { codeVerifier, codeChallenge } = createPkcePair();
        const params = new URLSearchParams({
          client_id: String(app.client_id),
          redirect_uri: redirectUri,
          response_type: "code",
          scope: "read write:statuses write:media",
          state,
          code_challenge: codeChallenge,
          code_challenge_method: "S256",
        });
        return NextResponse.json({
          ok: true,
          provider: "mastodon",
          authUrl: `https://${host}/oauth/authorize?${params.toString()}`,
          oauthSession: {
            provider: "mastodon",
            host,
            clientId: String(app.client_id),
            clientSecret: String(app.client_secret || ""),
            redirectUri,
            codeVerifier,
            state,
          },
        });
      }

      if (provider === "misskey") {
        const host = normalizeHost(String(body.host || "misskey.io"), "misskey.io");
        const sessionId = crypto.randomUUID();
        const callbackUrl = `${redirectUri}?oauth_provider=misskey&session=${encodeURIComponent(sessionId)}&host=${encodeURIComponent(host)}`;
        const params = new URLSearchParams({
          name: "PolyPost 1-Click",
          callback: callbackUrl,
          permission: "write:notes,write:drive,read:account",
        });
        return NextResponse.json({
          ok: true,
          provider: "misskey",
          authUrl: `https://${host}/miauth/${encodeURIComponent(sessionId)}?${params.toString()}`,
          oauthSession: {
            provider: "misskey",
            host,
            sessionId,
            state: sessionId,
          },
        });
      }

      if (provider === "google") {
        const clientId = String(body.clientId || process.env.GOOGLE_OAUTH_CLIENT_ID || "").trim();
        const clientSecret = String(body.clientSecret || process.env.GOOGLE_OAUTH_CLIENT_SECRET || "").trim();
        if (!clientId) {
          return NextResponse.json({
            ok: false,
            needsClientConfig: true,
            provider: "google",
            redirectUri,
            setupUrl: "https://console.cloud.google.com/apis/credentials",
            message: "Add a Google OAuth Client ID once (with Authorized Redirect URI shown below) to enable 1-click Google OAuth, or use Chrome Login below.",
          });
        }
        const { codeVerifier, codeChallenge } = createPkcePair();
        const params = new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: "code",
          scope: "openid email profile https://www.googleapis.com/auth/youtube.upload",
          access_type: "offline",
          prompt: "consent",
          state,
          code_challenge: codeChallenge,
          code_challenge_method: "S256",
        });
        return NextResponse.json({
          ok: true,
          provider: "google",
          authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
          oauthSession: {
            provider: "google",
            clientId,
            clientSecret,
            redirectUri,
            codeVerifier,
            state,
          },
        });
      }

      if (provider === "discord") {
        const clientId = String(body.clientId || process.env.DISCORD_OAUTH_CLIENT_ID || "").trim();
        const clientSecret = String(body.clientSecret || process.env.DISCORD_OAUTH_CLIENT_SECRET || "").trim();
        if (!clientId || !clientSecret) {
          return NextResponse.json({
            ok: false,
            needsClientConfig: true,
            provider: "discord",
            redirectUri,
            setupUrl: "https://discord.com/developers/applications",
            message: "Paste a Discord Webhook URL for instant 1-step connect, OR enter Discord OAuth Client ID + Secret once for 1-click server authorization.",
          });
        }
        const { codeVerifier, codeChallenge } = createPkcePair();
        const params = new URLSearchParams({
          client_id: clientId,
          response_type: "code",
          redirect_uri: redirectUri,
          scope: "webhook.incoming identify",
          state,
          code_challenge: codeChallenge,
          code_challenge_method: "S256",
        });
        return NextResponse.json({
          ok: true,
          provider: "discord",
          authUrl: `https://discord.com/oauth2/authorize?${params.toString()}`,
          oauthSession: {
            provider: "discord",
            clientId,
            clientSecret,
            redirectUri,
            codeVerifier,
            state,
          },
        });
      }

      if (provider === "x") {
        const clientId = String(body.clientId || process.env.X_OAUTH_CLIENT_ID || "").trim();
        const clientSecret = String(body.clientSecret || process.env.X_OAUTH_CLIENT_SECRET || "").trim();
        if (!clientId) {
          return NextResponse.json({
            ok: false,
            needsClientConfig: true,
            provider: "x",
            redirectUri,
            setupUrl: "https://developer.x.com/en/portal/dashboard",
            message: "Add your X OAuth2 Client ID once (PKCE public or confidential client), or paste a Bearer token / launch Chrome Login.",
          });
        }
        const { codeVerifier, codeChallenge } = createPkcePair();
        const params = new URLSearchParams({
          response_type: "code",
          client_id: clientId,
          redirect_uri: redirectUri,
          scope: "tweet.read tweet.write users.read offline.access",
          state,
          code_challenge: codeChallenge,
          code_challenge_method: "S256",
        });
        return NextResponse.json({
          ok: true,
          provider: "x",
          authUrl: `https://x.com/i/oauth2/authorize?${params.toString()}`,
          oauthSession: {
            provider: "x",
            clientId,
            clientSecret,
            redirectUri,
            codeVerifier,
            state,
          },
        });
      }

      return NextResponse.json({ ok: false, message: `Unsupported OAuth provider '${provider}'.` }, { status: 400 });
    }

    if (action === "exchange") {
      const provider = String(body.provider || "").trim().toLowerCase();

      if (provider === "mastodon") {
        const host = normalizeHost(String(body.host || "mastodon.social"), "mastodon.social");
        const code = String(body.code || "").trim();
        const clientId = String(body.clientId || "").trim();
        const clientSecret = String(body.clientSecret || "").trim();
        const redirectUri = String(body.redirectUri || `${resolveOrigin(req)}/vault`).trim();
        const codeVerifier = String(body.codeVerifier || "").trim();
        if (!code || !clientId) {
          return NextResponse.json({ ok: false, message: "Missing Mastodon OAuth code or client session." }, { status: 400 });
        }
        const tokenRes = await fetch(`https://${host}/oauth/token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            grant_type: "authorization_code",
            code,
            client_id: clientId,
            ...(clientSecret ? { client_secret: clientSecret } : {}),
            redirect_uri: redirectUri,
            ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
            scope: "read write:statuses write:media",
          }),
          signal: AbortSignal.timeout(12_000),
        });
        const tokenJson = (await tokenRes.json().catch(() => ({}))) as Record<string, any>;
        if (!tokenRes.ok || !tokenJson.access_token) {
          return NextResponse.json(
            { ok: false, message: `Mastodon token exchange failed: ${tokenJson.error_description || tokenJson.error || tokenRes.status}` },
            { status: 400 },
          );
        }
        const accessToken = String(tokenJson.access_token);
        let handle = host;
        try {
          const meRes = await fetch(`https://${host}/api/v1/accounts/verify_credentials`, {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(8_000),
          });
          if (meRes.ok) {
            const me = (await meRes.json()) as Record<string, any>;
            if (me.acct || me.username) handle = `@${me.acct || me.username}@${host}`;
          }
        } catch {}
        const credentials = {
          MASTODON_HOST: host,
          MASTODON_ACCESS_TOKEN: accessToken,
        };
        maybeSaveLocalEnv(credentials);
        return NextResponse.json({
          ok: true,
          provider: "mastodon",
          credentials,
          message: `Connected Mastodon account ${handle}.`,
        });
      }

      if (provider === "misskey") {
        const host = normalizeHost(String(body.host || "misskey.io"), "misskey.io");
        const sessionId = String(body.sessionId || "").trim();
        if (!sessionId) {
          return NextResponse.json({ ok: false, message: "Missing Misskey MiAuth session ID." }, { status: 400 });
        }
        const checkRes = await fetch(`https://${host}/api/miauth/${encodeURIComponent(sessionId)}/check`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
          signal: AbortSignal.timeout(12_000),
        });
        const checkJson = (await checkRes.json().catch(() => ({}))) as Record<string, any>;
        if (!checkRes.ok || !checkJson.ok || !checkJson.token) {
          return NextResponse.json(
            { ok: false, message: `Misskey authorization did not complete (${checkRes.status}).` },
            { status: 400 },
          );
        }
        const credentials = {
          MISSKEY_HOST: host,
          MISSKEY_TOKEN: String(checkJson.token),
        };
        maybeSaveLocalEnv(credentials);
        const userName = checkJson.user?.username ? `@${checkJson.user.username}@${host}` : host;
        return NextResponse.json({
          ok: true,
          provider: "misskey",
          credentials,
          message: `Connected Misskey account ${userName}.`,
        });
      }

      if (provider === "google") {
        const code = String(body.code || "").trim();
        const clientId = String(body.clientId || process.env.GOOGLE_OAUTH_CLIENT_ID || "").trim();
        const clientSecret = String(body.clientSecret || process.env.GOOGLE_OAUTH_CLIENT_SECRET || "").trim();
        const redirectUri = String(body.redirectUri || `${resolveOrigin(req)}/vault`).trim();
        const codeVerifier = String(body.codeVerifier || "").trim();
        if (!code || !clientId) {
          return NextResponse.json({ ok: false, message: "Missing Google authorization code or Client ID." }, { status: 400 });
        }
        const form = new URLSearchParams({
          code,
          client_id: clientId,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
          ...(clientSecret ? { client_secret: clientSecret } : {}),
          ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
        });
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: form.toString(),
          signal: AbortSignal.timeout(12_000),
        });
        const tokenJson = (await tokenRes.json().catch(() => ({}))) as Record<string, any>;
        if (!tokenRes.ok || !tokenJson.access_token) {
          return NextResponse.json(
            { ok: false, message: `Google token exchange failed: ${tokenJson.error_description || tokenJson.error || tokenRes.status}` },
            { status: 400 },
          );
        }
        const accessToken = String(tokenJson.access_token);
        let email = "";
        let name = "";
        try {
          const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(8_000),
          });
          if (infoRes.ok) {
            const info = (await infoRes.json()) as Record<string, any>;
            email = String(info.email || "");
            name = String(info.name || "");
          }
        } catch {}

        const credentials: Record<string, string> = {
          GOOGLE_ACCESS_TOKEN: accessToken,
          GOOGLE_OAUTH_CLIENT_ID: clientId,
          ...(tokenJson.refresh_token ? { GOOGLE_REFRESH_TOKEN: String(tokenJson.refresh_token) } : {}),
          ...(email ? { GOOGLE_USER_EMAIL: email } : {}),
          ...(name ? { GOOGLE_USER_NAME: name } : {}),
        };
        maybeSaveLocalEnv(credentials);
        return NextResponse.json({
          ok: true,
          provider: "google",
          credentials,
          message: `Connected Google account ${email || name || "(verified)"}.`,
        });
      }

      if (provider === "discord") {
        const code = String(body.code || "").trim();
        const clientId = String(body.clientId || process.env.DISCORD_OAUTH_CLIENT_ID || "").trim();
        const clientSecret = String(body.clientSecret || process.env.DISCORD_OAUTH_CLIENT_SECRET || "").trim();
        const redirectUri = String(body.redirectUri || `${resolveOrigin(req)}/vault`).trim();
        const codeVerifier = String(body.codeVerifier || "").trim();
        if (!code || !clientId || !clientSecret) {
          return NextResponse.json({ ok: false, message: "Missing Discord OAuth code or Client ID/Secret." }, { status: 400 });
        }
        const form = new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
        });
        const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: form.toString(),
          signal: AbortSignal.timeout(12_000),
        });
        const tokenJson = (await tokenRes.json().catch(() => ({}))) as Record<string, any>;
        if (!tokenRes.ok || !tokenJson.access_token) {
          return NextResponse.json(
            { ok: false, message: `Discord token exchange failed: ${tokenJson.error_description || tokenJson.error || tokenRes.status}` },
            { status: 400 },
          );
        }
        const webhookUrl = String(tokenJson.webhook?.url || "");
        let username = "";
        try {
          const meRes = await fetch("https://discord.com/api/v10/users/@me", {
            headers: { Authorization: `Bearer ${tokenJson.access_token}` },
            signal: AbortSignal.timeout(8_000),
          });
          if (meRes.ok) {
            const me = (await meRes.json()) as Record<string, any>;
            username = String(me.username || "");
          }
        } catch {}

        const credentials: Record<string, string> = {
          DISCORD_ACCESS_TOKEN: String(tokenJson.access_token),
          DISCORD_OAUTH_CLIENT_ID: clientId,
          ...(webhookUrl ? { WEBHOOK_DISCORD_WEBHOOK: webhookUrl } : {}),
        };
        maybeSaveLocalEnv(credentials);
        return NextResponse.json({
          ok: true,
          provider: "discord",
          credentials,
          message: webhookUrl
            ? `Connected Discord @${username || "user"} + incoming webhook for live posting.`
            : `Connected Discord @${username || "user"}.`,
        });
      }

      if (provider === "x") {
        const code = String(body.code || "").trim();
        const clientId = String(body.clientId || process.env.X_OAUTH_CLIENT_ID || "").trim();
        const clientSecret = String(body.clientSecret || process.env.X_OAUTH_CLIENT_SECRET || "").trim();
        const redirectUri = String(body.redirectUri || `${resolveOrigin(req)}/vault`).trim();
        const codeVerifier = String(body.codeVerifier || "").trim();
        if (!code || !clientId) {
          return NextResponse.json({ ok: false, message: "Missing X authorization code or Client ID." }, { status: 400 });
        }
        const headers: Record<string, string> = {
          "Content-Type": "application/x-www-form-urlencoded",
        };
        if (clientSecret) {
          headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
        }
        const form = new URLSearchParams({
          code,
          grant_type: "authorization_code",
          client_id: clientId,
          redirect_uri: redirectUri,
          ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
        });
        const tokenRes = await fetch("https://api.x.com/2/oauth2/token", {
          method: "POST",
          headers,
          body: form.toString(),
          signal: AbortSignal.timeout(12_000),
        });
        const tokenJson = (await tokenRes.json().catch(() => ({}))) as Record<string, any>;
        if (!tokenRes.ok || !tokenJson.access_token) {
          return NextResponse.json(
            { ok: false, message: `X token exchange failed: ${tokenJson.error_description || tokenJson.error || tokenRes.status}` },
            { status: 400 },
          );
        }
        const accessToken = String(tokenJson.access_token);
        let handle = "verified";
        try {
          const meRes = await fetch("https://api.x.com/2/users/me", {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(8_000),
          });
          if (meRes.ok) {
            const me = (await meRes.json()) as Record<string, any>;
            if (me.data?.username) handle = `@${me.data.username}`;
          }
        } catch {}

        const credentials: Record<string, string> = {
          X_BEARER_TOKEN: accessToken,
          X_OAUTH_CLIENT_ID: clientId,
          ...(tokenJson.refresh_token ? { X_REFRESH_TOKEN: String(tokenJson.refresh_token) } : {}),
        };
        maybeSaveLocalEnv(credentials);
        return NextResponse.json({
          ok: true,
          provider: "x",
          credentials,
          message: `Connected X account ${handle}.`,
        });
      }

      return NextResponse.json({ ok: false, message: `Unsupported exchange provider '${provider}'.` }, { status: 400 });
    }

    return NextResponse.json({ ok: false, message: `Unknown OAuth action '${action}'.` }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, message: err?.message || "OAuth operation failed." }, { status: 500 });
  }
}
