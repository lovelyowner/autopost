import asyncio
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse
from patchright.async_api import async_playwright

from .browser import launch_stealth_context
from .config import SPA_ORIGIN_PLATFORMS
from .session_vault import _safe_account_id, save_session

PLATFORM_LOGIN_URLS: Dict[str, str] = {
    "x": "https://x.com/i/flow/login",
    "discord": "https://discord.com/login",
    "fluxer": "https://web.fluxer.app/",
    "stoat": "https://stoat.chat/app",
    "revolt": "https://stoat.chat/app",
    "matrix": "https://app.element.io/#/login",
    "nostr": "https://primal.net/login",
    "bluesky": "https://bsky.app/",
    "mastodon": "https://mastodon.social/auth/sign_in",
    "instagram": "https://www.instagram.com/accounts/login/",
    "threads": "https://www.threads.net/login",
    "pinterest": "https://www.pinterest.com/login/",
    "youtube": "https://studio.youtube.com",
    "tiktok": "https://www.tiktok.com/login",
    "reddit": "https://www.reddit.com/login/",
    "reddit_nsfw": "https://www.reddit.com/login/",
    "twitch": "https://www.twitch.tv/login",
    "kick": "https://kick.com/",
    "rumble": "https://rumble.com/account/",
    "bitchute": "https://www.bitchute.com/accounts/login/",
    "odysee": "https://odysee.com/$/signin",
    "vimeo": "https://vimeo.com/log_in",
    "dailymotion": "https://www.dailymotion.com/signin",
    "bilibili": "https://passport.bilibili.com/login",
    "rednote": "https://creator.xiaohongshu.com/login",
    "xiaohongshu": "https://creator.xiaohongshu.com/login",
    "douyin": "https://creator.douyin.com/",
    "pornhub": "https://www.pornhub.com/login",
    "pornhub_video": "https://www.pornhub.com/login",
    "pornhub_shorties": "https://www.pornhub.com/login",
    "pornhub_photos": "https://www.pornhub.com/login",
    "xvideos": "https://www.xvideos.com/account",
    "spankbang": "https://spankbang.com/users/login",
    "xhamster": "https://xhamster.com/login",
    "eporner": "https://www.eporner.com/login/",
    "redtube": "https://www.redtube.com/login",
    "youporn": "https://www.youporn.com/login",
    "redgifs": "https://www.redgifs.com/signin",
    "fansly": "https://fansly.com",
    "fansly_wall": "https://fansly.com",
    "fansly_fyp": "https://fansly.com",
    "fansly_vault": "https://fansly.com",
    "onlyfans": "https://onlyfans.com",
    "onlyfans_feed": "https://onlyfans.com",
    "onlyfans_ppv": "https://onlyfans.com",
    "manyvids": "https://www.manyvids.com/Login/",
    "manyvids_store": "https://www.manyvids.com/Login/",
    "manyvids_club": "https://www.manyvids.com/Login/",
    "clips4sale": "https://www.clips4sale.com/studio/login",
    "iwantclips": "https://iwantclips.com/model/login",
    "mym": "https://creators.mym.fans/app/sign-in",
    "mym_fans": "https://creators.mym.fans/app/sign-in",
    "jff": "https://justfor.fans/",
    "justforfans": "https://justfor.fans/",
    "loyalfans": "https://www.loyalfans.com/login",
    "loyalfans_timeline": "https://www.loyalfans.com/login",
    "loyalfans_store": "https://www.loyalfans.com/login",
    "fanvue": "https://www.fanvue.com/signin",
    "admireme": "https://admireme.vip/login",
    "subscribestar_adult": "https://www.subscribestar.adult/login",
    "patreon_18": "https://www.patreon.com/login",
    "fetlife": "https://fetlife.com/login",
    "iwara": "https://www.iwara.tv/login",
    "maloum": "https://www.maloum.com/en/login",
    "boosty": "https://boosty.to/",
    "fancentro": "https://fancentro.com/login",
    "slushy": "https://www.slushy.com/login",
    "apclips": "https://apclips.com/models/login",
    "modelhub": "https://www.modelhub.com/login",
    "bentbox": "https://bentbox.co/signin",
    "kofi": "https://ko-fi.com/Account/Login",
    "motherless": "https://motherless.com/login",
    "locals": "https://locals.com/login",
}

STRONG_AUTH_COOKIES = {
    "auth_token",
    "sessionid",
    "session_id",
    "sessionid_ss",
    "ds_user_id",
    "sessdata",
    "bili_jct",
    "web_session",
    "sapisid",
    "__secure-3psid",
    "__secure-1psid",
    "reddit_session",
    "token_v2",
    "auth-token",
    "auth_id",
    "il",
    "jwt",
    "connect.sid",
    "token",
    "sess",
    "f_s_c",
    "mv_session",
}

PLATFORM_AUTH_RULES: Dict[str, Dict[str, Any]] = {
    "x": {
        "domains": ("x.com", "twitter.com"),
        "cookies": {"auth_token"},
    },
    "instagram": {
        "domains": ("instagram.com",),
        "cookies": {"sessionid"},
    },
    "threads": {
        "domains": ("threads.net", "instagram.com"),
        "cookies": {"sessionid"},
    },
    "pinterest": {
        "domains": ("pinterest.com",),
        "cookies": {"_pinterest_sess"},
    },
    "youtube": {
        "domains": ("youtube.com", "google.com"),
        "cookies": {"sapisid", "__secure-3psid", "sid"},
        "disallow_url_hosts": ("accounts.google.com",),
    },
    "tiktok": {
        "domains": ("tiktok.com",),
        "cookies": {"sessionid", "sessionid_ss", "sid_tt"},
    },
    "rumble": {
        "domains": ("rumble.com",),
        "cookies": {"u_s", "r_s", "auth_token"},
    },
    "bitchute": {
        "domains": ("bitchute.com",),
        "cookies": {"sessionid", "bitchute_session", "access_token"},
    },
    "odysee": {
        "domains": ("odysee.com",),
        "cookies": {"auth_token"},
    },
    "vimeo": {
        "domains": ("vimeo.com",),
        "cookies": {"vimeo"},
    },
    "dailymotion": {
        "domains": ("dailymotion.com",),
        "cookies": {"sid", "access_token"},
    },
    "kick": {
        "domains": ("kick.com",),
        "cookies": {"session_token"},
    },
    "bilibili": {
        "domains": ("bilibili.com",),
        "cookies": {"sessdata", "bili_jct"},
    },
    "rednote": {
        "domains": ("xiaohongshu.com",),
        "cookies": {"web_session"},
    },
    "xiaohongshu": {
        "domains": ("xiaohongshu.com",),
        "cookies": {"web_session"},
    },
    "douyin": {
        "domains": ("douyin.com",),
        "cookies": {"sessionid", "sessionid_ss", "sid_tt"},
    },
    "pornhub": {
        "domains": ("pornhub.com",),
        "cookies": {"il", "at"},
    },
    "pornhub_video": {
        "domains": ("pornhub.com",),
        "cookies": {"il", "at"},
    },
    "pornhub_shorties": {
        "domains": ("pornhub.com",),
        "cookies": {"il", "at"},
    },
    "pornhub_photos": {
        "domains": ("pornhub.com",),
        "cookies": {"il", "at"},
    },
    "xvideos": {
        "domains": ("xvideos.com",),
        "cookies": {"session_token", "auth_token", "sessionid"},
    },
    "xhamster": {
        "domains": ("xhamster.com",),
        "cookies": {"uh", "uid", "auth_token"},
    },
    "spankbang": {
        "domains": ("spankbang.com",),
        "cookies": {"sb_session", "user_session", "auth_token"},
    },
    "eporner": {
        "domains": ("eporner.com",),
        "cookies": {"ep_usr", "ep_sec"},
    },
    "redtube": {
        "domains": ("redtube.com",),
        "cookies": {"il", "at", "user_id"},
    },
    "youporn": {
        "domains": ("youporn.com",),
        "cookies": {"il", "at", "user_id"},
    },
    "redgifs": {
        "domains": ("redgifs.com",),
        "cookies": {"rg_token", "auth_token"},
    },
    "fansly": {
        "domains": ("fansly.com",),
        "cookies": {"f_s_c"},
    },
    "fansly_wall": {
        "domains": ("fansly.com",),
        "cookies": {"f_s_c"},
    },
    "fansly_fyp": {
        "domains": ("fansly.com",),
        "cookies": {"f_s_c"},
    },
    "fansly_vault": {
        "domains": ("fansly.com",),
        "cookies": {"f_s_c"},
    },
    "onlyfans": {
        "domains": ("onlyfans.com",),
        "cookies": {"auth_id"},
    },
    "onlyfans_feed": {
        "domains": ("onlyfans.com",),
        "cookies": {"auth_id"},
    },
    "onlyfans_ppv": {
        "domains": ("onlyfans.com",),
        "cookies": {"auth_id"},
    },
    "manyvids": {
        "domains": ("manyvids.com",),
        "cookies": {"mv_session", "member_id"},
    },
    "manyvids_store": {
        "domains": ("manyvids.com",),
        "cookies": {"mv_session", "member_id"},
    },
    "manyvids_club": {
        "domains": ("manyvids.com",),
        "cookies": {"mv_session", "member_id"},
    },
    "clips4sale": {
        "domains": ("clips4sale.com",),
        "cookies": {"c4s_studio_session", "auth_token"},
    },
    "iwantclips": {
        "domains": ("iwantclips.com",),
        "cookies": {"iwc_session", "auth_token"},
    },
    "mym": {
        "domains": ("mym.fans",),
        "cookies": {"mym_session", "auth_token"},
    },
    "mym_fans": {
        "domains": ("mym.fans",),
        "cookies": {"mym_session", "auth_token"},
    },
    "jff": {
        "domains": ("justfor.fans",),
        "cookies": {"userhash4", "jff_session", "auth_token"},
    },
    "justforfans": {
        "domains": ("justfor.fans",),
        "cookies": {"userhash4", "jff_session", "auth_token"},
    },
    "loyalfans": {
        "domains": ("loyalfans.com",),
        "cookies": {"lf_session", "auth_token", "token"},
    },
    "loyalfans_timeline": {
        "domains": ("loyalfans.com",),
        "cookies": {"lf_session", "auth_token", "token"},
    },
    "loyalfans_store": {
        "domains": ("loyalfans.com",),
        "cookies": {"lf_session", "auth_token", "token"},
    },
    "fanvue": {
        "domains": ("fanvue.com",),
        "cookies": {"fv_session", "__secure-next-auth.session-token", "auth_token"},
    },
    "admireme": {
        "domains": ("admireme.vip",),
        "cookies": {"admireme_session", "auth_token"},
    },
    "subscribestar_adult": {
        "domains": ("subscribestar.adult",),
        "cookies": {"_subscribestar_session", "auth_token"},
    },
    "patreon_18": {
        "domains": ("patreon.com",),
        "cookies": {"session_id"},
    },
    "fetlife": {
        "domains": ("fetlife.com",),
        "cookies": {"_fl_sessionid", "remember_user_token"},
    },
    "reddit": {
        "domains": ("reddit.com",),
        "cookies": {"reddit_session", "token_v2"},
    },
    "reddit_nsfw": {
        "domains": ("reddit.com",),
        "cookies": {"reddit_session", "token_v2"},
    },
    "twitch": {
        "domains": ("twitch.tv",),
        "cookies": {"auth-token"},
    },
    "maloum": {
        "domains": ("maloum.com",),
        "cookies": {"maloum_session", "auth_token", "session", "token"},
    },
    "boosty": {
        "domains": ("boosty.to",),
        "cookies": {"auth", "access_token", "_clientId"},
    },
    "fancentro": {
        "domains": ("fancentro.com",),
        "cookies": {"fc_session", "auth_token", "sess"},
    },
    "slushy": {
        "domains": ("slushy.com",),
        "cookies": {"slushy_session", "auth_token", "token"},
    },
    "apclips": {
        "domains": ("apclips.com",),
        "cookies": {"apclips_session", "PHPSESSID", "auth_token"},
    },
    "modelhub": {
        "domains": ("modelhub.com",),
        "cookies": {"il", "at", "mh_session"},
    },
    "bentbox": {
        "domains": ("bentbox.co",),
        "cookies": {"bentbox_session", "connect.sid", "token"},
    },
    "kofi": {
        "domains": ("ko-fi.com",),
        "cookies": {".AspNetCore.Identity.Application", "kofi_session"},
    },
    "motherless": {
        "domains": ("motherless.com",),
        "cookies": {"_auth", "ml_session", "PHPSESSID"},
    },
    "iwara": {
        "domains": ("iwara.tv",),
        "cookies": {"token", "auth_token", "session"},
    },
    "locals": {
        "domains": ("locals.com",),
        "cookies": {"locals_session", "auth_token", "PHPSESSID"},
    },
    "discord": {
        "domains": ("discord.com",),
        "cookies": {"__dcfduid", "__sdcfduid", "cf_clearance", "locale"},
    },
    "fluxer": {
        "domains": ("fluxer.app", "web.fluxer.app", "fluxer.com"),
        "cookies": {"session", "auth_token", "token", "connect.sid", "fluxer_session"},
    },
    "stoat": {
        "domains": ("stoat.chat", "revolt.chat"),
        "cookies": {"session", "token", "auth_token", "cf_clearance"},
    },
    "revolt": {
        "domains": ("stoat.chat", "revolt.chat"),
        "cookies": {"session", "token", "auth_token", "cf_clearance"},
    },
    "matrix": {
        "domains": ("element.io", "matrix.org"),
        "cookies": {"session", "auth_token", "matrix_session"},
    },
    "nostr": {
        "domains": ("primal.net", "snort.social", "coracle.social"),
        "cookies": {"session", "token", "primal_session"},
    },
    "bluesky": {
        "domains": ("bsky.app", "bsky.social"),
        "cookies": {"bsky_session", "session", "auth_token"},
    },
    "mastodon": {
        "domains": ("mastodon.social", "mstdn.social", "fosstodon.org"),
        "cookies": {"_mastodon_session", "_session_id", "remember_user_token"},
    },
}

_ACTIVE_LOGIN_EVENTS: Dict[str, asyncio.Event] = {}


def request_login_completion(account_id: str) -> bool:
    """Signal an active interactive login session to capture cookies and finish now."""
    event = _ACTIVE_LOGIN_EVENTS.get(account_id)
    if event is None:
        return False
    event.set()
    return True


def _left_login_page(initial_url: str, current_url: str) -> bool:
    if not current_url or current_url == "about:blank":
        return False
    init_parsed = urlparse(initial_url)
    curr_parsed = urlparse(current_url)
    init_path = (init_parsed.path or "/").lower().rstrip("/")
    curr_path = (curr_parsed.path or "/").lower().rstrip("/")
    login_markers = ("/login", "/accounts/login", "/i/flow/login", "/users/login")
    if any(marker in init_path for marker in login_markers):
        return (
            not any(marker in curr_path for marker in login_markers)
            and "accounts.google.com" not in curr_parsed.netloc.lower()
            and curr_parsed.scheme in ("http", "https")
        )
    return False


def _domain_matches(cookie_domain: str, target_domains: tuple) -> bool:
    cleaned = str(cookie_domain or "").lower().lstrip(".")
    if not cleaned:
        return False
    for td in target_domains:
        td_clean = td.lower().lstrip(".")
        if cleaned == td_clean or cleaned.endswith("." + td_clean):
            return True
    return False


def _extract_platform_auth_tokens(
    cookies: List[Dict[str, Any]],
    platform: str,
    initial_url: str,
    current_url: str,
) -> set:
    if not cookies:
        return set()

    rule = PLATFORM_AUTH_RULES.get(platform)
    curr_host = (urlparse(current_url or "").netloc or "").lower()
    if rule:
        disallow_hosts = rule.get("disallow_url_hosts", ())
        if any(h in curr_host for h in disallow_hosts):
            return set()
        target_domains = rule["domains"]
        required_names = {n.lower() for n in rule["cookies"]}
    else:
        init_host = (urlparse(initial_url or "").netloc or "").lower().lstrip("www.")
        target_domains = (init_host,) if init_host else ()
        required_names = STRONG_AUTH_COOKIES

    matched = set()
    for c in cookies:
        if not isinstance(c, dict):
            continue
        name = str(c.get("name", "")).lower()
        value = str(c.get("value", "")).strip()
        domain = str(c.get("domain", ""))
        if not value or name not in required_names:
            continue
        if target_domains and not _domain_matches(domain, target_domains):
            continue
        matched.add((domain.lower().lstrip("."), name, value))
    return matched


def _is_authenticated_snapshot(
    cookies: List[Dict[str, Any]],
    initial_url: str,
    current_url: str,
    platform: str = "",
    baseline_tokens: Optional[set] = None,
) -> bool:
    tokens = _extract_platform_auth_tokens(cookies, platform, initial_url, current_url)
    if not tokens:
        return False
    if baseline_tokens is not None:
        return bool(tokens - baseline_tokens)
    return True


async def _get_context_cookies(context: Any) -> List[Dict[str, Any]]:
    """Read cookies directly from the browser context without triggering Patchright's
    storage_state() -> visitOrigins() temporary tab open/close cycle."""
    if hasattr(context, "cookies") and callable(context.cookies):
        cookies = await context.cookies()
        if isinstance(cookies, list):
            return cookies
    if hasattr(context, "storage_state") and callable(context.storage_state):
        snapshot = await context.storage_state()
        if isinstance(snapshot, dict):
            return snapshot.get("cookies", [])
    return []


async def launch_interactive_login(
    account_id: str,
    platform: str,
    timeout_sec: int = 180,
    headless: bool = False,
) -> Dict[str, Any]:
    _safe_account_id(account_id)
    url = PLATFORM_LOGIN_URLS.get(platform, f"https://{platform}.com/login")
    done_event = asyncio.Event()
    _ACTIVE_LOGIN_EVENTS[account_id] = done_event

    async with async_playwright() as p:
        browser, context = await launch_stealth_context(
            p,
            account_id=account_id,
            headless=headless,
        )
        last_state: Dict[str, Any] = {"cookies": [], "origins": []}
        last_url = url
        logged_in = False
        manual_completed = False
        window_closed = False

        try:
            page = await context.new_page()
            try:
                await page.goto(url, wait_until="domcontentloaded")
            except Exception:
                # SPA login flows (e.g. x.com/i/flow/login) frequently trigger an immediate
                # client-side redirect that interrupts wait_until="domcontentloaded".
                if page.is_closed():
                    window_closed = True

            try:
                initial_cookies = await _get_context_cookies(context)
                if initial_cookies:
                    last_state = {"cookies": initial_cookies, "origins": []}
                baseline_tokens = _extract_platform_auth_tokens(
                    initial_cookies,
                    platform,
                    url,
                    page.url or url,
                )
            except Exception:
                baseline_tokens = set()

            loop = asyncio.get_running_loop()
            start_time = loop.time()

            while (loop.time() - start_time) < timeout_sec:
                if done_event.is_set():
                    manual_completed = True
                    break

                try:
                    if page.is_closed():
                        window_closed = True
                        break
                    last_url = page.url or last_url
                    cookies = await _get_context_cookies(context)
                    if cookies:
                        last_state = {"cookies": cookies, "origins": []}
                    if _is_authenticated_snapshot(
                        cookies,
                        url,
                        last_url,
                        platform=platform,
                        baseline_tokens=baseline_tokens,
                    ):
                        logged_in = True
                        break
                except Exception:
                    window_closed = True
                    break

                try:
                    await asyncio.wait_for(done_event.wait(), timeout=1.0)
                    manual_completed = True
                    break
                except asyncio.TimeoutError:
                    pass

            if manual_completed or logged_in:
                try:
                    final_cookies = await _get_context_cookies(context)
                    if final_cookies:
                        last_state = {"cookies": final_cookies, "origins": []}
                    if (
                        (platform in SPA_ORIGIN_PLATFORMS or not final_cookies)
                        and hasattr(context, "storage_state")
                        and callable(context.storage_state)
                    ):
                        full_state = await context.storage_state()
                        if isinstance(full_state, dict):
                            last_state = full_state
                except Exception:
                    pass

            cookies_count = len(last_state.get("cookies", []))
            origins_count = len(last_state.get("origins", []))
            auth_detected = logged_in or _is_authenticated_snapshot(
                last_state.get("cookies", []),
                url,
                last_url,
                platform=platform,
                baseline_tokens=baseline_tokens,
            )

            if manual_completed and (cookies_count > 0 or origins_count > 0):
                state_path = save_session(
                    account_id,
                    platform,
                    last_state,
                    metadata={"import_method": "interactive_finish_button", "cookie_count": cookies_count},
                )
                return {
                    "success": True,
                    "account_id": account_id,
                    "platform": platform,
                    "cookie_count": cookies_count,
                    "state_path": str(state_path),
                    "status": "authenticated" if auth_detected else "saved_manually",
                }

            if auth_detected:
                state_path = save_session(
                    account_id,
                    platform,
                    last_state,
                    metadata={"import_method": "interactive_browser", "cookie_count": cookies_count},
                )
                return {
                    "success": True,
                    "account_id": account_id,
                    "platform": platform,
                    "cookie_count": cookies_count,
                    "state_path": str(state_path),
                    "status": "authenticated",
                }

            if window_closed and (cookies_count > 2 or origins_count > 0):
                state_path = save_session(
                    account_id,
                    platform,
                    last_state,
                    metadata={"import_method": "interactive_window_close", "cookie_count": cookies_count},
                )
                return {
                    "success": True,
                    "account_id": account_id,
                    "platform": platform,
                    "cookie_count": cookies_count,
                    "state_path": str(state_path),
                    "status": "saved_on_close",
                }

            if cookies_count > 0 and not window_closed:
                state_path = save_session(
                    account_id,
                    platform,
                    last_state,
                    metadata={"import_method": "interactive_timeout", "cookie_count": cookies_count},
                )
                return {
                    "success": False,
                    "account_id": account_id,
                    "platform": platform,
                    "cookie_count": cookies_count,
                    "state_path": str(state_path),
                    "status": "timeout_or_pending",
                }

            return {
                "success": False,
                "account_id": account_id,
                "platform": platform,
                "cookie_count": cookies_count,
                "state_path": None,
                "status": "closed_before_login" if window_closed else "timeout_or_pending",
            }
        finally:
            _ACTIVE_LOGIN_EVENTS.pop(account_id, None)
            try:
                await browser.close()
            except Exception:
                pass
