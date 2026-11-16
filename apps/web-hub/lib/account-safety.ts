export interface PlatformSafetyCap {
  id: string;
  name: string;
  safeAccountsPerIp: string;
  maxPostsPerDayPerAccount: string;
  minGapMinutes: number;
  connectionAdvice: string;
  notes: string;
}

export interface VaultProfileForCollision {
  account_id: string;
  platform?: string;
  platforms?: string[];
  proxy?: string | null;
}

export interface ProxyCollisionWarning {
  platform: string;
  endpointLabel: string;
  isDirectIp: boolean;
  accounts: string[];
  message: string;
}

export const SPA_BROWSER_ORIGIN_PLATFORMS = new Set([
  "discord",
  "fluxer",
  "stoat",
  "revolt",
  "matrix",
  "nostr",
  "bluesky",
]);

export const PLATFORM_SAFETY_CAPS: PlatformSafetyCap[] = [
  {
    id: "bluesky",
    name: "Bluesky",
    safeAccountsPerIp: "2–3",
    maxPostsPerDayPerAccount: "8–15 posts/day",
    minGapMinutes: 25,
    connectionAdvice: "Home Wi-Fi OK up to 2–3 accounts; App Password API preferred",
    notes: "Use native App Passwords (ATProto) for lowest ban risk; avoid duplicate spam links across accounts within 30m.",
  },
  {
    id: "clips4sale",
    name: "Clips4Sale",
    safeAccountsPerIp: "1–2",
    maxPostsPerDayPerAccount: "1–3 clips/day",
    minGapMinutes: 90,
    connectionAdvice: "1 residential/home IP per creator brand",
    notes: "KYC-tied studio store; separate proxy + device fingerprint if managing multiple distinct studios.",
  },
  {
    id: "discord",
    name: "Discord",
    safeAccountsPerIp: "1–2 (user) / unlimited (webhooks)",
    maxPostsPerDayPerAccount: "10–30 messages/day",
    minGapMinutes: 10,
    connectionAdvice: "Prefer Webhooks or Official Bot Token on Home IP",
    notes: "Webhooks never trigger self-bot bans. Do not run >2 user browser tokens from one residential IP.",
  },
  {
    id: "fansly",
    name: "Fansly",
    safeAccountsPerIp: "1–2",
    maxPostsPerDayPerAccount: "2–4 posts/day",
    minGapMinutes: 60,
    connectionAdvice: "Sticky Residential IP recommended if running 2+ models",
    notes: "Strict KYC platform; keep a sticky IP locked per alias and attach 2257 metadata consistently.",
  },
  {
    id: "fluxer",
    name: "Fluxer",
    safeAccountsPerIp: "2–3 (user) / unlimited (webhooks)",
    maxPostsPerDayPerAccount: "10–25 messages/day",
    minGapMinutes: 10,
    connectionAdvice: "Prefer Webhook URL; sticky proxy for 2+ web logins",
    notes: "Official channel webhooks avoid browser fingerprint risk when autoposting across servers.",
  },
  {
    id: "instagram",
    name: "Instagram",
    safeAccountsPerIp: "1–2 (strict) / up to 3 aged",
    maxPostsPerDayPerAccount: "1–2 Reels/posts/day",
    minGapMinutes: 180,
    connectionAdvice: "Dedicated 4G/Mobile or Sticky Residential Proxy per extra account",
    notes: "Very aggressive IP & device clustering. Avoid VPN IPs (datacenter ranges trigger instant checkpoints).",
  },
  {
    id: "mastodon",
    name: "Mastodon",
    safeAccountsPerIp: "3–5 (across instances)",
    maxPostsPerDayPerAccount: "5–10 toots/day",
    minGapMinutes: 30,
    connectionAdvice: "Home IP OK via OAuth2 API",
    notes: "Zero-config OAuth2 API has zero anti-bot captcha risk; respect each instance's automated-posting rules.",
  },
  {
    id: "matrix",
    name: "Matrix",
    safeAccountsPerIp: "2–3",
    maxPostsPerDayPerAccount: "10–20 room posts/day",
    minGapMinutes: 15,
    connectionAdvice: "Home IP OK via Access Token API",
    notes: "Token-based room API is safer and lighter than keeping multiple Element Web sessions open.",
  },
  {
    id: "manyvids",
    name: "ManyVids",
    safeAccountsPerIp: "1–2",
    maxPostsPerDayPerAccount: "1–3 uploads/day",
    minGapMinutes: 90,
    connectionAdvice: "Sticky Residential IP per creator store",
    notes: "Match timezone and sticky residential proxy to creator region to avoid payout/security holds.",
  },
  {
    id: "nostr",
    name: "Nostr",
    safeAccountsPerIp: "Unlimited keypairs",
    maxPostsPerDayPerAccount: "15–30 notes/day",
    minGapMinutes: 10,
    connectionAdvice: "No proxy needed for signed Schnorr API events",
    notes: "Cryptographic keypairs cannot be centrally IP-banned across open relays.",
  },
  {
    id: "onlyfans",
    name: "OnlyFans",
    safeAccountsPerIp: "1 (strict)",
    maxPostsPerDayPerAccount: "2–5 posts/day",
    minGapMinutes: 60,
    connectionAdvice: "Dedicated clean Home IP or 1 Sticky Residential Proxy per account",
    notes: "Keep exactly 1 creator account per IP/browser profile; never switch datacenter VPN endpoints mid-session.",
  },
  {
    id: "pinterest",
    name: "Pinterest",
    safeAccountsPerIp: "1–3 business accounts",
    maxPostsPerDayPerAccount: "2–5 Pins/day",
    minGapMinutes: 90,
    connectionAdvice: "Sticky Residential IP required above 2 accounts",
    notes: "Ramp new accounts slowly for 14 days (1–2 Pins/day); vary captions and board targets.",
  },
  {
    id: "pornhub",
    name: "PornHub",
    safeAccountsPerIp: "1–2",
    maxPostsPerDayPerAccount: "1–3 videos/day",
    minGapMinutes: 120,
    connectionAdvice: "Sticky Residential IP aligned with model verification region",
    notes: "Verify 2257 co-performer records before scheduling automated browser uploads.",
  },
  {
    id: "reddit",
    name: "Reddit",
    safeAccountsPerIp: "1–2 aged / up to 3 on separate residential proxies",
    maxPostsPerDayPerAccount: "2–5 posts/day (spaced across subreddits)",
    minGapMinutes: 60,
    connectionAdvice: "1 Sticky Residential Proxy per alias (no shared datacenter VPNs)",
    notes: "Reddit shadowbans whole IP subnets cleanly. Warm up karma manually before enabling autopost.",
  },
  {
    id: "stoat",
    name: "Stoat",
    safeAccountsPerIp: "2–3",
    maxPostsPerDayPerAccount: "10–25 messages/day",
    minGapMinutes: 10,
    connectionAdvice: "Home IP OK via Session/Bot Token API",
    notes: "Sign in once via Stoat API token rather than running redundant headless tabs.",
  },
  {
    id: "telegram",
    name: "Telegram",
    safeAccountsPerIp: "Unlimited channels per Bot",
    maxPostsPerDayPerAccount: "20–50 channel posts/day",
    minGapMinutes: 5,
    connectionAdvice: "No proxy required for @BotFather HTTP API",
    notes: "Official @BotFather bots can broadcast to unlimited owned channels safely without browser risk.",
  },
  {
    id: "threads",
    name: "Threads",
    safeAccountsPerIp: "1–2",
    maxPostsPerDayPerAccount: "3–6 posts/day",
    minGapMinutes: 60,
    connectionAdvice: "Same strict Meta rules as Instagram (sticky mobile/residential IP)",
    notes: "Linked to Instagram identity; an Instagram checkpoint locks Threads simultaneously.",
  },
  {
    id: "tiktok",
    name: "TikTok",
    safeAccountsPerIp: "1–2 (strict) / up to 3 on separate devices/4G proxies",
    maxPostsPerDayPerAccount: "1–3 videos/day",
    minGapMinutes: 180,
    connectionAdvice: "Dedicated clean SIM/Residential IP per account; never swap country VPNs",
    notes: "Strong device + subnet fingerprinting; warm new profiles manually for 3–5 days before autoposting.",
  },
  {
    id: "x",
    name: "X (Twitter)",
    safeAccountsPerIp: "1–3 aged / 1 new per IP",
    maxPostsPerDayPerAccount: "3–8 posts/day",
    minGapMinutes: 45,
    connectionAdvice: "Home Wi-Fi OK up to 2–3; Sticky Residential Proxy beyond 2 accounts",
    notes: "Always spin/vary text & crop/re-encode media hash between accounts so identical posts aren't flagged.",
  },
  {
    id: "youtube",
    name: "YouTube",
    safeAccountsPerIp: "2–3 channels (1 Google Studio / Brand Account OK)",
    maxPostsPerDayPerAccount: "1–3 Shorts/videos/day",
    minGapMinutes: 120,
    connectionAdvice: "Prefer Official OAuth2 Data API; sticky home IP for Studio browser",
    notes: "Use Google Brand Channels under one Studio login or Official YouTube API OAuth instead of separate logins.",
  },
];

export function extractProxyEndpointKey(proxy?: string | null): string {
  const raw = (proxy || "").trim();
  if (!raw) return "DIRECT_IP";
  try {
    const normalized = raw.includes("://") ? raw : `http://${raw}`;
    const parsed = new URL(normalized);
    if (parsed.hostname) {
      return parsed.port ? `${parsed.hostname.toLowerCase()}:${parsed.port}` : parsed.hostname.toLowerCase();
    }
  } catch {
    // Handle redacted placeholders like http://***:***@host:port
    const atIdx = raw.lastIndexOf("@");
    const tail = atIdx >= 0 ? raw.slice(atIdx + 1) : raw.replace(/^[a-z0-9+.-]+:\/\//i, "");
    const hostPort = tail.split("/")[0]?.trim().toLowerCase();
    if (hostPort) return hostPort;
  }
  return raw;
}

export function normalizePlatformFamily(platformId?: string): string {
  const raw = (platformId || "").trim().toLowerCase();
  if (!raw || raw === "browser_session" || raw === "generic") return "";
  if (raw.startsWith("pornhub")) return "pornhub";
  if (raw.startsWith("onlyfans")) return "onlyfans";
  if (raw.startsWith("fansly")) return "fansly";
  if (raw.startsWith("manyvids")) return "manyvids";
  if (raw.startsWith("loyalfans")) return "loyalfans";
  if (raw.startsWith("reddit")) return "reddit";
  if (raw === "revolt") return "stoat";
  return raw;
}

export function detectMultiAccountProxyCollisions(
  profiles: VaultProfileForCollision[],
): ProxyCollisionWarning[] {
  const buckets = new Map<string, { platform: string; endpointKey: string; accounts: Set<string> }>();

  for (const prof of profiles) {
    const accId = (prof.account_id || "").trim();
    if (!accId) continue;
    const rawPlats =
      Array.isArray(prof.platforms) && prof.platforms.length > 0
        ? prof.platforms
        : prof.platform
          ? [prof.platform]
          : [];
    const families = new Set(rawPlats.map(normalizePlatformFamily).filter(Boolean));
    const endpointKey = extractProxyEndpointKey(prof.proxy);

    for (const fam of families) {
      const bucketKey = `${fam}::${endpointKey}`;
      let entry = buckets.get(bucketKey);
      if (!entry) {
        entry = { platform: fam, endpointKey, accounts: new Set() };
        buckets.set(bucketKey, entry);
      }
      entry.accounts.add(accId);
    }
  }

  const warnings: ProxyCollisionWarning[] = [];
  for (const entry of buckets.values()) {
    if (entry.accounts.size < 2) continue;
    const accounts = Array.from(entry.accounts).sort();
    const isDirect = entry.endpointKey === "DIRECT_IP";
    warnings.push({
      platform: entry.platform,
      endpointLabel: isDirect ? "Direct IP (no proxy)" : entry.endpointKey,
      isDirectIp: isDirect,
      accounts,
      message: isDirect
        ? `${accounts.length} '${entry.platform}' accounts (${accounts.join(", ")}) share your Direct IP. Assign separate sticky residential proxies to avoid linked IP flags.`
        : `${accounts.length} '${entry.platform}' accounts (${accounts.join(", ")}) share proxy ${entry.endpointKey}. Use 1 distinct proxy endpoint per alias.`,
    });
  }

  return warnings.sort((a, b) => a.platform.localeCompare(b.platform));
}
