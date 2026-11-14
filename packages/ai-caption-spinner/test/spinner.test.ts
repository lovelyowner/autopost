import { describe, expect, it } from "vitest";
import {
  CAPTION_PROFILES,
  normalizeCaption,
  profileForPlatform,
  renderForPlatform,
  similarity,
  spinCaptions,
  violatesStrict,
  type LlmProvider,
  type PostBrief,
} from "../src/index";
import { getPlatform } from "@polypost/platform-registry";

describe("ai-caption-spinner", () => {
  const brief: PostBrief = {
    topic: "Behind the scenes photoshoot in neon lighting",
    creatorName: "StudioNova",
    niche: "Cyberpunk aesthetic",
    priceUsd: 15,
    funnelUrl: "https://hub.example.com/c/novapost",
    seoSeedTags: ["neon", "cyberpunk", "photoshoot"],
  };

  it("identifies correct profile per platform policy and quadrant", () => {
    expect(profileForPlatform(getPlatform("instagram"))).toBe("strict_sfw_clean");
    expect(profileForPlatform(getPlatform("pornhub_video"))).toBe("tube_seo");
    expect(profileForPlatform(getPlatform("fansly_wall"))).toBe("creator_store");
    expect(profileForPlatform(getPlatform("discord"))).toBe("chat_community");
    expect(profileForPlatform(getPlatform("bluesky"))).toBe("microblog");
  });

  it("detects forbidden terms in strict_sfw_clean mode", () => {
    expect(violatesStrict("Check out my latest photoshoot in cyberpunk neon")).toBeNull();
    expect(violatesStrict("Check out this 18+ content")).toBe("18+");
    expect(violatesStrict("Follow my onlyfans for more")).toBe("onlyfans");
  });

  it("normalizes and validates all five caption profiles", () => {
    const tube = normalizeCaption("tube_seo", {
      title: "Epic Cyberpunk Neon Shoot",
      description: "A look into the dark neon studio set.",
      categories: ["Art", "Amateur"],
      tags: ["neon", "cyberpunk"],
    }, brief);
    expect(tube.profile).toBe("tube_seo");
    expect(tube.tags).toContain("cyberpunk");

    const store = normalizeCaption("creator_store", {
      hook: "Exclusive Neon Set Out Now!",
      body: "Unlock the full 4K vault release today.",
      priceUsd: 15,
      hashtags: ["#cyberpunk"],
    }, brief);
    expect(store.profile).toBe("creator_store");
    expect(store.hashtags).toContain("#fyp");

    const micro = normalizeCaption("microblog", {
      text: "Exploring heavy neon contrast in the studio.",
      hashtags: ["#neon", "#creative"],
    }, brief);
    expect(micro.profile).toBe("microblog");

    const chat = normalizeCaption("chat_community", {
      text: "New drop live in the gallery vault!",
    }, brief);
    expect(chat.profile).toBe("chat_community");
    expect(chat.spoilerAttachments).toBe(true);

    const sfw = normalizeCaption("strict_sfw_clean", {
      text: "Lighting study in magenta and teal in studio.",
      hashtags: ["#photography", "#lighting"],
    }, brief);
    expect(sfw.profile).toBe("strict_sfw_clean");
  });

  it("computes shingle similarity properly", () => {
    const s1 = "Behind the scenes photoshoot in neon lighting with high contrast";
    const s2 = "Behind the scenes photoshoot in neon lighting with high contrast";
    const s3 = "Completely different text with entirely unique words and structure";
    expect(similarity(s1, s2)).toBe(1.0);
    expect(similarity(s1, s3)).toBe(0.0);
  });

  it("spins 5 distinct captions using mock LLM provider", async () => {
    const mockProvider: LlmProvider = {
      name: "mock-llm",
      async generateJson(system, prompt) {
        if (prompt.includes("tube_seo")) {
          return {
            title: "Cyberpunk Studio Session 4K",
            description: "High energy neon photography session.",
            categories: ["Studio", "Aesthetic"],
            tags: ["neon", "cyberpunk", "studio"],
          };
        }
        if (prompt.includes("creator_store")) {
          return {
            hook: "New 4K Cyberpunk Gallery Unlocked!",
            body: "Get immediate access to the full raw series.",
            priceUsd: 15,
            hashtags: ["#cyberpunk", "#exclusive"],
          };
        }
        if (prompt.includes("microblog")) {
          return {
            text: "Testing out the new high-voltage violet tubes.",
            hashtags: ["#studio", "#lighting"],
          };
        }
        if (prompt.includes("chat_community")) {
          return {
            text: "Hey everyone! The cyberpunk gallery is now available to view.",
          };
        }
        if (prompt.includes("strict_sfw_clean")) {
          return {
            text: "Lighting experimental setups with colored tubes.",
            hashtags: ["#cinematography", "#lighting"],
          };
        }
        throw new Error("Unknown prompt profile");
      },
    };

    const captions = await spinCaptions(brief, {
      providers: [mockProvider],
    });

    expect(Object.keys(captions)).toEqual(CAPTION_PROFILES);
    expect(captions.tube_seo.title).toBe("Cyberpunk Studio Session 4K");
    expect(captions.creator_store.hashtags).toContain("#fyp");

    // Test rendering for a strict platform and an adult platform
    const renderedIg = renderForPlatform(getPlatform("instagram"), captions, "https://funnel.link", false);
    expect(renderedIg).not.toContain("https://funnel.link"); // not safe for strict
    expect(renderedIg).toContain("Lighting experimental setups");

    const renderedFansly = renderForPlatform(getPlatform("fansly_wall"), captions, "https://funnel.link");
    expect(renderedFansly).toContain("https://funnel.link");
  });
});
