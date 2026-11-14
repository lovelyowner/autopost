import type { Platform } from "@polypost/platform-registry";
import { providersFromEnv } from "./providers";
import type {
  Caption,
  CaptionProfile,
  CaptionSet,
  ChatCommunityCaption,
  CreatorStoreCaption,
  LlmProvider,
  MicroblogCaption,
  PostBrief,
  StrictSfwCaption,
  TubeSeoCaption,
} from "./types";
import { CAPTION_PROFILES } from "./types";

const CHAT_PLATFORMS = new Set(["discord", "fluxer", "stoat", "matrix", "telegram", "slack", "guilded", "signal", "whatsapp_channels"]);

export function profileForPlatform(pl: Platform): CaptionProfile {
  if (pl.strictSfwPolicy) return "strict_sfw_clean";
  if (pl.quadrant === "nsfw_tube") return "tube_seo";
  if (pl.quadrant === "nsfw_social") return "creator_store";
  if (CHAT_PLATFORMS.has(pl.id)) return "chat_community";
  return "microblog";
}

/** Words that must never appear in strict_sfw_clean output. */
export const STRICT_DENYLIST = [
  "nsfw", "nude", "nudes", "naked", "xxx", "porn", "explicit", "18+", "onlyfans", "fansly", "manyvids", "uncensored", "sex",
];

export function violatesStrict(text: string): string | null {
  const lower = text.toLowerCase();
  for (const w of STRICT_DENYLIST) {
    const re = new RegExp(`(^|[^a-z0-9])${w.replace(/[+]/g, "\\+")}([^a-z0-9]|$)`);
    if (re.test(lower)) return w;
  }
  return null;
}

const SYSTEM = [
  "You write social media captions for an independent adult-content creator who publishes their own work.",
  "Respond with a single JSON object only, matching the requested schema exactly.",
  "Never mention minors, non-consent, real people other than the creator, or illegal acts.",
  "Write natural, specific copy. Do not reuse sentences between requests.",
].join(" ");

function briefLines(b: PostBrief, includeLink: boolean): string {
  return [
    `Topic: ${b.topic}`,
    b.creatorName ? `Creator: ${b.creatorName}` : "",
    b.niche ? `Niche: ${b.niche}` : "",
    b.seoSeedTags?.length ? `Seed tags: ${b.seoSeedTags.join(", ")}` : "",
    b.priceUsd != null ? `Price USD: ${b.priceUsd}` : "",
    includeLink && b.funnelUrl ? `Link: ${b.funnelUrl}` : "",
    `Language: ${b.language ?? "English"}`,
  ].filter(Boolean).join("\n");
}

const SCHEMAS: Record<CaptionProfile, string> = {
  tube_seo: '{"title": string (max 100 chars), "description": string (2-3 sentences), "categories": string[8], "tags": string[16]}',
  creator_store: '{"hook": string (one line pay-per-view teaser), "body": string, "priceUsd": number|null, "hashtags": string[] (include "#fyp")}',
  microblog: '{"text": string (max 260 chars, a unique hook), "hashtags": string[] (max 3)}',
  chat_community: '{"text": string (max 400 chars, friendly community announcement)}',
  strict_sfw_clean: '{"text": string (max 220 chars, fully brand-safe, no innuendo, no adult references), "hashtags": string[] (max 5, brand-safe)}',
};

function promptFor(profile: CaptionProfile, b: PostBrief): string {
  const includeLink = profile !== "strict_sfw_clean" || !!b.funnelUrlSafeForStrict;
  return `Caption profile: ${profile}\nSchema: ${SCHEMAS[profile]}\n${briefLines(b, includeLink)}`;
}

const str = (v: unknown, max: number): string => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const list = (v: unknown, n: number, max = 40): string[] =>
  Array.from(new Set((Array.isArray(v) ? v : []).map((x) => str(x, max)).filter(Boolean))).slice(0, n);
const hash = (tags: string[]) => tags.map((t) => (t.startsWith("#") ? t : `#${t.replace(/\s+/g, "")}`));

export function normalizeCaption(profile: CaptionProfile, raw: unknown, brief: PostBrief): Caption {
  const r = (raw ?? {}) as Record<string, unknown>;
  switch (profile) {
    case "tube_seo": {
      const tags = list([...(Array.isArray(r.tags) ? r.tags : []), ...(brief.seoSeedTags ?? [])], 16);
      const c: TubeSeoCaption = { profile, title: str(r.title, 100), description: str(r.description, 1000), categories: list(r.categories, 8), tags };
      if (!c.title) throw new Error("tube_seo caption missing title");
      return c;
    }
    case "creator_store": {
      const tags = hash(list(r.hashtags, 10));
      if (!tags.includes("#fyp")) tags.push("#fyp");
      const price = typeof r.priceUsd === "number" ? r.priceUsd : (brief.priceUsd ?? null);
      const c: CreatorStoreCaption = { profile, hook: str(r.hook, 140), body: str(r.body, 1500), priceUsd: price, hashtags: tags };
      if (!c.hook) throw new Error("creator_store caption missing hook");
      return c;
    }
    case "microblog": {
      const c: MicroblogCaption = { profile, text: str(r.text, 260), hashtags: hash(list(r.hashtags, 3)) };
      if (!c.text) throw new Error("microblog caption missing text");
      return c;
    }
    case "chat_community": {
      const c: ChatCommunityCaption = { profile, text: str(r.text, 400), spoilerAttachments: true };
      if (!c.text) throw new Error("chat_community caption missing text");
      return c;
    }
    case "strict_sfw_clean": {
      const c: StrictSfwCaption = { profile, text: str(r.text, 220), hashtags: hash(list(r.hashtags, 5)) };
      if (!c.text) throw new Error("strict_sfw_clean caption missing text");
      const bad = violatesStrict(`${c.text} ${c.hashtags.join(" ")}`);
      if (bad) throw new Error(`strict_sfw_clean caption contains disallowed term "${bad}"`);
      return c;
    }
  }
}

export function captionText(c: Caption): string {
  switch (c.profile) {
    case "tube_seo":
      return `${c.title} ${c.description}`;
    case "creator_store":
      return `${c.hook} ${c.body}`;
    default:
      return c.text;
  }
}

function shingles(text: string): Set<string> {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + 2 < words.length; i++) out.add(words.slice(i, i + 3).join(" "));
  if (out.size === 0) words.forEach((w) => out.add(w));
  return out;
}

export function similarity(a: string, b: string): number {
  const sa = shingles(a);
  const sb = shingles(b);
  let inter = 0;
  sa.forEach((s) => sb.has(s) && inter++);
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

export interface SpinOptions {
  providers?: LlmProvider[];
  maxAttempts?: number;
  maxSimilarity?: number;
}

async function generateOne(profile: CaptionProfile, brief: PostBrief, providers: LlmProvider[], avoid: string[], opts: Required<Omit<SpinOptions, "providers">>): Promise<Caption> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    for (const provider of providers) {
      try {
        const avoidNote = avoid.length ? `\nDo not reuse phrasing from: ${avoid.map((a) => JSON.stringify(a.slice(0, 120))).join("; ")}` : "";
        const raw = await provider.generateJson(SYSTEM, promptFor(profile, brief) + avoidNote, 0.8 + attempt * 0.1);
        const caption = normalizeCaption(profile, raw, brief);
        const text = captionText(caption);
        if (avoid.some((a) => similarity(a, text) > opts.maxSimilarity)) throw new Error("caption too similar to a sibling caption");
        return caption;
      } catch (err) {
        lastErr = err;
      }
    }
  }
  throw new Error(`could not generate ${profile} caption: ${(lastErr as Error)?.message ?? lastErr}`);
}

/** Generates the five profile captions for one post, keeping them mutually distinct. */
export async function spinCaptions(brief: PostBrief, opts: SpinOptions = {}): Promise<CaptionSet> {
  const providers = opts.providers ?? providersFromEnv();
  const o = { maxAttempts: opts.maxAttempts ?? 3, maxSimilarity: opts.maxSimilarity ?? 0.5 };
  const out: Partial<CaptionSet> = {};
  const seen: string[] = [];
  for (const profile of CAPTION_PROFILES) {
    const c = await generateOne(profile, brief, providers, seen, o);
    seen.push(captionText(c));
    (out as Record<string, Caption>)[profile] = c;
  }
  return out as CaptionSet;
}

/** Renders the final post text for a platform, appending the funnel link where it belongs. */
export function renderForPlatform(pl: Platform, set: CaptionSet, funnelUrl?: string, funnelUrlSafeForStrict = false): string {
  const profile = profileForPlatform(pl);
  const link = funnelUrl && (profile !== "strict_sfw_clean" || funnelUrlSafeForStrict) ? funnelUrl : "";
  switch (profile) {
    case "tube_seo":
      return [set.tube_seo.title, set.tube_seo.description, link].filter(Boolean).join("\n\n");
    case "creator_store":
      return [set.creator_store.hook, set.creator_store.body, link, set.creator_store.hashtags.join(" ")].filter(Boolean).join("\n\n");
    case "chat_community":
      return [set.chat_community.text, link].filter(Boolean).join("\n");
    case "strict_sfw_clean":
      return [set.strict_sfw_clean.text, link, set.strict_sfw_clean.hashtags.join(" ")].filter(Boolean).join("\n");
    default:
      return [set.microblog.text, link, set.microblog.hashtags.join(" ")].filter(Boolean).join(" ").trim();
  }
}
