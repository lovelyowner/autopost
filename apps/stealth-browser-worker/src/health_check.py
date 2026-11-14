import time
from typing import Any, Dict, Optional
from patchright.async_api import async_playwright

from .browser import launch_stealth_context
from .session_vault import load_cookies, load_storage_state, persist_refreshed_context_state

PLATFORM_HEALTH_URLS = {
    "x": "https://x.com/home",
    "instagram": "https://www.instagram.com/",
    "threads": "https://www.threads.net/",
    "pinterest": "https://www.pinterest.com/",
    "youtube": "https://studio.youtube.com",
    "tiktok": "https://www.tiktok.com/creator-center/upload",
    "rumble": "https://rumble.com/upload.php",
    "bitchute": "https://www.bitchute.com/profile/",
    "odysee": "https://odysee.com/$/upload",
    "vimeo": "https://vimeo.com/home",
    "dailymotion": "https://www.dailymotion.com/partner",
    "twitch": "https://dashboard.twitch.tv/",
    "kick": "https://kick.com/dashboard",
    "bilibili": "https://member.bilibili.com/platform/home",
    "xiaohongshu": "https://creator.xiaohongshu.com/creator/home",
    "rednote": "https://creator.xiaohongshu.com/creator/home",
    "douyin": "https://creator.douyin.com",
    "kuaishou": "https://cp.kuaishou.com",
    "pornhub_video": "https://www.pornhub.com/model/dashboard",
    "pornhub_shorties": "https://www.pornhub.com/model/dashboard",
    "pornhub_photos": "https://www.pornhub.com/model/dashboard",
    "xvideos": "https://www.xvideos.com/account",
    "xhamster": "https://xhamster.com/my/uploads",
    "spankbang": "https://spankbang.com/users/uploads",
    "eporner": "https://www.eporner.com/upload_do/",
    "redtube": "https://www.redtube.com/upload",
    "youporn": "https://www.youporn.com/upload",
    "redgifs": "https://www.redgifs.com/create",
    "fansly_wall": "https://fansly.com",
    "fansly_fyp": "https://fansly.com",
    "fansly_vault": "https://fansly.com",
    "onlyfans_feed": "https://onlyfans.com",
    "onlyfans_ppv": "https://onlyfans.com",
    "manyvids_store": "https://www.manyvids.com/Profile",
    "manyvids_club": "https://www.manyvids.com/Profile",
    "clips4sale": "https://www.clips4sale.com/studio",
    "iwantclips": "https://iwantclips.com/model/dashboard",
    "mym_fans": "https://creators.mym.fans/app/home",
    "justforfans": "https://justfor.fans/home",
    "loyalfans_timeline": "https://www.loyalfans.com/feed",
    "loyalfans_store": "https://www.loyalfans.com/video-store",
    "fanvue": "https://www.fanvue.com/home",
    "admireme": "https://admireme.vip/dashboard",
    "subscribestar_adult": "https://www.subscribestar.adult/",
    "patreon_18": "https://www.patreon.com/home",
    "fetlife": "https://fetlife.com/home",
}

def check_cookies_expiry(cookies: list[Dict[str, Any]]) -> tuple[bool, Optional[str]]:
    if not cookies:
        return False, "No cookies found in vault."
    now = time.time()
    valid_cookies = 0
    for c in cookies:
        expires = c.get("expires", -1)
        if expires == -1 or expires > now:
            valid_cookies += 1
    if valid_cookies == 0:
        return False, "All cookies have expired."
    return True, None

async def verify_session_health(account_id: str, platform: str) -> Dict[str, Any]:
    storage_state = load_storage_state(account_id)
    if not storage_state:
        return {
            "account_id": account_id,
            "platform": platform,
            "healthy": False,
            "reason": "Missing storage state file. Interactive login required.",
        }

    cookies = storage_state.get("cookies", [])
    valid, reason = check_cookies_expiry(cookies)
    if not valid:
        return {
            "account_id": account_id,
            "platform": platform,
            "healthy": False,
            "reason": reason,
        }

    # For offline or quick check, if no specific URL or network is disabled
    check_url = PLATFORM_HEALTH_URLS.get(platform)
    if not check_url:
        return {
            "account_id": account_id,
            "platform": platform,
            "healthy": True,
            "reason": f"Active session with {len(cookies)} cookies found.",
        }

    # Optional live browser verification
    try:
        async with async_playwright() as p:
            browser, context = await launch_stealth_context(p, account_id=account_id, headless=True)
            try:
                page = await context.new_page()
                resp = await page.goto(check_url, timeout=15000, wait_until="domcontentloaded")
                curr_url = page.url
                # Basic redirection to login check
                if "login" in curr_url or (resp and resp.status in (401, 403)):
                    return {
                        "account_id": account_id,
                        "platform": platform,
                        "healthy": False,
                        "reason": f"Session redirected to login page: {curr_url}",
                    }
                await persist_refreshed_context_state(context, account_id, platform)
                return {
                    "account_id": account_id,
                    "platform": platform,
                    "healthy": True,
                    "reason": "Live session check verified and rotating cookies refreshed.",
                }
            finally:
                await browser.close()
    except Exception as e:
        # If network error or timeout during live check, fall back to cookie timestamp validity
        return {
            "account_id": account_id,
            "platform": platform,
            "healthy": True,
            "reason": f"Cookie structure valid ({len(cookies)} cookies). Live check skipped: {e}",
        }
