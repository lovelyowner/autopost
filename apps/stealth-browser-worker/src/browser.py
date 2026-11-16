import os
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional
from patchright.async_api import Browser, BrowserContext, Playwright, async_playwright

from .config import SPA_ORIGIN_PLATFORMS, get_launch_args, get_proxy_for_account, load_settings
from .session_vault import get_profile_meta, load_storage_state

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

def _is_dir_writable(path: Path) -> bool:
    """Verify a directory can be created and written to (catches read-only mounts/EROFS)."""
    try:
        path.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=path, prefix=".pp_probe_", delete=True):
            pass
        return True
    except OSError:
        return False


def build_writable_browser_env(base_env: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    """
    Build Chromium launch environment ensuring ~/.local, ~/.config, and ~/.cache are writable.
    Sandboxed or service environments often mount $HOME read-only, which causes Chromium to
    abort with Read-only file system (30) before opening a page.
    """
    env = dict(os.environ if base_env is None else base_env)
    home_dir = Path(env.get("HOME") or str(Path.home()))
    config_dir = Path(env.get("XDG_CONFIG_HOME") or (home_dir / ".config"))
    data_dir = Path(env.get("XDG_DATA_HOME") or (home_dir / ".local" / "share"))
    cache_dir = Path(env.get("XDG_CACHE_HOME") or (home_dir / ".cache"))

    needs_redirect = not (
        _is_dir_writable(data_dir / "applications")
        and _is_dir_writable(config_dir / "chromium" / "Crash Reports")
        and _is_dir_writable(cache_dir)
    )
    if needs_redirect:
        uid = os.getuid() if hasattr(os, "getuid") else "user"
        fallback_home = Path(tempfile.gettempdir()) / f"polypost_chrome_{uid}"
        (fallback_home / ".local" / "share" / "applications").mkdir(parents=True, exist_ok=True)
        (fallback_home / ".config" / "chromium" / "Crash Reports").mkdir(parents=True, exist_ok=True)
        (fallback_home / ".cache").mkdir(parents=True, exist_ok=True)
        env["HOME"] = str(fallback_home)
        env["XDG_DATA_HOME"] = str(fallback_home / ".local" / "share")
        env["XDG_CONFIG_HOME"] = str(fallback_home / ".config")
        env["XDG_CACHE_HOME"] = str(fallback_home / ".cache")
    return env


def _has_live_wayland_socket(env: Optional[Dict[str, str]] = None) -> bool:
    source = os.environ if env is None else env
    wayland_display = (source.get("WAYLAND_DISPLAY") or "").strip()
    if not wayland_display:
        return False
    if os.path.isabs(wayland_display):
        candidate = Path(wayland_display)
    else:
        xdg_runtime = (source.get("XDG_RUNTIME_DIR") or "").strip()
        if not xdg_runtime:
            return False
        candidate = Path(xdg_runtime) / wayland_display
    try:
        return candidate.exists()
    except OSError:
        return False


def _has_live_x11_socket(env: Optional[Dict[str, str]] = None) -> bool:
    source = os.environ if env is None else env
    display = (source.get("DISPLAY") or "").strip()
    if not display:
        return False
    if display.startswith(":"):
        display_num = display[1:].split(".")[0]
        if not display_num.isdigit():
            return False
        try:
            return (Path("/tmp/.X11-unix") / f"X{display_num}").exists()
        except OSError:
            return False
    return True


async def launch_stealth_context(
    playwright: Playwright,
    account_id: Optional[str] = None,
    headless: bool = True,
    extra_args: Optional[List[str]] = None,
    storage_state_path: Optional[str] = None,
) -> tuple[Browser, BrowserContext]:
    settings = load_settings()
    launch_args = get_launch_args(extra_args, settings)
    launch_env = build_writable_browser_env()

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
    if "--no-first-run" not in args:
        args.append("--no-first-run")
    if "--disable-dev-shm-usage" not in args:
        args.append("--disable-dev-shm-usage")

    has_x11 = _has_live_x11_socket(launch_env)
    has_wayland = _has_live_wayland_socket(launch_env)

    if headless:
        # Never let stale Wayland display variables force Ozone-Wayland in headless automation
        if not has_wayland:
            launch_env.pop("WAYLAND_DISPLAY", None)
    elif sys.platform.startswith("linux"):
        if not has_x11 and not has_wayland:
            raise RuntimeError(
                "No live desktop display socket ($DISPLAY / $WAYLAND_DISPLAY) is reachable from this process for interactive Chrome login. "
                "Run PolyPost locally on your desktop (`npm run companion` or `npm run dev`), or use '2. Paste Cookies JSON' / Cookie JSON Import."
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
            "`chromium` / `google-chrome`, or use Cookie JSON Import instead."
        )

    launch_kwargs: Dict[str, Any] = {
        "headless": headless,
        "args": args,
        "proxy": proxy_config,
        "env": launch_env,
    }
    # Pass explicit executable_path whenever falling back to system Chrome/Chromium or custom override
    if ".cache/ms-playwright" not in browser_executable:
        launch_kwargs["executable_path"] = browser_executable

    try:
        browser = await playwright.chromium.launch(**launch_kwargs)
    except Exception as exc:
        if "--ozone-platform=wayland" in args and has_x11:
            fallback_args = [
                a
                for a in args
                if a != "--ozone-platform=wayland" and a != "--enable-features=UseOzonePlatform"
            ]
            launch_kwargs["args"] = fallback_args
            browser = await playwright.chromium.launch(**launch_kwargs)
        elif not headless and ("Failed to connect to Wayland display" in str(exc) or "The platform failed to initialize" in str(exc)):
            raise RuntimeError(
                "Chromium could not attach to your desktop display server for interactive login. "
                "Run `npm run companion` in your desktop session or use Cookie JSON Import instead."
            ) from exc
        else:
            raise

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
            profile_meta = get_profile_meta(account_id) or {}
            profile_platform = str(profile_meta.get("platform") or "").lower()
            keep_origins = profile_platform in SPA_ORIGIN_PLATFORMS or (
                not decrypted_state.get("cookies") and bool(decrypted_state.get("origins"))
            )
            # Strip origins for cookie-based portals so Patchright does not open/close temporary
            # tabs via visitOrigins(); preserve origins for SPA apps that store auth in localStorage.
            context_kwargs["storage_state"] = {
                "cookies": decrypted_state.get("cookies", []),
                "origins": decrypted_state.get("origins", []) if keep_origins else [],
            }

    context = await browser.new_context(**context_kwargs)
    return browser, context
