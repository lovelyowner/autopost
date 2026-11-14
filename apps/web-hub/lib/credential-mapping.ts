/**
 * Shared pure credential mapping between flat environment keys (stored in .env locally
 * or browser localStorage per visitor in cloud mode) and connector-specific credential shapes.
 */

export function buildClientApiFlags(
  creds: Record<string, string> = {},
  serverFlags: Record<string, boolean> = {},
): Record<string, boolean> {
  const has = (k: string) => Boolean(creds[k]?.trim());
  const flag = (id: string, clientReady: boolean) => Boolean(serverFlags[id] || clientReady);

  return {
    ...serverFlags,
    bluesky: flag("bluesky", has("BLUESKY_IDENTIFIER") && has("BLUESKY_PASSWORD")),
    mastodon: flag("mastodon", has("MASTODON_ACCESS_TOKEN")),
    misskey: flag("misskey", has("MISSKEY_TOKEN")),
    lemmy: flag("lemmy", (has("LEMMY_USERNAME") && has("LEMMY_PASSWORD")) || has("LEMMY_JWT")),
    tumblr: flag("tumblr", has("TUMBLR_BLOG") && has("TUMBLR_ACCESS_TOKEN")),
    nostr: flag("nostr", has("NOSTR_PRIVATE_KEY")),
    matrix: flag("matrix", has("MATRIX_ACCESS_TOKEN") && has("MATRIX_ROOM_ID")),
    farcaster: flag("farcaster", has("FARCASTER_NEYNAR_API_KEY") && has("FARCASTER_SIGNER_UUID")),
    wordpress: flag(
      "wordpress",
      has("WORDPRESS_SITE_URL") && has("WORDPRESS_USERNAME") && has("WORDPRESS_APP_PASSWORD"),
    ),
    devto: flag("devto", has("DEVTO_API_KEY")),
    revolt: flag("revolt", has("REVOLT_BOT_TOKEN") && has("REVOLT_CHANNEL_ID")),
    vk: flag("vk", has("VK_ACCESS_TOKEN")),
    telegram: flag("telegram", has("TELEGRAM_BOT_TOKEN") && has("TELEGRAM_CHAT_ID")),
    discord: flag(
      "discord",
      has("WEBHOOK_DISCORD_WEBHOOK") || has("WEBHOOK_DISCORD") || has("DISCORD_WEBHOOK_URL"),
    ),
    slack: flag(
      "slack",
      has("WEBHOOK_SLACK_WEBHOOK") || has("WEBHOOK_SLACK") || has("SLACK_WEBHOOK_URL"),
    ),
    peertube: flag("peertube", has("PEERTUBE_ENDPOINT")),
    reddit: flag(
      "reddit",
      has("REDDIT_ACCESS_TOKEN") ||
        (has("REDDIT_CLIENT_ID") &&
          has("REDDIT_CLIENT_SECRET") &&
          has("REDDIT_USERNAME") &&
          has("REDDIT_PASSWORD")),
    ),
    e621: flag("e621", has("E621_USERNAME") && has("E621_API_KEY")),
    deviantart: flag("deviantart", has("DEVIANTART_ACCESS_TOKEN")),
    inkbunny: flag(
      "inkbunny",
      has("INKBUNNY_SID") || (has("INKBUNNY_USERNAME") && has("INKBUNNY_PASSWORD")),
    ),
    openrouter: flag("openrouter", has("OPENROUTER_API_KEY")),
  };
}

function compactRecord(input: Record<string, string | undefined>): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === "string" && v.trim()) {
      out[k] = v.trim();
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Map flat visitor credentials to the exact payload.credentials shape expected by a connector. */
export function mapCredentialsForConnector(
  connectorName: string | undefined,
  flatCreds: Record<string, string> = {},
): Record<string, string> | undefined {
  if (!connectorName) return undefined;
  const c = flatCreds;
  switch (connectorName) {
    case "bluesky":
      return compactRecord({
        identifier: c.BLUESKY_IDENTIFIER,
        password: c.BLUESKY_PASSWORD,
        host: c.BLUESKY_HOST,
      });
    case "mastodon":
      return compactRecord({
        accessToken: c.MASTODON_ACCESS_TOKEN,
        host: c.MASTODON_HOST,
      });
    case "misskey":
      return compactRecord({
        accessToken: c.MISSKEY_TOKEN,
        host: c.MISSKEY_HOST,
      });
    case "lemmy":
      return compactRecord({
        host: c.LEMMY_HOST,
        username: c.LEMMY_USERNAME,
        password: c.LEMMY_PASSWORD,
        accessToken: c.LEMMY_JWT,
        community: c.LEMMY_COMMUNITY,
      });
    case "tumblr":
      return compactRecord({
        accessToken: c.TUMBLR_ACCESS_TOKEN,
        blog: c.TUMBLR_BLOG,
      });
    case "nostr":
      return compactRecord({
        privateKey: c.NOSTR_PRIVATE_KEY,
        relays: c.NOSTR_RELAYS,
      });
    case "matrix":
      return compactRecord({
        homeserver: c.MATRIX_HOMESERVER_URL,
        accessToken: c.MATRIX_ACCESS_TOKEN,
        roomId: c.MATRIX_ROOM_ID,
      });
    case "farcaster":
      return compactRecord({
        apiKey: c.FARCASTER_NEYNAR_API_KEY,
        signerUuid: c.FARCASTER_SIGNER_UUID,
      });
    case "wordpress":
      return compactRecord({
        siteUrl: c.WORDPRESS_SITE_URL,
        username: c.WORDPRESS_USERNAME,
        appPassword: c.WORDPRESS_APP_PASSWORD,
      });
    case "devto":
      return compactRecord({ apiKey: c.DEVTO_API_KEY });
    case "revolt":
      return compactRecord({
        botToken: c.REVOLT_BOT_TOKEN,
        channelId: c.REVOLT_CHANNEL_ID,
      });
    case "vk":
      return compactRecord({
        accessToken: c.VK_ACCESS_TOKEN,
        ownerId: c.VK_OWNER_ID,
      });
    case "telegram":
      return compactRecord({
        botToken: c.TELEGRAM_BOT_TOKEN,
        chatId: c.TELEGRAM_CHAT_ID,
        apiBase: c.TELEGRAM_API_BASE,
      });
    case "reddit":
      return compactRecord({
        clientId: c.REDDIT_CLIENT_ID,
        clientSecret: c.REDDIT_CLIENT_SECRET,
        username: c.REDDIT_USERNAME,
        password: c.REDDIT_PASSWORD,
        accessToken: c.REDDIT_ACCESS_TOKEN,
        subreddit: c.REDDIT_SUBREDDIT,
      });
    case "e621":
      return compactRecord({
        username: c.E621_USERNAME,
        apiKey: c.E621_API_KEY,
      });
    case "deviantart":
      return compactRecord({ accessToken: c.DEVIANTART_ACCESS_TOKEN });
    case "inkbunny":
      return compactRecord({
        username: c.INKBUNNY_USERNAME,
        password: c.INKBUNNY_PASSWORD,
        sid: c.INKBUNNY_SID,
      });
    case "discord_webhook":
      return compactRecord({
        webhookUrl: c.WEBHOOK_DISCORD_WEBHOOK || c.WEBHOOK_DISCORD || c.DISCORD_WEBHOOK_URL,
      });
    case "slack_webhook":
      return compactRecord({
        webhookUrl: c.WEBHOOK_SLACK_WEBHOOK || c.WEBHOOK_SLACK || c.SLACK_WEBHOOK_URL,
      });
    case "x":
      return compactRecord({ bearerToken: c.X_BEARER_TOKEN });
    default:
      return undefined;
  }
}
