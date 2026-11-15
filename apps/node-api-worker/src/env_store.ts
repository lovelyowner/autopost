import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseRootEnv } from "../../../scripts/load-env.mjs";
import { resolveMonorepoRoot } from "./history_store";

export interface CredentialFieldSpec {
  key: string;
  label: string;
  secret?: boolean;
  placeholder?: string;
}

export interface CredentialProviderSpec {
  id: string;
  name: string;
  category: "social" | "webhook" | "adult_api" | "ai";
  helpText: string;
  fields: CredentialFieldSpec[];
}

export const CREDENTIAL_PROVIDERS: CredentialProviderSpec[] = [
  {
    id: "bluesky",
    name: "Bluesky (AT Protocol)",
    category: "social",
    helpText: "Create an App Password in Bluesky Settings -> Privacy & Security -> App Passwords.",
    fields: [
      { key: "BLUESKY_IDENTIFIER", label: "Handle or Email", placeholder: "yourname.bsky.social" },
      { key: "BLUESKY_PASSWORD", label: "App Password", secret: true, placeholder: "xxxx-xxxx-xxxx-xxxx" },
      { key: "BLUESKY_HOST", label: "PDS Host (optional)", placeholder: "bsky.social" },
    ],
  },
  {
    id: "telegram",
    name: "Telegram Bot & Channel",
    category: "social",
    helpText: "Create a bot with @BotFather, add it as Admin to your channel, then enter bot token + @channel.",
    fields: [
      { key: "TELEGRAM_BOT_TOKEN", label: "Bot Token", secret: true, placeholder: "123456:ABC-DEF..." },
      { key: "TELEGRAM_CHAT_ID", label: "Channel @username or ID", placeholder: "@your_channel" },
    ],
  },
  {
    id: "discord",
    name: "Discord Channel Webhook",
    category: "webhook",
    helpText: "Server Settings -> Integrations -> Webhooks -> Copy Webhook URL.",
    fields: [
      {
        key: "WEBHOOK_DISCORD_WEBHOOK",
        label: "Webhook URL",
        secret: true,
        placeholder: "https://discord.com/api/webhooks/...",
      },
    ],
  },
  {
    id: "slack",
    name: "Slack Incoming Webhook",
    category: "webhook",
    helpText: "Create a Slack Incoming Webhook for your target channel.",
    fields: [
      {
        key: "WEBHOOK_SLACK_WEBHOOK",
        label: "Webhook URL",
        secret: true,
        placeholder: "https://hooks.slack.com/services/...",
      },
    ],
  },
  {
    id: "mastodon",
    name: "Mastodon / Fediverse",
    category: "social",
    helpText: "Preferences -> Development -> New Application (write:media, write:statuses).",
    fields: [
      { key: "MASTODON_HOST", label: "Instance Host", placeholder: "mastodon.social" },
      { key: "MASTODON_ACCESS_TOKEN", label: "Access Token", secret: true, placeholder: "Bearer token" },
    ],
  },
  {
    id: "misskey",
    name: "Misskey / Sharkey / Firefish",
    category: "social",
    helpText: "Settings -> API -> Generate Access Token (enable Write Notes & Drive).",
    fields: [
      { key: "MISSKEY_HOST", label: "Instance Host", placeholder: "misskey.io" },
      { key: "MISSKEY_TOKEN", label: "API Token", secret: true, placeholder: "misskey_api_token" },
    ],
  },
  {
    id: "lemmy",
    name: "Lemmy / PieFed Communities",
    category: "social",
    helpText: "Enter your Lemmy/PieFed instance, login credentials, and default target community.",
    fields: [
      { key: "LEMMY_HOST", label: "Instance Host", placeholder: "lemmy.world" },
      { key: "LEMMY_USERNAME", label: "Username or Email", placeholder: "your_handle" },
      { key: "LEMMY_PASSWORD", label: "Password", secret: true, placeholder: "password" },
      { key: "LEMMY_COMMUNITY", label: "Target Community", placeholder: "cyberpunk" },
    ],
  },
  {
    id: "tumblr",
    name: "Tumblr (v2 NPF API)",
    category: "social",
    helpText: "Register an OAuth2 app at tumblr.com/oauth/apps to obtain an OAuth2 Bearer access token.",
    fields: [
      { key: "TUMBLR_BLOG", label: "Blog Name or Domain", placeholder: "studionova.tumblr.com" },
      { key: "TUMBLR_ACCESS_TOKEN", label: "OAuth2 Access Token", secret: true, placeholder: "tumblr_oauth2_token" },
    ],
  },
  {
    id: "nostr",
    name: "Nostr (NIP-01 Schnorr Relay Protocol)",
    category: "social",
    helpText: "Enter your 64-character hex private key (or nsec1...) and comma-separated WebSocket relays (wss://relay.damus.io,wss://nos.lol).",
    fields: [
      { key: "NOSTR_PRIVATE_KEY", label: "Hex Private Key or nsec1...", secret: true, placeholder: "a1b2c3d4... (64-char hex or nsec1...)" },
      { key: "NOSTR_RELAYS", label: "Relays (comma-separated wss://)", placeholder: "wss://relay.damus.io,wss://nos.lol,wss://relay.primal.net" },
    ],
  },
  {
    id: "matrix",
    name: "Matrix (Client-Server v3 Rooms)",
    category: "social",
    helpText: "Generate a Matrix Access Token in Element (Settings → Help & About → Access Token) and copy your Room ID (!room:matrix.org).",
    fields: [
      { key: "MATRIX_HOMESERVER_URL", label: "Homeserver URL", placeholder: "https://matrix-client.matrix.org" },
      { key: "MATRIX_ROOM_ID", label: "Default Room ID", placeholder: "!roomid:matrix.org" },
      { key: "MATRIX_ACCESS_TOKEN", label: "Matrix Access Token", secret: true, placeholder: "syt_..." },
    ],
  },
  {
    id: "farcaster",
    name: "Farcaster / Warpcast (Neynar v2 API)",
    category: "social",
    helpText: "Create a Neynar API key and Managed Signer UUID at dev.neynar.com to publish casts and channel posts.",
    fields: [
      { key: "FARCASTER_NEYNAR_API_KEY", label: "Neynar API Key", secret: true, placeholder: "NEYNAR_API_..." },
      { key: "FARCASTER_SIGNER_UUID", label: "Signer UUID", secret: true, placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
      { key: "FARCASTER_CHANNEL_ID", label: "Default Channel ID (Optional)", placeholder: "warpcast" },
    ],
  },
  {
    id: "wordpress",
    name: "WordPress Self-Hosted (WP REST API v2)",
    category: "social",
    helpText: "Create an Application Password in WordPress Admin → Users → Profile → Application Passwords.",
    fields: [
      { key: "WORDPRESS_SITE_URL", label: "Site URL", placeholder: "https://studio-blog.example.com" },
      { key: "WORDPRESS_USERNAME", label: "WordPress Username", placeholder: "admin" },
      { key: "WORDPRESS_APP_PASSWORD", label: "Application Password", secret: true, placeholder: "xxxx xxxx xxxx xxxx xxxx xxxx" },
    ],
  },
  {
    id: "devto",
    name: "Dev.to / Forem (REST API)",
    category: "social",
    helpText: "Generate a Forem / Dev.to API key in Settings → Extensions → DEV Community API Keys.",
    fields: [
      { key: "DEVTO_API_KEY", label: "Dev.to API Key", secret: true, placeholder: "devto_api_key..." },
    ],
  },
  {
    id: "revolt",
    name: "Stoat / Revolt Chat (Bot / User Token)",
    category: "social",
    helpText: "Enter your Stoat/Revolt API URL, target Channel ID, and Bot or Session Token.",
    fields: [
      { key: "REVOLT_API_URL", label: "API URL", placeholder: "https://api.revolt.chat" },
      { key: "REVOLT_CHANNEL_ID", label: "Target Channel ID", placeholder: "01F..." },
      { key: "REVOLT_BOT_TOKEN", label: "Bot / Session Token", secret: true, placeholder: "revolt_token..." },
    ],
  },
  {
    id: "vk",
    name: "VK / VKontakte (Wall & Video API)",
    category: "social",
    helpText: "Provide a VK Standalone App access token with wall & photos/video permissions and your Owner ID (use negative ID for communities).",
    fields: [
      { key: "VK_OWNER_ID", label: "Owner / Group ID", placeholder: "-123456789" },
      { key: "VK_ACCESS_TOKEN", label: "VK Access Token", secret: true, placeholder: "vk1.a...." },
    ],
  },
  {
    id: "reddit",
    name: "Reddit (OAuth Script App)",
    category: "social",
    helpText: "reddit.com/prefs/apps -> create 'script' app to get Client ID & Secret.",
    fields: [
      { key: "REDDIT_CLIENT_ID", label: "Client ID", placeholder: "app_client_id" },
      { key: "REDDIT_CLIENT_SECRET", label: "Client Secret", secret: true, placeholder: "secret" },
      { key: "REDDIT_USERNAME", label: "Username", placeholder: "your_reddit_user" },
      { key: "REDDIT_PASSWORD", label: "Password", secret: true, placeholder: "password" },
      { key: "REDDIT_SUBREDDIT", label: "Target Subreddit (optional)", placeholder: "u_your_reddit_user" },
    ],
  },
  {
    id: "e621",
    name: "e621 API",
    category: "adult_api",
    helpText: "Generate an API Key from your e621 Account Profile page.",
    fields: [
      { key: "E621_USERNAME", label: "Username", placeholder: "your_handle" },
      { key: "E621_API_KEY", label: "API Key", secret: true, placeholder: "e621_api_key" },
    ],
  },
  {
    id: "deviantart",
    name: "DeviantArt Mature OAuth",
    category: "adult_api",
    helpText: "Register an app on deviantart.com/developers to obtain an OAuth2 stash/publish token.",
    fields: [
      { key: "DEVIANTART_ACCESS_TOKEN", label: "OAuth2 Access Token", secret: true, placeholder: "access_token" },
    ],
  },
  {
    id: "inkbunny",
    name: "Inkbunny API",
    category: "adult_api",
    helpText: "Enable API access in Inkbunny Account Settings first.",
    fields: [
      { key: "INKBUNNY_USERNAME", label: "Username", placeholder: "your_handle" },
      { key: "INKBUNNY_PASSWORD", label: "Password", secret: true, placeholder: "password" },
    ],
  },
  {
    id: "peertube",
    name: "PeerTube Instance",
    category: "social",
    helpText: "Enter your PeerTube instance upload URL and OAuth Bearer token.",
    fields: [
      { key: "PEERTUBE_ENDPOINT", label: "Instance Upload Endpoint", placeholder: "https://peertube.example/api/v1/videos/upload" },
      { key: "PEERTUBE_TOKEN", label: "OAuth Token (optional)", secret: true, placeholder: "token" },
    ],
  },
  {
    id: "ai_safety",
    name: "AI Captions & Live Enforcement",
    category: "ai",
    helpText: "Optional OpenRouter key for captions, Vault cookie encryption secret, and global live lock.",
    fields: [
      { key: "OPENROUTER_API_KEY", label: "OpenRouter API Key", secret: true, placeholder: "sk-or-..." },
      { key: "POLYPOST_SECRET_KEY", label: "Vault Encryption Secret", secret: true, placeholder: "random-32-char-secret" },
      { key: "DISABLE_SIMULATED_CONNECTORS", label: "Lock Strict Live Globally (1 or 0)", placeholder: "1" },
    ],
  },
  {
    id: "google",
    name: "Google / YouTube OAuth2",
    category: "social",
    helpText: "Use 1-click Google sign-in or paste your Google OAuth Client ID & access token for YouTube & Google identity.",
    fields: [
      { key: "GOOGLE_USER_EMAIL", label: "Google Account Email (optional)", placeholder: "creator@gmail.com" },
      { key: "GOOGLE_ACCESS_TOKEN", label: "OAuth2 Access Token", secret: true, placeholder: "ya29...." },
      { key: "GOOGLE_OAUTH_CLIENT_ID", label: "OAuth Client ID (optional)", placeholder: "123456.apps.googleusercontent.com" },
      { key: "GOOGLE_OAUTH_CLIENT_SECRET", label: "OAuth Client Secret (optional)", secret: true, placeholder: "GOCSPX-..." },
    ],
  },
  {
    id: "x",
    name: "X / Twitter (API v2 OAuth2)",
    category: "social",
    helpText: "Connect with 1-click X OAuth2 PKCE, Companion Chrome Login, or paste your X API v2 User/Bearer token.",
    fields: [
      { key: "X_BEARER_TOKEN", label: "OAuth2 / Bearer Token", secret: true, placeholder: "AAAA... or user OAuth2 token" },
      { key: "X_OAUTH_CLIENT_ID", label: "OAuth2 Client ID (optional)", placeholder: "x_client_id" },
      { key: "X_OAUTH_CLIENT_SECRET", label: "OAuth2 Client Secret (optional)", secret: true, placeholder: "x_client_secret" },
    ],
  },
  {
    id: "fluxer",
    name: "Fluxer Chat / Community Webhook",
    category: "webhook",
    helpText: "Paste a Fluxer channel Webhook URL for instant live posting.",
    fields: [
      {
        key: "WEBHOOK_FLUXER_WEBHOOK",
        label: "Fluxer Webhook URL",
        secret: true,
        placeholder: "https://fluxer.app/api/webhooks/...",
      },
    ],
  },
];

export const ALLOWED_CREDENTIAL_KEYS = new Set<string>(
  CREDENTIAL_PROVIDERS.flatMap((p) => p.fields.map((f) => f.key)),
);
// Extra read/sync keys that can be managed individually if provided
for (const extra of [
  "REDDIT_ACCESS_TOKEN",
  "INKBUNNY_SID",
  "DISCORD_WEBHOOK_URL",
  "DISCORD_ACCESS_TOKEN",
  "DISCORD_OAUTH_CLIENT_ID",
  "DISCORD_OAUTH_CLIENT_SECRET",
  "FLUXER_WEBHOOK_URL",
  "WEBHOOK_FLUXER",
  "GOOGLE_REFRESH_TOKEN",
  "GOOGLE_USER_NAME",
  "X_REFRESH_TOKEN",
  "SLACK_WEBHOOK_URL",
  "LEMMY_JWT",
]) {
  ALLOWED_CREDENTIAL_KEYS.add(extra);
}

export function resolveRootEnvPath(rootDir?: string): string {
  if (!rootDir && process.env.POLYPOST_ENV_FILE) {
    return resolve(process.env.POLYPOST_ENV_FILE);
  }
  return resolve(rootDir ?? resolveMonorepoRoot(), ".env");
}

function formatEnvValue(val: string): string {
  if (/[\s"'#]/.test(val)) {
    const escaped = val.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `"${escaped}"`;
  }
  return val;
}

const keysLoadedFromEnvFile = new Set<string>();

export function reloadRootEnvToProcessEnv(rootDir?: string): Record<string, string> {
  const envPath = resolveRootEnvPath(rootDir);
  if (!existsSync(envPath)) {
    for (const prev of keysLoadedFromEnvFile) {
      delete process.env[prev];
    }
    keysLoadedFromEnvFile.clear();
    return {};
  }
  const direct = envPath.endsWith("/.env")
    ? parseRootEnv(dirname(envPath))
    : parseLinesToObj(readFileSync(envPath, "utf-8"));
  for (const prev of keysLoadedFromEnvFile) {
    if (!(prev in direct) || direct[prev] === "") {
      delete process.env[prev];
      keysLoadedFromEnvFile.delete(prev);
    }
  }
  for (const key of ALLOWED_CREDENTIAL_KEYS) {
    if (key in direct && direct[key] !== "") {
      process.env[key] = direct[key];
      keysLoadedFromEnvFile.add(key);
    }
  }
  return direct;
}

function parseLinesToObj(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const stripped = line.startsWith("export ") ? line.slice(7).trim() : line;
    const eq = stripped.indexOf("=");
    if (eq <= 0) continue;
    const key = stripped.slice(0, eq).trim();
    let val = stripped.slice(eq + 1).trim();
    if ((val.startsWith("\"") && val.endsWith("\"")) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key) out[key] = val;
  }
  return out;
}

export function maskCredentialValue(val: string | undefined, secret?: boolean): string {
  if (!val) return "";
  if (!secret) return val;
  if (val.length <= 4) return "••••";
  return `••••${val.slice(-4)}`;
}

export function readMaskedCredentialSummary(rootDir?: string): {
  providers: Array<{
    id: string;
    name: string;
    category: string;
    helpText: string;
    configured: boolean;
    fields: Array<CredentialFieldSpec & { isSet: boolean; preview: string }>;
  }>;
} {
  reloadRootEnvToProcessEnv(rootDir);
  const providers = CREDENTIAL_PROVIDERS.map((spec) => {
    const fields = spec.fields.map((f) => {
      const raw = process.env[f.key] || "";
      return {
        ...f,
        isSet: Boolean(raw),
        preview: maskCredentialValue(raw, f.secret),
      };
    });
    const requiredKeys = spec.fields.filter((f) => !f.label.includes("(optional)"));
    const configured =
      spec.id === "reddit"
        ? Boolean(
            process.env.REDDIT_ACCESS_TOKEN ||
              (process.env.REDDIT_CLIENT_ID &&
                process.env.REDDIT_CLIENT_SECRET &&
                process.env.REDDIT_USERNAME &&
                process.env.REDDIT_PASSWORD),
          )
        : spec.id === "discord"
        ? Boolean(
            process.env.WEBHOOK_DISCORD_WEBHOOK ||
              process.env.WEBHOOK_DISCORD ||
              process.env.DISCORD_WEBHOOK_URL ||
              process.env.DISCORD_ACCESS_TOKEN,
          )
        : spec.id === "fluxer"
        ? Boolean(
            process.env.WEBHOOK_FLUXER_WEBHOOK ||
              process.env.WEBHOOK_FLUXER ||
              process.env.FLUXER_WEBHOOK_URL,
          )
        : spec.id === "google"
        ? Boolean(process.env.GOOGLE_ACCESS_TOKEN)
        : spec.id === "x"
        ? Boolean(process.env.X_BEARER_TOKEN)
        : spec.id === "slack"
        ? Boolean(
            process.env.WEBHOOK_SLACK_WEBHOOK ||
              process.env.WEBHOOK_SLACK ||
              process.env.SLACK_WEBHOOK_URL,
          )
        : spec.id === "ai_safety"
        ? fields.some((f) => f.isSet)
        : requiredKeys.every((f) => Boolean(process.env[f.key]));
    return {
      id: spec.id,
      name: spec.name,
      category: spec.category,
      helpText: spec.helpText,
      configured,
      fields,
    };
  });
  return { providers };
}

export function upsertRootEnvCredentials(
  updates: Record<string, string | null | undefined>,
  rootDir?: string,
): { updatedKeys: string[]; removedKeys: string[]; envPath: string } {
  const envPath = resolveRootEnvPath(rootDir);
  mkdirSync(dirname(envPath), { recursive: true });

  const existingLines = existsSync(envPath)
    ? readFileSync(envPath, "utf-8").split(/\r?\n/)
    : ["# PolyPost Environment Configuration"];

  const cleanedUpdates = new Map<string, string | null>();
  for (const [rawKey, rawVal] of Object.entries(updates)) {
    const key = rawKey.trim();
    if (!ALLOWED_CREDENTIAL_KEYS.has(key)) {
      throw new Error(`Key '${key}' is not an editable credential field.`);
    }
    if (rawVal === null) {
      cleanedUpdates.set(key, null);
    } else if (typeof rawVal === "string") {
      const trimmed = rawVal.trim();
      // Preserve existing secret if UI sent untouched mask preview like "••••1234"
      if (trimmed.startsWith("••••")) continue;
      if (trimmed === "") continue;
      cleanedUpdates.set(key, trimmed);
    }
  }

  const seen = new Set<string>();
  const nextLines: string[] = [];
  for (const line of existingLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      nextLines.push(line);
      continue;
    }
    const stripped = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const eq = stripped.indexOf("=");
    if (eq <= 0) {
      nextLines.push(line);
      continue;
    }
    const key = stripped.slice(0, eq).trim();
    if (!cleanedUpdates.has(key)) {
      nextLines.push(line);
      continue;
    }
    seen.add(key);
    const nextVal = cleanedUpdates.get(key);
    if (nextVal !== null && nextVal !== undefined) {
      nextLines.push(`${key}=${formatEnvValue(nextVal)}`);
    }
  }

  const updatedKeys: string[] = [];
  const removedKeys: string[] = [];

  for (const [key, nextVal] of cleanedUpdates.entries()) {
    if (nextVal === null) {
      delete process.env[key];
      removedKeys.push(key);
    } else {
      process.env[key] = nextVal;
      updatedKeys.push(key);
      if (!seen.has(key)) {
        nextLines.push(`${key}=${formatEnvValue(nextVal)}`);
      }
    }
  }

  const content = `${nextLines.join("\n").replace(/\n+$/, "")}\n`;
  const tmpPath = `${envPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmpPath, content, { encoding: "utf-8", mode: 0o600 });
  renameSync(tmpPath, envPath);
  try {
    chmodSync(envPath, 0o600);
  } catch {}

  return { updatedKeys, removedKeys, envPath };
}
