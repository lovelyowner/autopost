export type CaptionProfile = "tube_seo" | "creator_store" | "microblog" | "chat_community" | "strict_sfw_clean";

export const CAPTION_PROFILES: CaptionProfile[] = ["tube_seo", "creator_store", "microblog", "chat_community", "strict_sfw_clean"];

export interface TubeSeoCaption {
  profile: "tube_seo";
  title: string;
  description: string;
  categories: string[];
  tags: string[];
}

export interface CreatorStoreCaption {
  profile: "creator_store";
  hook: string;
  body: string;
  priceUsd: number | null;
  hashtags: string[];
}

export interface MicroblogCaption {
  profile: "microblog";
  text: string;
  hashtags: string[];
}

export interface ChatCommunityCaption {
  profile: "chat_community";
  text: string;
  /** Attach media as SPOILER_<name> so Discord-style clients blur it until clicked. */
  spoilerAttachments: boolean;
}

export interface StrictSfwCaption {
  profile: "strict_sfw_clean";
  text: string;
  hashtags: string[];
}

export type Caption = TubeSeoCaption | CreatorStoreCaption | MicroblogCaption | ChatCommunityCaption | StrictSfwCaption;

export interface CaptionSet {
  tube_seo: TubeSeoCaption;
  creator_store: CreatorStoreCaption;
  microblog: MicroblogCaption;
  chat_community: ChatCommunityCaption;
  strict_sfw_clean: StrictSfwCaption;
}

export interface PostBrief {
  topic: string;
  creatorName?: string;
  niche?: string;
  priceUsd?: number | null;
  funnelUrl?: string;
  /** Only include funnelUrl in strict_sfw_clean captions when the destination itself is brand-safe. */
  funnelUrlSafeForStrict?: boolean;
  seoSeedTags?: string[];
  language?: string;
}

export interface LlmProvider {
  name: string;
  generateJson(system: string, prompt: string, temperature: number): Promise<unknown>;
}
