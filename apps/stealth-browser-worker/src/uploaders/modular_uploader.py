import json
import os
import random
from pathlib import Path
from typing import Any, Dict, List, Optional
from patchright.async_api import async_playwright

from ..browser import launch_stealth_context
from ..config import reload_root_env_if_changed
from ..session_vault import load_storage_state, persist_refreshed_context_state
from .base import BaseUploader, UploadJobPayload

FAILURES_DIR = Path(__file__).resolve().parents[4] / "data" / "failures"
PREVIEWS_DIR = Path(__file__).resolve().parents[4] / "data" / "previews"
SELECTOR_OVERRIDES_PATH = Path(__file__).resolve().parents[4] / "config" / "selector-overrides.json"

RESILIENT_UPLOAD_SELECTORS = [
    "input[type='file']",
    "[data-testid='upload-input']",
    "[data-testid='file-input']",
    ".upload-input-file",
    "input[accept*='video']",
    "input[accept*='image']",
]

PLATFORM_UPLOAD_RECIPES: Dict[str, Dict[str, Any]] = {
    "pornhub_video": {
        "upload_url": "https://www.pornhub.com/upload",
        "url_prefix": "https://www.pornhub.com/view_video.php?viewkey=ph_",
        "title_selectors": ["input[name='title']", "#title", "input[placeholder*='Title']"],
        "description_selectors": ["textarea[name='description']", "#description"],
        "tag_selectors": ["input[name='tags']", "#tags", "input[placeholder*='tag']"],
        "compliance_selectors": ["input[name*='2257']", "#confirm_2257", "input[type='checkbox'][name*='agree']"],
        "submit_selectors": ["button[type='submit']", "#publishBtn", "button:has-text('Publish')"],
    },
    "xvideos": {
        "upload_url": "https://www.xvideos.com/account/uploads/new",
        "url_prefix": "https://www.xvideos.com/video.",
        "title_selectors": ["input[name='title']", "#upload_title"],
        "description_selectors": ["textarea[name='description']"],
        "tag_selectors": ["input[name='tags']"],
        "compliance_selectors": ["input[name*='confirm']", "input[name*='age']"],
        "submit_selectors": ["button[type='submit']", "input[type='submit']"],
    },
    "manyvids_store": {
        "upload_url": "https://www.manyvids.com/Upload-video/",
        "url_prefix": "https://www.manyvids.com/Video/",
        "title_selectors": ["input[name='title']", "input[placeholder*='Video title']"],
        "description_selectors": ["textarea[name='description']"],
        "tag_selectors": ["input[name='tags']"],
        "compliance_selectors": ["input[name*='2257']", "input[name*='consent']"],
        "submit_selectors": ["button:has-text('Save')", "button[type='submit']"],
    },
    "fansly_wall": {
        "upload_url": "https://fansly.com/home",
        "url_prefix": "https://fansly.com/post/",
        "title_selectors": [],
        "description_selectors": ["textarea", "[contenteditable='true']"],
        "tag_selectors": [],
        "compliance_selectors": [],
        "submit_selectors": ["button:has-text('Post')", "[data-testid='post-submit']"],
    },
    "onlyfans_feed": {
        "upload_url": "https://onlyfans.com/posts/create",
        "url_prefix": "https://onlyfans.com/",
        "title_selectors": [],
        "description_selectors": ["textarea[name='text']", "[data-testid='post-editor'] [contenteditable='true']"],
        "tag_selectors": [],
        "compliance_selectors": [],
        "submit_selectors": ["button[at-attr='submit_post']", "button:has-text('Post')"],
    },
    "x": {
        "upload_url": "https://x.com/compose/post",
        "url_prefix": "https://x.com/i/status/",
        "title_selectors": [],
        "description_selectors": ["[data-testid='tweetTextarea_0']", "[contenteditable='true']"],
        "tag_selectors": [],
        "compliance_selectors": [],
        "submit_selectors": ["[data-testid='tweetButton']", "[data-testid='tweetButtonInline']"],
    },
    "instagram": {
        "upload_url": "https://www.instagram.com/",
        "url_prefix": "https://www.instagram.com/p/",
        "title_selectors": [],
        "description_selectors": ["textarea[aria-label*='caption']", "div[aria-label*='caption']"],
        "tag_selectors": [],
        "compliance_selectors": [],
        "submit_selectors": ["button:has-text('Share')"],
    },
    "bilibili": {
        "upload_url": "https://member.bilibili.com/platform/upload/video/frame",
        "url_prefix": "https://www.bilibili.com/video/BV",
        "title_selectors": ["input[placeholder*='标题']", "input.input-val"],
        "description_selectors": ["div.ql-editor", "textarea"],
        "tag_selectors": ["input[placeholder*='标签']"],
        "compliance_selectors": [],
        "submit_selectors": ["span:has-text('立即投稿')", "button:has-text('Submit')"],
    },
    "rednote": {
        "upload_url": "https://creator.xiaohongshu.com/publish/publish",
        "url_prefix": "https://www.xiaohongshu.com/explore/",
        "title_selectors": ["input[placeholder*='填写标题']", "input.el-input__inner"],
        "description_selectors": ["#post-textarea", "[contenteditable='true']"],
        "tag_selectors": [],
        "compliance_selectors": [],
        "submit_selectors": ["button:has-text('发布')", "button.publishBtn"],
    },
    "douyin": {
        "upload_url": "https://creator.douyin.com/creator-micro/content/upload",
        "url_prefix": "https://www.douyin.com/video/",
        "title_selectors": ["input[placeholder*='标题']"],
        "description_selectors": [".zone-container", "[contenteditable='true']"],
        "tag_selectors": [],
        "compliance_selectors": [],
        "submit_selectors": ["button:has-text('发布')"],
    },
    "rumble": {
        "upload_url": "https://rumble.com/upload.php",
        "url_prefix": "https://rumble.com/v",
        "title_selectors": ["input[name='title']", "#title"],
        "description_selectors": ["textarea[name='description']", "#description"],
        "tag_selectors": ["input[name='tags']"],
        "compliance_selectors": ["input[type='checkbox'][name*='rights']"],
        "submit_selectors": ["button[type='submit']", "#submitForm"],
    },
    "odysee": {
        "upload_url": "https://odysee.com/$/upload",
        "url_prefix": "https://odysee.com/@creator:",
        "title_selectors": ["input[name='content_title']", "#content_title"],
        "description_selectors": ["textarea[name='content_description']"],
        "tag_selectors": ["input[placeholder*='Add tag']"],
        "compliance_selectors": [],
        "submit_selectors": ["button[aria-label='Upload']", "button:has-text('Upload')"],
    },
    "youtube": {
        "upload_url": "https://studio.youtube.com",
        "url_prefix": "https://www.youtube.com/watch?v=",
        "title_selectors": ["#textbox[aria-label*='title']", "ytcp-social-suggestions-textbox#title-textarea #textbox"],
        "description_selectors": ["ytcp-social-suggestions-textbox#description-textarea #textbox"],
        "tag_selectors": ["input[aria-label='Tags']"],
        "compliance_selectors": [],
        "submit_selectors": ["#done-button", "ytcp-button#done-button"],
    },
    "tiktok": {
        "upload_url": "https://www.tiktok.com/creator-center/upload",
        "url_prefix": "https://www.tiktok.com/@creator/video/",
        "title_selectors": [],
        "description_selectors": ["div[contenteditable='true']", "[data-contents='true']"],
        "tag_selectors": [],
        "compliance_selectors": [],
        "submit_selectors": ["button:has-text('Post')", "button:has-text('Publish')"],
    },
    "bitchute": {
        "upload_url": "https://www.bitchute.com/myupload/",
        "url_prefix": "https://www.bitchute.com/video/",
        "title_selectors": ["input[name='title']", "#title", "input[placeholder*='title']"],
        "description_selectors": ["textarea[name='description']", "#description"],
        "tag_selectors": ["input[name='hashtags']", "input[placeholder*='tag']"],
        "compliance_selectors": ["input[type='checkbox'][name*='terms']"],
        "submit_selectors": ["button[type='submit']", "button:has-text('Publish')", "button:has-text('Upload')"],
    },
    "manyvids_club": {
        "upload_url": "https://www.manyvids.com/Create-Post/",
        "url_prefix": "https://www.manyvids.com/Feed/",
        "title_selectors": ["input[name='title']"],
        "description_selectors": ["textarea[name='description']", "textarea", "[contenteditable='true']"],
        "tag_selectors": ["input[name='tags']"],
        "compliance_selectors": ["input[name*='2257']", "input[name*='consent']"],
        "submit_selectors": ["button:has-text('Post')", "button[type='submit']"],
    },
    "onlyfans_ppv": {
        "upload_url": "https://onlyfans.com/posts/create",
        "url_prefix": "https://onlyfans.com/",
        "title_selectors": [],
        "description_selectors": ["textarea[name='text']", "[data-testid='post-editor'] [contenteditable='true']"],
        "tag_selectors": [],
        "compliance_selectors": [],
        "submit_selectors": ["button[at-attr='submit_post']", "button:has-text('Post')"],
    },
    "fansly_fyp": {
        "upload_url": "https://fansly.com/home",
        "url_prefix": "https://fansly.com/post/",
        "title_selectors": [],
        "description_selectors": ["textarea", "[contenteditable='true']"],
        "tag_selectors": [],
        "compliance_selectors": [],
        "submit_selectors": ["button:has-text('Post')", "[data-testid='post-submit']"],
    },
    "fansly_vault": {
        "upload_url": "https://fansly.com/home",
        "url_prefix": "https://fansly.com/post/",
        "title_selectors": [],
        "description_selectors": ["textarea", "[contenteditable='true']"],
        "tag_selectors": [],
        "compliance_selectors": [],
        "submit_selectors": ["button:has-text('Post')", "[data-testid='post-submit']"],
    },
    "clips4sale": {
        "upload_url": "https://www.clips4sale.com/studio/clips/add",
        "url_prefix": "https://www.clips4sale.com/studio/",
        "title_selectors": ["input[name='title']", "#title", "input[placeholder*='Title']"],
        "description_selectors": ["textarea[name='description']", "#description"],
        "tag_selectors": ["input[name='keywords']", "input[name='tags']"],
        "compliance_selectors": ["input[type='checkbox'][name*='2257']", "input[type='checkbox'][name*='certify']"],
        "submit_selectors": ["button[type='submit']", "button:has-text('Save')", "button:has-text('Publish')"],
    },
    "iwantclips": {
        "upload_url": "https://iwantclips.com/model/content/upload",
        "url_prefix": "https://iwantclips.com/store/",
        "title_selectors": ["input[name='title']", "#title"],
        "description_selectors": ["textarea[name='description']", "#description"],
        "tag_selectors": ["input[name='tags']"],
        "compliance_selectors": ["input[type='checkbox'][name*='2257']", "input[type='checkbox'][name*='agree']"],
        "submit_selectors": ["button[type='submit']", "button:has-text('Publish')"],
    },
    "mym_fans": {
        "upload_url": "https://creators.mym.fans/app/publish",
        "url_prefix": "https://mym.fans/",
        "title_selectors": [],
        "description_selectors": ["textarea", "[contenteditable='true']"],
        "tag_selectors": [],
        "compliance_selectors": ["input[type='checkbox']"],
        "submit_selectors": ["button[type='submit']", "button:has-text('Publish')", "button:has-text('Publier')"],
    },
    "justforfans": {
        "upload_url": "https://justfor.fans/home",
        "url_prefix": "https://justfor.fans/post/",
        "title_selectors": [],
        "description_selectors": ["textarea[name='PostText']", "textarea", "[contenteditable='true']"],
        "tag_selectors": [],
        "compliance_selectors": ["input[type='checkbox'][name*='terms']"],
        "submit_selectors": ["button[type='submit']", "button:has-text('Post')", "#postSubmitButton"],
    },
    "loyalfans_timeline": {
        "upload_url": "https://www.loyalfans.com/feed",
        "url_prefix": "https://www.loyalfans.com/post/",
        "title_selectors": [],
        "description_selectors": ["textarea", "[contenteditable='true']"],
        "tag_selectors": [],
        "compliance_selectors": [],
        "submit_selectors": ["button:has-text('Post')", "button[type='submit']"],
    },
    "loyalfans_store": {
        "upload_url": "https://www.loyalfans.com/video-store",
        "url_prefix": "https://www.loyalfans.com/store/",
        "title_selectors": ["input[name='title']", "input[placeholder*='Title']"],
        "description_selectors": ["textarea[name='description']", "textarea"],
        "tag_selectors": ["input[name='tags']"],
        "compliance_selectors": ["input[type='checkbox']"],
        "submit_selectors": ["button:has-text('Publish')", "button:has-text('Save')", "button[type='submit']"],
    },
    "fanvue": {
        "upload_url": "https://www.fanvue.com/create",
        "url_prefix": "https://www.fanvue.com/post/",
        "title_selectors": [],
        "description_selectors": ["textarea", "[contenteditable='true']"],
        "tag_selectors": [],
        "compliance_selectors": [],
        "submit_selectors": ["button:has-text('Post')", "button:has-text('Publish')", "button[type='submit']"],
    },
    "admireme": {
        "upload_url": "https://admireme.vip/dashboard/post",
        "url_prefix": "https://admireme.vip/post/",
        "title_selectors": ["input[name='title']"],
        "description_selectors": ["textarea[name='caption']", "textarea"],
        "tag_selectors": [],
        "compliance_selectors": ["input[type='checkbox']"],
        "submit_selectors": ["button[type='submit']", "button:has-text('Post')"],
    },
    "xhamster": {
        "upload_url": "https://xhamster.com/my/uploads/new",
        "url_prefix": "https://xhamster.com/videos/",
        "title_selectors": ["input[name='title']"],
        "description_selectors": ["textarea[name='description']"],
        "tag_selectors": ["input[name='tags']"],
        "compliance_selectors": ["input[type='checkbox']"],
        "submit_selectors": ["button[type='submit']", "button:has-text('Upload')"],
    },
    "spankbang": {
        "upload_url": "https://spankbang.com/users/upload",
        "url_prefix": "https://spankbang.com/",
        "title_selectors": ["input[name='title']"],
        "description_selectors": ["textarea[name='description']"],
        "tag_selectors": ["input[name='tags']"],
        "compliance_selectors": ["input[type='checkbox']"],
        "submit_selectors": ["button[type='submit']"],
    },
    "eporner": {
        "upload_url": "https://www.eporner.com/upload_do/",
        "url_prefix": "https://www.eporner.com/video-",
        "title_selectors": ["input[name='title']"],
        "description_selectors": ["textarea[name='description']"],
        "tag_selectors": ["input[name='tags']"],
        "compliance_selectors": ["input[type='checkbox']"],
        "submit_selectors": ["button[type='submit']", "input[type='submit']"],
    },
    "maloum": {
        "upload_url": "https://app.maloum.com/posts/create",
        "url_prefix": "https://www.maloum.com/posts/",
        "title_selectors": ["input[name='title']"],
        "description_selectors": ["textarea", "[contenteditable='true']"],
        "tag_selectors": [],
        "compliance_selectors": ["input[type='checkbox']"],
        "submit_selectors": ["button[type='submit']", "button:has-text('Post')", "button:has-text('Publish')"],
    },
    "boosty": {
        "upload_url": "https://boosty.to/app/post/new",
        "url_prefix": "https://boosty.to/posts/",
        "title_selectors": ["input[placeholder*='Title']", "input[name='title']"],
        "description_selectors": ["[contenteditable='true']", "textarea"],
        "tag_selectors": ["input[placeholder*='tag']"],
        "compliance_selectors": [],
        "submit_selectors": ["button:has-text('Publish')", "button[type='submit']"],
    },
    "fancentro": {
        "upload_url": "https://fancentro.com/admin/posts/create",
        "url_prefix": "https://fancentro.com/p/",
        "title_selectors": ["input[name='title']"],
        "description_selectors": ["textarea", "[contenteditable='true']"],
        "tag_selectors": ["input[name='tags']"],
        "compliance_selectors": ["input[type='checkbox']"],
        "submit_selectors": ["button:has-text('Post')", "button:has-text('Publish')", "button[type='submit']"],
    },
    "slushy": {
        "upload_url": "https://www.slushy.com/create",
        "url_prefix": "https://www.slushy.com/post/",
        "title_selectors": [],
        "description_selectors": ["textarea", "[contenteditable='true']"],
        "tag_selectors": ["input[placeholder*='#']"],
        "compliance_selectors": ["input[type='checkbox']"],
        "submit_selectors": ["button:has-text('Post')", "button[type='submit']"],
    },
    "apclips": {
        "upload_url": "https://apclips.com/models/videos/add",
        "url_prefix": "https://apclips.com/video/",
        "title_selectors": ["input[name='title']", "#title"],
        "description_selectors": ["textarea[name='description']", "#description"],
        "tag_selectors": ["input[name='tags']", "input[name='keywords']"],
        "compliance_selectors": ["input[type='checkbox'][name*='2257']", "input[type='checkbox']"],
        "submit_selectors": ["button[type='submit']", "input[type='submit']", "button:has-text('Save')"],
    },
    "modelhub": {
        "upload_url": "https://www.modelhub.com/upload",
        "url_prefix": "https://www.modelhub.com/video/",
        "title_selectors": ["input[name='title']", "#title"],
        "description_selectors": ["textarea[name='description']", "#description"],
        "tag_selectors": ["input[name='tags']"],
        "compliance_selectors": ["input[type='checkbox'][name*='2257']", "input[type='checkbox']"],
        "submit_selectors": ["button[type='submit']", "button:has-text('Publish')"],
    },
    "bentbox": {
        "upload_url": "https://bentbox.co/boxes/create",
        "url_prefix": "https://bentbox.co/box/",
        "title_selectors": ["input[name='title']", "input[placeholder*='Title']"],
        "description_selectors": ["textarea[name='description']", "textarea"],
        "tag_selectors": ["input[name='tags']"],
        "compliance_selectors": ["input[type='checkbox']"],
        "submit_selectors": ["button[type='submit']", "button:has-text('Save')", "button:has-text('Publish')"],
    },
    "kofi": {
        "upload_url": "https://ko-fi.com/manage/posts",
        "url_prefix": "https://ko-fi.com/post/",
        "title_selectors": ["input[name='title']", "input[placeholder*='Title']"],
        "description_selectors": ["[contenteditable='true']", "textarea"],
        "tag_selectors": [],
        "compliance_selectors": [],
        "submit_selectors": ["button:has-text('Publish')", "button[type='submit']"],
    },
    "subscribestar_adult": {
        "upload_url": "https://www.subscribestar.adult/posts/new",
        "url_prefix": "https://www.subscribestar.adult/posts/",
        "title_selectors": ["input[name='title']"],
        "description_selectors": ["[contenteditable='true']", "textarea"],
        "tag_selectors": [],
        "compliance_selectors": ["input[type='checkbox']"],
        "submit_selectors": ["button:has-text('Post')", "button[type='submit']"],
    },
    "patreon_18": {
        "upload_url": "https://www.patreon.com/posts/new",
        "url_prefix": "https://www.patreon.com/posts/",
        "title_selectors": ["input[placeholder*='Title']", "input[name='title']"],
        "description_selectors": ["[contenteditable='true']", "textarea"],
        "tag_selectors": ["input[placeholder*='tag']"],
        "compliance_selectors": [],
        "submit_selectors": ["button:has-text('Publish')", "button[type='submit']"],
    },
    "fetlife": {
        "upload_url": "https://fetlife.com/videos/new",
        "url_prefix": "https://fetlife.com/videos/",
        "title_selectors": ["input[name='title']", "#video_title"],
        "description_selectors": ["textarea[name='description']", "#video_description", "textarea"],
        "tag_selectors": [],
        "compliance_selectors": ["input[type='checkbox']"],
        "submit_selectors": ["button[type='submit']", "input[type='submit']"],
    },
    "redgifs": {
        "upload_url": "https://www.redgifs.com/create",
        "url_prefix": "https://www.redgifs.com/watch/",
        "title_selectors": ["input[name='title']"],
        "description_selectors": ["textarea"],
        "tag_selectors": ["input[placeholder*='Tag']", "input[name='tags']"],
        "compliance_selectors": ["input[type='checkbox']"],
        "submit_selectors": ["button:has-text('Publish')", "button:has-text('Upload')", "button[type='submit']"],
    },
    "redtube": {
        "upload_url": "https://www.redtube.com/upload",
        "url_prefix": "https://www.redtube.com/",
        "title_selectors": ["input[name='title']", "#title"],
        "description_selectors": ["textarea[name='description']"],
        "tag_selectors": ["input[name='tags']"],
        "compliance_selectors": ["input[type='checkbox']"],
        "submit_selectors": ["button[type='submit']", "button:has-text('Upload')"],
    },
    "youporn": {
        "upload_url": "https://www.youporn.com/upload/",
        "url_prefix": "https://www.youporn.com/watch/",
        "title_selectors": ["input[name='title']", "#title"],
        "description_selectors": ["textarea[name='description']"],
        "tag_selectors": ["input[name='tags']"],
        "compliance_selectors": ["input[type='checkbox']"],
        "submit_selectors": ["button[type='submit']", "button:has-text('Upload')"],
    },
    "motherless": {
        "upload_url": "https://motherless.com/upload",
        "url_prefix": "https://motherless.com/",
        "title_selectors": ["input[name='title']", "#title"],
        "description_selectors": ["textarea[name='caption']", "textarea[name='description']"],
        "tag_selectors": ["input[name='tags']"],
        "compliance_selectors": ["input[type='checkbox']"],
        "submit_selectors": ["button[type='submit']", "input[type='submit']"],
    },
    "iwara": {
        "upload_url": "https://www.iwara.tv/upload/video",
        "url_prefix": "https://www.iwara.tv/video/",
        "title_selectors": ["input[name='title']"],
        "description_selectors": ["textarea[name='body']", "textarea"],
        "tag_selectors": ["input[placeholder*='tag']"],
        "compliance_selectors": ["input[type='checkbox']"],
        "submit_selectors": ["button[type='submit']", "button:has-text('Create')"],
    },
    "locals": {
        "upload_url": "https://locals.com/post/create",
        "url_prefix": "https://locals.com/post/",
        "title_selectors": ["input[name='title']", "input[placeholder*='Title']"],
        "description_selectors": ["textarea", "[contenteditable='true']"],
        "tag_selectors": [],
        "compliance_selectors": [],
        "submit_selectors": ["button[type='submit']", "button:has-text('Post')"],
    },
}


async def human_pause(page: Any = None, min_ms: int = 180, max_ms: int = 450) -> None:
    """Randomized human micro-pause between DOM interactions to avoid 0ms bot cadence flags."""
    if os.environ.get("POLYPOST_HUMAN_DELAY_MS", "").strip() == "0":
        return
    if page is not None and hasattr(page, "wait_for_timeout"):
        await page.wait_for_timeout(random.randint(min_ms, max(min_ms, max_ms)))


async def attach_media_safely(page, file_path: str, selectors: Optional[List[str]] = None) -> bool:
    for selector in selectors or RESILIENT_UPLOAD_SELECTORS:
        try:
            loc = page.locator(selector).first
            if await loc.count() > 0:
                await loc.set_input_files(file_path)
                await human_pause(page, 250, 600)
                return True
        except Exception:
            continue
    return False


async def fill_first_selector(page, selectors: List[str], value: str) -> bool:
    if not value:
        return False
    for selector in selectors:
        try:
            loc = page.locator(selector).first
            if await loc.count() > 0:
                if hasattr(loc, "scroll_into_view_if_needed"):
                    await loc.scroll_into_view_if_needed()
                await loc.fill(value)
                await human_pause(page, 180, 450)
                return True
        except Exception:
            continue
    return False


async def click_first_selector(page, selectors: List[str]) -> bool:
    for selector in selectors:
        try:
            loc = page.locator(selector).first
            if await loc.count() > 0:
                if hasattr(loc, "scroll_into_view_if_needed"):
                    await loc.scroll_into_view_if_needed()
                await human_pause(page, 150, 350)
                await loc.click()
                return True
        except Exception:
            continue
    return False


def _load_selector_overrides(overrides_path: Optional[Path] = None) -> Dict[str, Any]:
    env_override = os.environ.get("POLYPOST_SELECTOR_OVERRIDES", "").strip()
    path = overrides_path or (Path(env_override) if env_override else SELECTOR_OVERRIDES_PATH)
    if not path.exists():
        return {}
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def get_platform_recipe(platform_id: str, overrides_path: Optional[Path] = None) -> Dict[str, Any]:
    base = PLATFORM_UPLOAD_RECIPES.get(
        platform_id,
        {
            "upload_url": f"https://{platform_id}.com/upload",
            "url_prefix": f"https://{platform_id}.example.com/p/",
            "title_selectors": ["input[name='title']"],
            "description_selectors": ["textarea"],
            "tag_selectors": ["input[name='tags']"],
            "compliance_selectors": [],
            "submit_selectors": ["button[type='submit']"],
        },
    )
    recipe: Dict[str, Any] = {
        "upload_url": base.get("upload_url", f"https://{platform_id}.com/upload"),
        "url_prefix": base.get("url_prefix", f"https://{platform_id}.example.com/p/"),
        "file_input_selectors": list(base.get("file_input_selectors", RESILIENT_UPLOAD_SELECTORS)),
        "title_selectors": list(base.get("title_selectors", [])),
        "description_selectors": list(base.get("description_selectors", [])),
        "tag_selectors": list(base.get("tag_selectors", [])),
        "compliance_selectors": list(base.get("compliance_selectors", [])),
        "submit_selectors": list(base.get("submit_selectors", [])),
    }

    override = _load_selector_overrides(overrides_path).get(platform_id)
    if isinstance(override, dict):
        for str_key in ("upload_url", "url_prefix"):
            val = override.get(str_key)
            if isinstance(val, str) and val.strip():
                recipe[str_key] = val.strip()
        for list_key in (
            "file_input_selectors",
            "title_selectors",
            "description_selectors",
            "tag_selectors",
            "compliance_selectors",
            "submit_selectors",
        ):
            val = override.get(list_key)
            if isinstance(val, list):
                cleaned = [str(s).strip() for s in val if isinstance(s, str) and s.strip()]
                if cleaned or list_key == "compliance_selectors":
                    recipe[list_key] = cleaned
    return recipe


def is_simulation_disabled() -> bool:
    reload_root_env_if_changed()
    return os.environ.get("DISABLE_SIMULATED_CONNECTORS", "").strip().lower() in ("1", "true")


async def capture_failure_screenshot(page, job_id: str, output_dir: Path = FAILURES_DIR) -> Optional[str]:
    try:
        output_dir.mkdir(parents=True, exist_ok=True)
        safe_id = "".join(c for c in job_id if c.isalnum() or c in ("-", "_")) or "job"
        target = output_dir / f"{safe_id}.png"
        await page.screenshot(path=str(target), full_page=True)
        return str(target)
    except Exception:
        return None


async def detect_security_challenge(page: Any) -> Optional[str]:
    """Detect CAPTCHA, Cloudflare, or account checkpoint screens to halt automated retries immediately."""
    curr_url = str(getattr(page, "url", "") or "").lower()
    for url_marker in ("/challenge", "/checkpoint", "/account/locked", "/accounts/suspended"):
        if url_marker in curr_url:
            return f"Security challenge or checkpoint URL detected ({page.url})"

    if hasattr(page, "title"):
        try:
            title = str(await page.title() or "").lower()
            for title_marker in (
                "just a moment...",
                "attention required!",
                "verify you are human",
                "security check",
                "access denied",
            ):
                if title_marker in title:
                    return f"Anti-bot challenge screen detected ('{title}')"
        except Exception:
            pass
    return None


async def inspect_selectors_on_page(
    page,
    platform_id: str,
    account_id: str,
    custom_url: Optional[str] = None,
    previews_dir: Path = PREVIEWS_DIR,
) -> Dict[str, Any]:
    recipe = get_platform_recipe(platform_id)
    target_url = (custom_url or recipe["upload_url"]).strip()
    await page.goto(target_url, wait_until="domcontentloaded", timeout=30_000)

    current_url = str(getattr(page, "url", "") or target_url)
    try:
        page_title = await page.title()
    except Exception:
        page_title = ""

    redirected_to_login = "/login" in current_url.lower() or "signin" in current_url.lower()
    groups: Dict[str, List[str]] = {
        "file_input": recipe.get("file_input_selectors", RESILIENT_UPLOAD_SELECTORS),
        "title": recipe.get("title_selectors", []),
        "description": recipe.get("description_selectors", []),
        "tags": recipe.get("tag_selectors", []),
        "compliance": recipe.get("compliance_selectors", []),
        "submit": recipe.get("submit_selectors", []),
    }

    selectors_report: Dict[str, List[Dict[str, Any]]] = {}
    matched_groups: List[str] = []
    missing_groups: List[str] = []

    for group_name, candidates in groups.items():
        if not candidates:
            continue
        group_entries: List[Dict[str, Any]] = []
        any_found = False
        for sel in candidates:
            count = 0
            visible = False
            try:
                loc = page.locator(sel).first
                count = int(await loc.count())
                if count > 0 and hasattr(loc, "is_visible"):
                    visible = bool(await loc.is_visible())
            except Exception:
                count = 0
            if count > 0:
                any_found = True
            group_entries.append({"selector": sel, "count": count, "visible": visible})
        selectors_report[group_name] = group_entries
        if any_found:
            matched_groups.append(group_name)
        else:
            missing_groups.append(group_name)

    safe_acc = "".join(c for c in account_id if c.isalnum() or c in ("-", "_")) or "account"
    safe_plat = "".join(c for c in platform_id if c.isalnum() or c in ("-", "_")) or "platform"
    shot_path = await capture_failure_screenshot(page, f"{safe_acc}_{safe_plat}", output_dir=previews_dir)

    return {
        "ok": True,
        "account_id": account_id,
        "platform_id": platform_id,
        "target_url": target_url,
        "current_url": current_url,
        "page_title": page_title,
        "redirected_to_login": redirected_to_login,
        "matched_groups": matched_groups,
        "missing_groups": missing_groups,
        "selectors": selectors_report,
        "preview_screenshot": Path(shot_path).name if shot_path else None,
    }


async def inspect_platform_selectors(
    account_id: str,
    platform_id: str,
    custom_url: Optional[str] = None,
    headless: bool = True,
) -> Dict[str, Any]:
    storage_state = load_storage_state(account_id)
    if not storage_state:
        return {
            "ok": False,
            "account_id": account_id,
            "platform_id": platform_id,
            "error": f"No vaulted session found for '{account_id}'. Connect an account in Vault first.",
        }

    async with async_playwright() as p:
        browser, context = await launch_stealth_context(p, account_id=account_id, headless=headless)
        page = await context.new_page()
        try:
            report = await inspect_selectors_on_page(page, platform_id, account_id, custom_url=custom_url)
            if report.get("ok") and not report.get("redirected_to_login"):
                await persist_refreshed_context_state(context, account_id, platform_id)
            return report
        finally:
            await browser.close()


class ModularBrowserUploader(BaseUploader):
    """
    Automated and assisted browser uploader using Patchright.
    Passes local disk paths directly via set_input_files for zero RAM buffering.
    Enforces 2257 compliance pause/gate and captures screenshots on failures.
    """

    def _is_adult_platform(self) -> bool:
        return self.payload.platform_id.startswith(
            (
                "pornhub",
                "xvideos",
                "manyvids",
                "fansly",
                "onlyfans",
                "clips4sale",
                "iwantclips",
                "mym",
                "justforfans",
                "jff",
                "loyalfans",
                "fanvue",
                "admireme",
                "subscribestar_adult",
                "patreon_18",
                "fetlife",
                "spankbang",
                "xhamster",
                "eporner",
                "redtube",
                "youporn",
                "redgifs",
                "iwara",
            )
        )

    def _merged_tags(self) -> List[str]:
        template_tags = self.settings.form_templates.get("default", {}).get("tags", [])
        seen = set()
        merged: List[str] = []
        for t in [*self.payload.tags, *template_tags]:
            if t and t not in seen:
                seen.add(t)
                merged.append(t)
        return merged

    async def execute(self) -> Dict[str, Any]:
        # 1. Always enforce 2257 compliance gate first
        is_adult_platform = self._is_adult_platform()
        self.verify_compliance_gate(requires_adult_taxonomy=is_adult_platform)

        recipe = get_platform_recipe(self.payload.platform_id)

        # 2. Clean Dry-Run mode (e.g. demo launch without active credentials/cookies)
        if self.payload.dry_run:
            if is_simulation_disabled():
                return {
                    "success": False,
                    "dry_run": False,
                    "job_id": self.payload.job_id,
                    "platform_id": self.payload.platform_id,
                    "error": f"Simulated dry-run disabled for '{self.payload.platform_id}' (DISABLE_SIMULATED_CONNECTORS=1).",
                }
            return {
                "success": True,
                "dry_run": True,
                "job_id": self.payload.job_id,
                "platform_id": self.payload.platform_id,
                "published_url": f"{recipe['url_prefix']}{self.payload.job_id[:8]}",
                "compliance_verified": is_adult_platform,
                "applied_tags": self._merged_tags(),
            }

        # 3. Validate real local file & active session for live browser dispatch
        if not os.path.exists(self.payload.file_path):
            raise FileNotFoundError(f"Media file not found on disk: {self.payload.file_path}")

        storage_state = load_storage_state(self.payload.account_id)
        if not storage_state:
            return {
                "success": False,
                "dry_run": False,
                "job_id": self.payload.job_id,
                "error": f"No active session found for account '{self.payload.account_id}'. Connect account in Vault or run `npm run login`.",
            }

        async with async_playwright() as p:
            browser, context = await launch_stealth_context(
                p,
                account_id=self.payload.account_id,
                headless=True,
            )
            page = await context.new_page()
            try:
                published_url = await self._upload_workflow(page, recipe, is_adult_platform)
                await persist_refreshed_context_state(context, self.payload.account_id, self.payload.platform_id)
                preview_path = await capture_failure_screenshot(
                    page,
                    f"upload_{self.payload.job_id}",
                    output_dir=PREVIEWS_DIR,
                )
                return {
                    "success": True,
                    "dry_run": False,
                    "job_id": self.payload.job_id,
                    "platform_id": self.payload.platform_id,
                    "published_url": published_url,
                    "preview_screenshot": Path(preview_path).name if preview_path else None,
                    "compliance_verified": is_adult_platform,
                }
            except Exception as exc:
                screenshot_path = await capture_failure_screenshot(page, self.payload.job_id)
                return {
                    "success": False,
                    "dry_run": False,
                    "job_id": self.payload.job_id,
                    "platform_id": self.payload.platform_id,
                    "failure_screenshot": Path(screenshot_path).name if screenshot_path else None,
                    "error": f"Browser workflow failed on {self.payload.platform_id}: {exc}",
                }
            finally:
                await browser.close()

    async def _upload_workflow(self, page, recipe: Dict[str, Any], is_adult_platform: bool) -> str:
        await page.goto(recipe["upload_url"], wait_until="domcontentloaded", timeout=30_000)

        # Fail fast if session expired and redirected to login screen
        if "/login" in page.url.lower() or "signin" in page.url.lower():
            raise PermissionError(f"Session expired; redirected to login gate ({page.url}). Re-authenticate in Vault.")

        challenge_reason = await detect_security_challenge(page)
        if challenge_reason:
            raise PermissionError(
                f"Security challenge detected ({challenge_reason}). Automatic retries halted to protect your account; "
                "open Account Vault to solve the challenge in Chrome."
            )

        if self.payload.file_path and os.path.exists(self.payload.file_path):
            attached = await attach_media_safely(page, self.payload.file_path, recipe.get("file_input_selectors"))
            if not attached:
                raise RuntimeError("Could not locate any resilient file upload input on upload page.")

        await fill_first_selector(page, recipe.get("title_selectors", []), self.payload.title)
        await fill_first_selector(page, recipe.get("description_selectors", []), self.payload.description)
        tags = self._merged_tags()
        if tags:
            await fill_first_selector(page, recipe.get("tag_selectors", []), ", ".join(tags))

        # Only interact with 2257 checkbox after explicit human attestation verification has passed
        if is_adult_platform and self.payload.confirmed_2257_attestation:
            for sel in recipe.get("compliance_selectors", []):
                try:
                    box = page.locator(sel).first
                    if await box.count() > 0 and not await box.is_checked():
                        await box.check()
                except Exception:
                    continue

        if self.payload.auto_submit:
            await click_first_selector(page, recipe.get("submit_selectors", []))

        return page.url or f"{recipe['url_prefix']}{self.payload.job_id[:8]}"
