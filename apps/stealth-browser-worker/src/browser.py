import os
import shutil
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional
from patchright.async_api import Browser, BrowserContext, Playwright, async_playwright

from .config import get_launch_args, get_proxy_for_account, load_settings
from .session_vault import load_storage_state

DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
)


def build_matching_user_agent(browser_version: Optional[str] = None) -> str:
    """Build a desktop User-Agent whose Chrome version matches the actual binary's Sec-CH-UA version."""
    ver = (browser_version or "").strip()
    if ver and ver[0].isdigit():
        return (
            f"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            f"(KHTML, like Gecko) Chrome/{ver} Safari/537.36"
        )
    return DEFAULT_USER_AGENT


def resolve_browser_executable(explicit_path: Optional[str] = None) -> Optional[str]:
    """Locate Patchright's Chromium binary or fall back to an installed system Chrome/Chromium."""
    candidates: List[str] = []
    if explicit_path:
        candidates.append(explicit_path)
    env_exec = os.environ.get("POLYPOST_BROWSER_EXECUTABLE")
    if env_exec:
        candidates.append(env_exec)

    ms_cache = Path.home() / ".cache" / "ms-playwright"
    if ms_cache.exists():
        for pattern in ("chromium-*/chrome-linux64/chrome", "chromium-*/chrome-linux/chrome"):
            for hit in sorted(ms_cache.glob(pattern), reverse=True):
                candidates.append(str(hit))

    for cmd in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "brave-browser"):
        found = shutil.which(cmd)
        if found:
            candidates.append(found)

    for hard_path in (
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/snap/bin/chromium",
    ):
        candidates.append(hard_path)

    for cand in candidates:
        if cand and os.path.exists(cand) and os.access(cand, os.X_OK):
            return cand
    return None

async def launch_stealth_context(
    playwright: Playwright,
    account_id: Optional[str] = None,
    headless: bool = True,
    extra_args: Optional[List[str]] = None,
    storage_state_path: Optional[str] = None,
) -> tuple[Browser, BrowserContext]:
    settings = load_settings()
    launch_args = get_launch_args(extra_args, settings)
    
    proxy_url = get_proxy_for_account(account_id, settings) if account_id else None
    proxy_config = {"server": proxy_url} if proxy_url else None

    # Anti-leak and fingerprint evasion arguments
    args = list(launch_args)
    if "--disable-blink-features=AutomationControlled" not in args:
        args.append("--disable-blink-features=AutomationControlled")
    if "--webrtc-ip-handling-policy=disable_non_proxied_udp" not in args:
        args.append("--webrtc-ip-handling-policy=disable_non_proxied_udp")
    if "--force-webrtc-ip-handling-policy" not in args:
        args.append("--force-webrtc-ip-handling-policy")

    if not headless and sys.platform.startswith("linux"):
        has_x11 = bool(os.environ.get("DISPLAY"))
        has_wayland = bool(os.environ.get("WAYLAND_DISPLAY"))
        if not has_x11 and not has_wayland:
            raise RuntimeError(
                "No desktop display ($DISPLAY / $WAYLAND_DISPLAY) available for interactive browser login. "
                "Use Cookie JSON Import instead."
            )
        if has_wayland and not has_x11:
            if not any(a.startswith("--ozone-platform=") for a in args):
                args.append("--ozone-platform=wayland")
            if "--enable-features=UseOzonePlatform" not in args:
                args.append("--enable-features=UseOzonePlatform")

    browser_executable = resolve_browser_executable()
    if not browser_executable:
        raise RuntimeError(
            "No Chrome or Chromium browser found on this machine and Patchright's Chromium cache "
            "(~/.cache/ms-playwright) is not installed. Run `.venv/bin/patchright install chromium` or install "
            "`chromium` / `google-chrome`, or use the '2. Paste Cookies JSON' tab instead."
        )

    launch_kwargs: Dict[str, Any] = {
        "headless": headless,
        "args": args,
        "proxy": proxy_config,
    }
    # Pass explicit executable_path whenever falling back to system Chrome/Chromium or custom override
    if ".cache/ms-playwright" not in browser_executable:
        launch_kwargs["executable_path"] = browser_executable

    browser = await playwright.chromium.launch(**launch_kwargs)

    detected_version = getattr(browser, "version", None)
    ua_version = detected_version if isinstance(detected_version, str) else None
    context_kwargs: Dict[str, Any] = {
        "user_agent": build_matching_user_agent(ua_version),
        "viewport": {"width": 1280, "height": 800},
        "permissions": [],  # Enforce empty permissions
        "locale": os.environ.get("POLYPOST_LOCALE", "en-US"),
    }
    explicit_tz = os.environ.get("POLYPOST_TIMEZONE", "").strip()
    if explicit_tz:
        context_kwargs["timezone_id"] = explicit_tz

    if storage_state_path and os.path.exists(storage_state_path):
        context_kwargs["storage_state"] = storage_state_path
    elif account_id:
        decrypted_state = load_storage_state(account_id)
        if decrypted_state:
            # Pass cookies only (empty origins) so Patchright does not open/close
            # temporary tabs via visitOrigins() for other domains (e.g. instagram.com).
            context_kwargs["storage_state"] = {
                "cookies": decrypted_state.get("cookies", []),
                "origins": [],
            }

    context = await browser.new_context(**context_kwargs)
    return browser, context
