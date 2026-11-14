export type Quadrant = "sfw_social" | "sfw_video" | "nsfw_social" | "nsfw_tube";

export type Transport = "rest_api" | "postybirb_cookie" | "chunked_stream" | "patchright_stealth";

/**
 * How PolyPost actually reaches the platform today.
 * - native_connector: implemented REST/chunked connector in apps/node-api-worker
 * - sau_browser: browser uploader vendored from social-auto-upload (apps/stealth-browser-worker)
 * - assisted_session: saved login session + assisted upload page; a human completes and submits the form
 * - registry_only: limits are tracked for planning, no automated upload path exists
 */
export type SupportLevel = "native_connector" | "sau_browser" | "assisted_session" | "registry_only";

export interface Platform {
  id: string;
  name: string;
  url: string;
  quadrant: Quadrant;
  transport: Transport;
  maxMb: number;
  acceptsImages: boolean;
  acceptsVideo: boolean;
  strictSfwPolicy: boolean;
  requiresAdultTaxonomy: boolean;
  support: SupportLevel;
  connector?: string;
  sauPlatform?: string;
  shortFormVideo?: boolean;
  textOnly?: boolean;
  archived?: boolean;
  notes?: string;
}

export type ScalingMode = "strict" | "waterfall_autoscale";

export interface UploadConstraints {
  mode: ScalingMode;
  allowedMaxMb: number;
  bottleneckPlatform: Platform | null;
  nextLimitIfUnchecked: number;
  sorted: Platform[];
}

export type RenditionKind = "master" | "promo_cut" | "teaser_clip" | "link_preview";

export interface RenditionAssignment {
  platformId: string;
  rendition: RenditionKind;
  targetMaxMb: number;
  maxDurationSec?: number;
  reason: string;
}
