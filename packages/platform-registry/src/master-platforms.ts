import type { Platform, Quadrant, SupportLevel, Transport } from "./types";

interface Opts {
  img?: boolean;
  vid?: boolean;
  strict?: boolean;
  adultTax?: boolean;
  support?: SupportLevel;
  connector?: string;
  sau?: string;
  short?: boolean;
  textOnly?: boolean;
  archived?: boolean;
  notes?: string;
  transport?: Transport;
}

function p(
  id: string,
  name: string,
  url: string,
  quadrant: Quadrant,
  transport: Transport,
  maxMb: number,
  o: Opts = {},
): Platform {
  return {
    id,
    name,
    url,
    quadrant,
    transport: o.transport ?? transport,
    maxMb,
    acceptsImages: o.img ?? true,
    acceptsVideo: o.vid ?? true,
    strictSfwPolicy: o.strict ?? false,
    requiresAdultTaxonomy: o.adultTax ?? false,
    support: o.support ?? "registry_only",
    connector: o.connector,
    sauPlatform: o.sau,
    shortFormVideo: o.short,
    textOnly: o.textOnly,
    archived: o.archived ?? false,
    notes: o.notes,
  };
}

const N = "native_connector" as const;
const S = "sau_browser" as const;
const A = "assisted_session" as const;

const tube = (id: string, name: string, url: string, maxMb: number, o: Opts = {}) =>
  p(id, name, url, "nsfw_tube", "patchright_stealth", maxMb, { img: false, adultTax: true, support: A, ...o });

const wall = (id: string, name: string, url: string, maxMb: number, o: Opts = {}) =>
  p(id, name, url, "nsfw_social", "patchright_stealth", maxMb, { adultTax: true, support: A, ...o });

const booru = (id: string, name: string, url: string, maxMb: number, o: Opts = {}) =>
  p(id, name, url, "nsfw_social", "postybirb_cookie", maxMb, { support: A, ...o });

export const MASTER_PLATFORMS: Platform[] = [
  // SFW social, chat, fediverse, publishing
  p("x", "X (Twitter)", "https://x.com", "sfw_social", "rest_api", 512, { support: N, connector: "x", textOnly: true, notes: "Connector posts text + link via API v2" }),
  p("bluesky", "Bluesky", "https://bsky.app", "sfw_social", "rest_api", 100, { support: N, connector: "bluesky" }),
  p("nostr", "Nostr", "https://nostr.com", "sfw_social", "rest_api", 100, { support: N, connector: "nostr", textOnly: true }),
  p("mastodon", "Mastodon", "https://joinmastodon.org", "sfw_social", "rest_api", 40, { support: N, connector: "mastodon" }),
  p("misskey", "Misskey", "https://misskey-hub.net", "sfw_social", "rest_api", 40, { support: N, connector: "misskey" }),
  p("lemmy", "Lemmy", "https://join-lemmy.org", "sfw_social", "rest_api", 100, { support: N, connector: "lemmy" }),
  p("piefed", "PieFed", "https://join.piefed.social", "sfw_social", "rest_api", 100, { support: N, connector: "lemmy", notes: "Uses PieFed's Lemmy-compatible API" }),
  p("tumblr", "Tumblr", "https://tumblr.com", "sfw_social", "rest_api", 500, { strict: true, support: N, connector: "tumblr" }),
  p("telegram", "Telegram Channels", "https://telegram.org", "sfw_social", "rest_api", 2048, { support: N, connector: "telegram", notes: "Uploads above 50 MB need a self-hosted Bot API server" }),
  p("matrix", "Matrix", "https://matrix.org", "sfw_social", "rest_api", 100, { support: N, connector: "matrix" }),
  p("farcaster", "Farcaster (Warpcast)", "https://farcaster.xyz", "sfw_social", "rest_api", 100, { support: N, connector: "farcaster", textOnly: true, notes: "Posts through the Neynar API" }),
  p("wordpress", "WordPress", "https://wordpress.org", "sfw_social", "rest_api", 50, { support: N, connector: "wordpress", textOnly: true }),
  p("devto", "Dev.to", "https://dev.to", "sfw_social", "rest_api", 25, { support: N, connector: "devto", textOnly: true }),
  p("stoat", "Stoat (Revolt)", "https://stoat.chat", "sfw_social", "rest_api", 25, { support: N, connector: "revolt" }),
  p("vk", "VK", "https://vk.com", "sfw_social", "rest_api", 2048, { support: N, connector: "vk", textOnly: true }),
  p("reddit", "Reddit (SFW)", "https://reddit.com", "sfw_social", "rest_api", 100, { support: N, connector: "reddit", textOnly: true }),
  p("discord", "Discord (Free)", "https://discord.com", "sfw_social", "rest_api", 10, { support: N, connector: "discord_webhook" }),
  p("pixelfed", "Pixelfed", "https://pixelfed.org", "sfw_social", "rest_api", 40, { support: N, connector: "mastodon" }),
  p("pleroma", "Pleroma", "https://pleroma.social", "sfw_social", "rest_api", 40, { support: N, connector: "mastodon" }),
  p("akkoma", "Akkoma", "https://akkoma.social", "sfw_social", "rest_api", 40, { support: N, connector: "mastodon" }),
  p("friendica", "Friendica", "https://friendi.ca", "sfw_social", "rest_api", 40, { support: N, connector: "mastodon" }),
  p("threads", "Threads", "https://threads.net", "sfw_social", "rest_api", 500, { strict: true, support: N, connector: "threads", notes: "Media must be reachable at a public URL" }),
  p("instagram", "Instagram Feed/Reels", "https://instagram.com", "sfw_social", "rest_api", 650, { strict: true, short: true, support: N, connector: "instagram", notes: "Media must be reachable at a public URL" }),
  p("facebook_pages", "Facebook Pages", "https://facebook.com", "sfw_social", "rest_api", 10240, { strict: true, support: N, connector: "facebook_pages" }),
  p("linkedin", "LinkedIn", "https://linkedin.com", "sfw_social", "rest_api", 5120, { strict: true }),
  p("pinterest", "Pinterest", "https://pinterest.com", "sfw_social", "rest_api", 2048, { strict: true, support: N, connector: "pinterest" }),
  p("kbin", "Kbin / Mbin", "https://joinmbin.org", "sfw_social", "rest_api", 100),
  p("fluxer", "Fluxer", "https://fluxer.app", "sfw_social", "rest_api", 10, { support: N, connector: "generic_webhook" }),
  p("guilded", "Guilded", "https://guilded.gg", "sfw_social", "rest_api", 100, { archived: true, notes: "Service discontinued" }),
  p("slack", "Slack", "https://slack.com", "sfw_social", "rest_api", 1024, { support: N, connector: "slack_webhook", textOnly: true }),
  p("whatsapp_channels", "WhatsApp Channels", "https://whatsapp.com", "sfw_social", "rest_api", 16),
  p("signal", "Signal", "https://signal.org", "sfw_social", "rest_api", 100),
  p("hey_lens", "Hey.xyz (Lens)", "https://hey.xyz", "sfw_social", "rest_api", 100),
  p("hive", "Hive", "https://hive.io", "sfw_social", "rest_api", 100),
  p("steemit", "Steemit", "https://steemit.com", "sfw_social", "rest_api", 100),
  p("minds", "Minds", "https://minds.com", "sfw_social", "rest_api", 100),
  p("medium", "Medium", "https://medium.com", "sfw_social", "rest_api", 20, { support: N, connector: "medium", textOnly: true }),
  p("substack", "Substack", "https://substack.com", "sfw_social", "rest_api", 20),
  p("ghost", "Ghost", "https://ghost.org", "sfw_social", "rest_api", 50, { support: N, connector: "ghost", textOnly: true }),
  p("hashnode", "Hashnode", "https://hashnode.com", "sfw_social", "rest_api", 10, { support: N, connector: "hashnode", textOnly: true }),
  p("okru", "OK.ru", "https://ok.ru", "sfw_social", "rest_api", 2048),
  p("rednote", "RedNote (Xiaohongshu)", "https://xiaohongshu.com", "sfw_social", "patchright_stealth", 1024, { strict: true, support: S, sau: "xiaohongshu" }),
  p("lemon8", "Lemon8", "https://lemon8-app.com", "sfw_social", "patchright_stealth", 1024, { strict: true }),
  p("snapchat_spotlight", "Snapchat Spotlight", "https://snapchat.com", "sfw_video", "patchright_stealth", 1024, { strict: true, img: false, short: true }),
  p("vsco", "VSCO", "https://vsco.co", "sfw_social", "patchright_stealth", 250, { strict: true }),

  // SFW and alt-tech video hosts
  p("youtube", "YouTube Long/Shorts", "https://youtube.com", "sfw_video", "chunked_stream", 262144, { strict: true, img: false, support: N, connector: "youtube", sau: "youtube" }),
  p("tiktok", "TikTok", "https://tiktok.com", "sfw_video", "chunked_stream", 2048, { strict: true, img: false, short: true, support: N, connector: "tiktok" }),
  p("bilibili", "Bilibili", "https://bilibili.com", "sfw_video", "patchright_stealth", 8192, { strict: true, img: false, support: S, sau: "bilibili" }),
  p("douyin", "Douyin", "https://douyin.com", "sfw_video", "patchright_stealth", 8192, { strict: true, img: false, short: true, support: S, sau: "douyin" }),
  p("kuaishou", "Kuaishou", "https://kuaishou.com", "sfw_video", "patchright_stealth", 8192, { strict: true, img: false, short: true, support: S, sau: "kuaishou" }),
  p("wechat_channels", "WeChat Channels", "https://channels.weixin.qq.com", "sfw_video", "patchright_stealth", 8192, { strict: true, img: false, short: true, support: S, sau: "tencent" }),
  p("baijiahao", "Baijiahao", "https://baijiahao.baidu.com", "sfw_video", "patchright_stealth", 8192, { strict: true, img: false, support: S, sau: "baijiahao" }),
  p("odysee", "Odysee (LBRY)", "https://odysee.com", "sfw_video", "chunked_stream", 15360, { img: false, short: true, support: N, connector: "lbry", notes: "Publishes through a local lbrynet daemon" }),
  p("rumble", "Rumble", "https://rumble.com", "sfw_video", "patchright_stealth", 15360, { img: false, short: true, support: A }),
  p("bitchute", "BitChute", "https://bitchute.com", "sfw_video", "patchright_stealth", 2048, { img: false, short: true, support: A }),
  p("vimeo", "Vimeo", "https://vimeo.com", "sfw_video", "chunked_stream", 5120, { img: false, support: N, connector: "vimeo" }),
  p("dailymotion", "Dailymotion", "https://dailymotion.com", "sfw_video", "chunked_stream", 4096, { img: false, support: N, connector: "dailymotion" }),
  p("twitch", "Twitch", "https://twitch.tv", "sfw_video", "patchright_stealth", 10240, { img: false }),
  p("kick", "Kick", "https://kick.com", "sfw_video", "patchright_stealth", 2048, { img: false }),
  p("peertube", "PeerTube", "https://joinpeertube.org", "sfw_video", "chunked_stream", 4096, { img: false, support: N, connector: "peertube" }),
  p("threespeak", "3Speak", "https://3speak.tv", "sfw_video", "chunked_stream", 4096, { img: false }),
  p("dtube", "DTube", "https://d.tube", "sfw_video", "chunked_stream", 4096, { img: false }),
  p("locals", "Locals", "https://locals.com", "sfw_video", "patchright_stealth", 15360, { support: A }),
  p("gabtv", "Gab TV", "https://tv.gab.com", "sfw_video", "patchright_stealth", 15360, { img: false, support: A }),
  p("brighteon", "Brighteon", "https://brighteon.com", "sfw_video", "patchright_stealth", 15360, { img: false, support: A }),
  p("banned_video", "Banned.video", "https://banned.video", "sfw_video", "patchright_stealth", 4096, { img: false }),
  p("niconico", "Niconico", "https://nicovideo.jp", "sfw_video", "patchright_stealth", 8192, { img: false, support: A }),
  p("rutube", "Rutube", "https://rutube.ru", "sfw_video", "patchright_stealth", 8192, { img: false, support: A }),
  p("vk_video", "VK Video", "https://vkvideo.ru", "sfw_video", "chunked_stream", 8192, { img: false, support: N, connector: "vk_video" }),

  // 18+ art boorus and art communities
  p("reddit_nsfw", "Reddit (NSFW)", "https://reddit.com", "nsfw_social", "rest_api", 100, { support: N, connector: "reddit", textOnly: true }),
  p("redgifs", "RedGIFs", "https://redgifs.com", "nsfw_social", "chunked_stream", 200, { support: A }),
  booru("e621", "e621", "https://e621.net", 100, { support: N, connector: "e621", transport: "rest_api" }),
  booru("rule34xxx", "Rule34.xxx", "https://rule34.xxx", 100),
  booru("gelbooru", "Gelbooru", "https://gelbooru.com", 100),
  booru("danbooru", "Danbooru", "https://danbooru.donmai.us", 100),
  booru("sankaku", "Sankaku Complex", "https://sankakucomplex.com", 50),
  booru("derpibooru", "Derpibooru", "https://derpibooru.org", 50),
  booru("furaffinity", "FurAffinity", "https://furaffinity.net", 10),
  booru("inkbunny", "Inkbunny", "https://inkbunny.net", 50, { support: N, connector: "inkbunny" }),
  booru("pixiv_r18", "Pixiv (R-18)", "https://pixiv.net", 32, { vid: false }),
  booru("newgrounds_adult", "Newgrounds (Adult)", "https://newgrounds.com", 100),
  booru("deviantart_mature", "DeviantArt (Mature)", "https://deviantart.com", 100, { vid: false, support: N, connector: "deviantart" }),
  booru("sofurry", "SoFurry", "https://sofurry.com", 100),
  booru("weasyl", "Weasyl", "https://weasyl.com", 100),
  booru("aryion", "Aryion", "https://aryion.com", 100),
  booru("hentai_foundry", "Hentai-Foundry", "https://hentai-foundry.com", 100, { vid: false }),
  p("baraag", "Baraag", "https://baraag.net", "nsfw_social", "rest_api", 100, { support: N, connector: "mastodon" }),
  p("pawoo", "Pawoo", "https://pawoo.net", "nsfw_social", "rest_api", 100, { support: N, connector: "mastodon" }),
  booru("pillowfort", "Pillowfort", "https://pillowfort.social", 100),
  p("nsfw_social", "NSFW.social", "https://nsfw.social", "nsfw_social", "rest_api", 100, { support: N, connector: "mastodon" }),

  // 18+ creator subscription walls and clip stores
  wall("subscribestar_adult", "SubscribeStar.Adult", "https://subscribestar.adult", 200),
  wall("patreon_18", "Patreon (18+)", "https://patreon.com", 200),
  wall("fansly_wall", "Fansly Timeline Wall", "https://fansly.com", 2048),
  wall("fansly_fyp", "Fansly FYP Short Feed", "https://fansly.com", 2048, { short: true }),
  wall("fansly_vault", "Fansly Vault/PPV Store", "https://fansly.com", 51200),
  wall("onlyfans_feed", "OnlyFans Feed", "https://onlyfans.com", 1024),
  wall("onlyfans_ppv", "OnlyFans PPV", "https://onlyfans.com", 1024),
  wall("loyalfans_timeline", "LoyalFans Timeline", "https://loyalfans.com", 2048),
  wall("loyalfans_store", "LoyalFans Video Store", "https://loyalfans.com", 10240, { img: false }),
  wall("manyvids_store", "ManyVids Video Store", "https://manyvids.com", 10240, { img: false }),
  wall("manyvids_club", "ManyVids MV Club", "https://manyvids.com", 10240),
  wall("clips4sale", "Clips4Sale", "https://clips4sale.com", 6144, { img: false }),
  wall("iwantclips", "IWantClips", "https://iwantclips.com", 6144, { img: false }),
  wall("fanvue", "Fanvue", "https://fanvue.com", 2048),
  wall("admireme", "AdmireMe.VIP", "https://admireme.vip", 2048),
  wall("justforfans", "JustFor.Fans (JFF)", "https://justfor.fans", 2048),
  wall("mym_fans", "MYM.fans (MYM)", "https://mym.fans", 2048),
  wall("maloum", "Maloum", "https://maloum.com", 4096),
  wall("boosty", "Boosty", "https://boosty.to", 4096, { adultTax: false }),
  wall("fancentro", "FanCentro", "https://fancentro.com", 4096),
  wall("slushy", "Slushy", "https://slushy.com", 2048, { short: true }),
  wall("bentbox", "BentBox", "https://bentbox.co", 2048),
  wall("kofi", "Ko-fi", "https://ko-fi.com", 512, { adultTax: false }),
  wall("pocketstars", "PocketStars", "https://pocketstars.com", 2048),
  wall("unlockd", "Unlockd", "https://unlockd.me", 2048),
  wall("fetlife", "FetLife", "https://fetlife.com", 500),
  wall("sexcom", "Sex.com Short Feed", "https://sex.com", 500, { short: true }),
  wall("modelhub", "Modelhub", "https://modelhub.com", 10240),
  wall("apclips", "APClips", "https://apclips.com", 6144, { img: false }),
  wall("indiebill", "IndieBill", "https://indiebill.com", 6144),
  wall("gumroad_18", "Gumroad (18+)", "https://gumroad.com", 16384),
  wall("itchio_18", "Itch.io (18+)", "https://itch.io", 16384, { transport: "chunked_stream", support: N, connector: "itch_butler", notes: "Pushes builds with the butler CLI" }),

  // 18+ video tube networks
  tube("pornhub_video", "Pornhub Long Video", "https://pornhub.com", 10240),
  tube("pornhub_shorties", "Pornhub Shorties (9:16)", "https://pornhub.com", 10240, { short: true }),
  tube("pornhub_photos", "Pornhub Model Community Photos", "https://pornhub.com", 20, { img: true, vid: false }),
  tube("xvideos", "XVideos / Sheer", "https://xvideos.com", 2048, { short: true }),
  tube("xhamster", "xHamster", "https://xhamster.com", 10240),
  tube("spankbang", "SpankBang", "https://spankbang.com", 4096, { short: true }),
  tube("eporner", "EPorner (4K/60fps)", "https://eporner.com", 5120),
  tube("redtube", "RedTube", "https://redtube.com", 10240),
  tube("youporn", "YouPorn", "https://youporn.com", 10240),
  tube("tube8", "Tube8", "https://tube8.com", 10240),
  tube("motherless", "Motherless", "https://motherless.com", 1024),
  tube("heavy_r", "Heavy-R", "https://heavy-r.com", 4096, { support: "registry_only" }),
  tube("beeg", "Beeg", "https://beeg.com", 4096, { support: "registry_only" }),
  tube("txxx", "TXXX", "https://txxx.com", 4096),
  tube("sunporno", "SunPorno", "https://sunporno.com", 1024),
  tube("xnxx", "XNXX", "https://xnxx.com", 4096),
  tube("thumbzilla", "Thumbzilla", "https://thumbzilla.com", 4096, { support: "registry_only" }),
  tube("vporn", "vPorn", "https://vporn.com", 4096),
  tube("hclips", "HClips", "https://hclips.com", 4096),
  tube("upornia", "Upornia", "https://upornia.com", 4096),
  tube("iwara", "Iwara.tv", "https://iwara.tv", 10240),
  tube("hanime", "Hanime", "https://hanime.tv", 10240, { archived: true, support: "registry_only", notes: "Studio-licensed catalog, no creator uploads" }),
  tube("rule34video", "Rule34Video", "https://rule34video.com", 10240),
  tube("sexlikereal", "SexLikeReal (VR)", "https://sexlikereal.com", 10240),
  tube("czechvr", "CzechVR", "https://czechvr.com", 10240, { archived: true, support: "registry_only", notes: "Studio site, no creator uploads" }),
];

export const PLATFORM_INDEX: ReadonlyMap<string, Platform> = new Map(MASTER_PLATFORMS.map((pl) => [pl.id, pl]));

export const ACTIVE_PLATFORMS: Platform[] = MASTER_PLATFORMS.filter((pl) => !pl.archived);
export const ARCHIVED_PLATFORMS: Platform[] = MASTER_PLATFORMS.filter((pl) => pl.archived);

export function getPlatform(id: string): Platform {
  const pl = PLATFORM_INDEX.get(id);
  if (!pl) throw new Error(`Unknown platform id: ${id}`);
  return pl;
}

export function platformsByQuadrant(q: Quadrant): Platform[] {
  return MASTER_PLATFORMS.filter((pl) => pl.quadrant === q);
}
