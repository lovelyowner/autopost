import { NextRequest, NextResponse } from "next/server";
import {
  OpenAiCompatibleProvider,
  providersFromEnv,
  spinCaptions,
  type CaptionSet,
  type LlmProvider,
  type PostBrief,
} from "@polypost/ai-caption-spinner";

function buildOfflineTemplateProvider(brief: PostBrief): LlmProvider {
  const cleanTopic = brief.topic.replace(/\b(nsfw|xxx|porn|nude|18\+|explicit)\b/gi, "Studio").trim() || "New Release";
  const tags = (brief.seoSeedTags && brief.seoSeedTags.length > 0 ? brief.seoSeedTags : ["studio", "4k", "release", "creator"]).slice(0, 16);
  const sfwTags = tags.filter((t) => !/nsfw|xxx|porn|nude|18\+|onlyfans|fansly/i.test(t)).slice(0, 5);

  return {
    name: "offline_template",
    async generateJson(_system, prompt) {
      if (prompt.includes("Caption profile: tube_seo")) {
        return {
          title: `${brief.topic} - Full ${brief.creatorName || "Creator"} Release`.slice(0, 100),
          description: `Full-length feature covering ${brief.topic}${brief.niche ? ` in our ${brief.niche} series` : ""}. Watch the uncompressed cut now.`,
          categories: ["Creator", "Showcase", "4K", "Studio", "Independent", "Feature", "BTS", "Highlights"],
          tags,
        };
      }
      if (prompt.includes("Caption profile: creator_store")) {
        return {
          hook: `${brief.creatorName || "Studio"} just unlocked: ${brief.topic}`,
          body: `Full unedited vault drop is available now.${brief.priceUsd ? ` Unlock for $${brief.priceUsd}.` : ""} {{LIVE_MASTER_URL}}`,
          priceUsd: brief.priceUsd ?? null,
          hashtags: ["#fyp", "#exclusive", ...tags.slice(0, 3)],
        };
      }
      if (prompt.includes("Caption profile: microblog")) {
        return {
          text: `Fresh from editing: ${cleanTopic}${brief.niche ? ` (${brief.niche})` : ""}. Watch the full cut here -> {{LIVE_MASTER_URL}}`,
          hashtags: sfwTags.slice(0, 3),
        };
      }
      if (prompt.includes("Caption profile: chat_community")) {
        return {
          text: `Community premiere from ${brief.creatorName || "the studio"}: ${brief.topic} is now live! Full link -> {{LIVE_MASTER_URL}}`,
        };
      }
      return {
        text: `Behind the camera on our latest project: ${cleanTopic}. Focusing on lighting, framing, and clean color grading.`,
        hashtags: sfwTags.length > 0 ? sfwTags : ["creative", "lighting", "studio"],
      };
    },
  };
}

function toEditableMap(set: CaptionSet) {
  return {
    tube_seo: `${set.tube_seo.title}\n\n${set.tube_seo.description}`,
    creator_store: `${set.creator_store.hook}\n\n${set.creator_store.body}\n\n${set.creator_store.hashtags.join(" ")}`,
    microblog: `${set.microblog.text} ${set.microblog.hashtags.join(" ")}`.trim(),
    chat_community: set.chat_community.text,
    strict_sfw_clean: `${set.strict_sfw_clean.text} ${set.strict_sfw_clean.hashtags.join(" ")}`.trim(),
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const brief: PostBrief = {
      topic: String(body.topic || "Studio Showcase"),
      creatorName: body.creatorName ? String(body.creatorName) : undefined,
      niche: body.niche ? String(body.niche) : undefined,
      priceUsd: typeof body.priceUsd === "number" ? body.priceUsd : Number(body.priceUsd) || undefined,
      seoSeedTags: Array.isArray(body.seoSeedTags)
        ? body.seoSeedTags
        : String(body.seedTags || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
      funnelUrl: "{{LIVE_MASTER_URL}}",
    };

    let source = "llm_provider";
    let set: CaptionSet;

    const rawCreds =
      body.credentials && typeof body.credentials === "object"
        ? (body.credentials as Record<string, unknown>)
        : {};
    const cred = (key: string): string | undefined => {
      const v = rawCreds[key];
      return typeof v === "string" && v.trim() ? v.trim() : undefined;
    };

    const clientProviders: LlmProvider[] = [];
    const clientOpenRouter = cred("OPENROUTER_API_KEY");
    if (clientOpenRouter) {
      clientProviders.push(
        new OpenAiCompatibleProvider(
          "openrouter",
          "https://openrouter.ai/api/v1",
          clientOpenRouter,
          cred("OPENROUTER_MODEL") || process.env.OPENROUTER_MODEL || "meta-llama/llama-3.3-70b-instruct",
        ),
      );
    }
    const clientVenice = cred("VENICE_API_KEY");
    if (clientVenice) {
      clientProviders.push(
        new OpenAiCompatibleProvider(
          "venice",
          "https://api.venice.ai/api/v1",
          clientVenice,
          cred("VENICE_MODEL") || process.env.VENICE_MODEL || "venice-uncensored",
        ),
      );
    }

    try {
      const envProviders = providersFromEnv().filter(
        (p) => !process.env.VERCEL || p.name !== "ollama",
      );
      const configuredProviders = [...clientProviders, ...envProviders];
      if (configuredProviders.length === 0) {
        throw new Error("No configured AI provider");
      }
      set = await spinCaptions(brief, {
        providers: configuredProviders,
        maxAttempts: 2,
      });
    } catch {
      source = "offline_template";
      set = await spinCaptions(brief, {
        providers: [buildOfflineTemplateProvider(brief)],
        maxAttempts: 2,
      });
    }

    return NextResponse.json({
      success: true,
      source,
      captions: toEditableMap(set),
      structured: set,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
