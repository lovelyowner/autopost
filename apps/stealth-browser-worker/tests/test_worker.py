import os
import time
import pytest
from pathlib import Path

from src.config import get_launch_args, load_settings
from src.crypto_vault import decrypt_data, encrypt_data
from src.health_check import check_cookies_expiry
from src.session_vault import delete_profile, list_profiles, load_storage_state, save_session
from src.uploaders.base import ComplianceVerificationRequiredException, UploadJobPayload
from src.uploaders.modular_uploader import (
    ModularBrowserUploader,
    attach_media_safely,
    capture_failure_screenshot,
    get_platform_recipe,
    inspect_selectors_on_page,
)

def test_load_settings(tmp_path):
    s = load_settings()
    assert len(s.browser_launch_args) >= 3
    assert "--disable-blink-features=AutomationControlled" in s.browser_launch_args
    assert s.compliance.require_user_confirmation_for_2257 is True

def test_session_vault(tmp_path, monkeypatch):
    test_profiles = tmp_path / "profiles"
    monkeypatch.setattr("src.session_vault.PROFILES_ROOT", test_profiles)

    storage_state = {
        "cookies": [
            {"name": "session_id", "value": "test1234", "expires": time.time() + 3600, "domain": ".example.com"}
        ],
        "origins": []
    }
    saved_path = save_session("test_user_1", "pornhub_video", storage_state, {"alias": "Nova"})
    assert os.path.exists(saved_path)

    loaded = load_storage_state("test_user_1")
    assert loaded is not None
    assert loaded["cookies"][0]["name"] == "session_id"

    profiles = list_profiles()
    assert len(profiles) == 1
    assert profiles[0]["account_id"] == "test_user_1"

def test_cookie_expiry_check():
    expired_cookies = [{"name": "auth", "expires": time.time() - 100}]
    valid, reason = check_cookies_expiry(expired_cookies)
    assert valid is False
    assert "expired" in reason.lower()

    active_cookies = [{"name": "auth", "expires": time.time() + 1000}]
    valid, reason = check_cookies_expiry(active_cookies)
    assert valid is True
    assert reason is None

@pytest.mark.asyncio
async def test_2257_compliance_gate(tmp_path):
    sample_file = tmp_path / "video.mp4"
    sample_file.write_bytes(b"dummy video content")

    # 1. Unconfirmed upload on adult tube must raise ComplianceVerificationRequiredException
    unconfirmed_payload = UploadJobPayload(
        job_id="job_001",
        account_id="acc_1",
        platform_id="pornhub_video",
        file_path=str(sample_file),
        title="Sample Video",
        confirmed_2257_attestation=False,
    )
    uploader = ModularBrowserUploader(unconfirmed_payload)
    with pytest.raises(ComplianceVerificationRequiredException):
        await uploader.execute()

    # 2. Confirmed upload passes the gate
    confirmed_payload = UploadJobPayload(
        job_id="job_002",
        account_id="acc_1",
        platform_id="pornhub_video",
        file_path=str(sample_file),
        title="Sample Video",
        confirmed_2257_attestation=True,
        records_id_2257="REC-2257-VAULT-001",
    )
    uploader2 = ModularBrowserUploader(confirmed_payload)
    # verify_compliance_gate shouldn't raise
    uploader2.verify_compliance_gate(requires_adult_taxonomy=True)

def test_encrypted_session_vault(tmp_path, monkeypatch):
    test_profiles = tmp_path / "encrypted_profiles"
    monkeypatch.setattr("src.session_vault.PROFILES_ROOT", test_profiles)
    monkeypatch.setenv("POLYPOST_SECRET_KEY", "super-secret-vault-master-key-2026")

    sample_state = {"cookies": [{"name": "auth_token", "value": "encrypted_token_secret_123"}]}
    saved = save_session("enc_user", "fansly_wall", sample_state)
    assert os.path.exists(saved)

    # Raw file should not contain plaintext secret token
    raw_content = saved.read_text()
    assert "encrypted_token_secret_123" not in raw_content
    assert "__polypost_encrypted__" in raw_content

    # Decrypted read returns identical state
    loaded = load_storage_state("enc_user")
    assert loaded is not None
    assert loaded["cookies"][0]["value"] == "encrypted_token_secret_123"

    assert delete_profile("enc_user") is True
    assert load_storage_state("enc_user") is None

@pytest.mark.asyncio
async def test_dry_run_and_resilient_selector_fallback(tmp_path):
    confirmed_dry_run = UploadJobPayload(
        job_id="dry_001",
        account_id="acc_1",
        platform_id="pornhub_video",
        file_path="/nonexistent/mock.mp4",
        title="Dry Run Test",
        confirmed_2257_attestation=True,
        records_id_2257="REC-2257-OK",
        dry_run=True,
    )
    res = await ModularBrowserUploader(confirmed_dry_run).execute()
    assert res["success"] is True
    assert res["dry_run"] is True
    assert res["compliance_verified"] is True

    # Test resilient fallback attaches on 3rd selector
    attached_files = []

    class FakeLocator:
        def __init__(self, selector: str):
            self.selector = selector
            self.first = self

        async def count(self):
            return 1 if self.selector == "[data-testid='file-input']" else 0

        async def set_input_files(self, path: str):
            attached_files.append((self.selector, path))

    class FakePage:
        def locator(self, selector: str):
            return FakeLocator(selector)

        async def screenshot(self, path: str, full_page: bool = True):
            Path(path).write_bytes(b"png-bytes")

    page = FakePage()
    ok = await attach_media_safely(page, "/tmp/demo.mp4")
    assert ok is True
    assert attached_files == [("[data-testid='file-input']", "/tmp/demo.mp4")]

    shot = await capture_failure_screenshot(page, "job_fail_99", output_dir=tmp_path)
    assert shot is not None
    assert os.path.exists(shot)


@pytest.mark.asyncio
async def test_selector_inspector_and_simulation_disable_flag(tmp_path, monkeypatch):
    class InspectorLocator:
        def __init__(self, sel: str):
            self.sel = sel
            self.first = self

        async def count(self):
            return 1 if self.sel in ("input[type='file']", "input[name='title']", "button[type='submit']") else 0

        async def is_visible(self):
            return True

    class InspectorPage:
        url = "https://www.pornhub.com/upload"

        async def goto(self, url: str, wait_until: str = "domcontentloaded", timeout: int = 30000):
            self.url = url

        async def title(self):
            return "Upload Video"

        def locator(self, selector: str):
            return InspectorLocator(selector)

        async def screenshot(self, path: str, full_page: bool = True):
            Path(path).write_bytes(b"preview-png")

    report = await inspect_selectors_on_page(
        InspectorPage(),
        platform_id="pornhub_video",
        account_id="nova_acc",
        previews_dir=tmp_path,
    )
    assert report["ok"] is True
    assert report["redirected_to_login"] is False
    assert "file_input" in report["matched_groups"]
    assert "title" in report["matched_groups"]
    assert "submit" in report["matched_groups"]
    assert "description" in report["missing_groups"]
    assert report["preview_screenshot"] == "nova_acc_pornhub_video.png"
    assert (tmp_path / "nova_acc_pornhub_video.png").exists()

    # DISABLE_SIMULATED_CONNECTORS=1 must block dry-run simulation URLs
    monkeypatch.setenv("DISABLE_SIMULATED_CONNECTORS", "1")
    blocked_dry_run = UploadJobPayload(
        job_id="dry_blocked",
        account_id="acc_1",
        platform_id="pornhub_video",
        file_path="/nonexistent/mock.mp4",
        title="Blocked Dry Run",
        confirmed_2257_attestation=True,
        records_id_2257="REC-2257-OK",
        dry_run=True,
    )
    res = await ModularBrowserUploader(blocked_dry_run).execute()
    assert res["success"] is False
    assert "DISABLE_SIMULATED_CONNECTORS" in res["error"]


def test_get_platform_recipe_loads_selector_overrides(tmp_path):
    overrides_file = tmp_path / "selector-overrides.json"
    overrides_file.write_text(
        '{"pornhub_video": {"upload_url": "https://www.pornhub.com/upload/v2", "title_selectors": ["#newTitleInput"], "submit_selectors": ["#goLiveBtn"]}}',
        encoding="utf-8",
    )
    recipe = get_platform_recipe("pornhub_video", overrides_path=overrides_file)
    assert recipe["upload_url"] == "https://www.pornhub.com/upload/v2"
    assert recipe["title_selectors"] == ["#newTitleInput"]
    assert recipe["submit_selectors"] == ["#goLiveBtn"]
    # Unchanged keys retain built-in defaults
    assert len(recipe["description_selectors"]) >= 1
    assert len(recipe["file_input_selectors"]) == 6


def test_import_cookies_session_cookie_editor_and_validation(tmp_path, monkeypatch):
    from src.session_vault import import_cookies_session

    monkeypatch.setattr("src.session_vault.PROFILES_ROOT", tmp_path / "profiles")

    cookie_editor_payload = [
        {
            "name": "auth_token",
            "value": "secret_abc",
            "domain": ".pornhub.com",
            "path": "/",
            "expirationDate": 1893456000,
            "httpOnly": True,
            "secure": True,
            "sameSite": "no_restriction",
        },
        {
            "name": "ph_session",
            "value": "sess_xyz",
            "domain": ".pornhub.com",
            "session": True,
            "sameSite": "unspecified",
        },
    ]

    result = import_cookies_session("cookie_creator_1", "pornhub_video", cookie_editor_payload)
    assert result["success"] is True
    assert result["cookie_count"] == 2
    assert result["status"] == "imported"

    loaded = load_storage_state("cookie_creator_1")
    assert loaded is not None
    assert loaded["cookies"][0]["sameSite"] == "None"
    assert loaded["cookies"][0]["expires"] == 1893456000.0
    assert loaded["cookies"][1]["expires"] == -1
    assert loaded["cookies"][1]["sameSite"] == "Lax"

    with pytest.raises(ValueError, match="Invalid cookie JSON"):
        import_cookies_session("cookie_creator_1", "pornhub_video", "{not json")

    with pytest.raises(ValueError, match="No valid cookies"):
        import_cookies_session("cookie_creator_1", "pornhub_video", [{"value": "missing_name"}])


@pytest.mark.asyncio
async def test_login_flow_finish_button_and_manual_close_preserve_cookies(tmp_path, monkeypatch):
    import asyncio
    from contextlib import asynccontextmanager
    from src import login_flow

    monkeypatch.setattr("src.session_vault.PROFILES_ROOT", tmp_path / "profiles")

    # Case A: manual "Finish & Save Cookies Now" trigger with custom site cookies
    class FakePageA:
        url = "https://fansly.com/"

        async def goto(self, *args, **kwargs):
            return None

        def is_closed(self):
            return False

    class FakeContextA:
        async def new_page(self):
            return FakePageA()

        async def storage_state(self):
            return {
                "cookies": [
                    {"name": "site_pref", "value": "dark", "domain": ".fansly.com"},
                    {"name": "custom_sid", "value": "tok_999", "domain": ".fansly.com"},
                ],
                "origins": [],
            }

    class FakeBrowserA:
        async def close(self):
            return None

    async def fake_launch_a(*args, **kwargs):
        return FakeBrowserA(), FakeContextA()

    @asynccontextmanager
    async def fake_pw_ctx():
        yield object()

    monkeypatch.setattr(login_flow, "async_playwright", fake_pw_ctx)
    monkeypatch.setattr(login_flow, "launch_stealth_context", fake_launch_a)

    async def trigger_early_finish():
        await asyncio.sleep(0.05)
        assert login_flow.request_login_completion("finish_acc") is True

    task = asyncio.create_task(trigger_early_finish())
    res_a = await login_flow.launch_interactive_login("finish_acc", "fansly_wall", timeout_sec=10)
    await task
    assert res_a["success"] is True
    assert res_a["status"] == "saved_manually"
    assert res_a["cookie_count"] == 2
    assert load_storage_state("finish_acc") is not None

    # Case B: Chrome closed manually right after polling snapshot captured cookies
    class FakePageB:
        url = "https://www.pornhub.com/login"
        checks = 0

        async def goto(self, *args, **kwargs):
            return None

        def is_closed(self):
            FakePageB.checks += 1
            return FakePageB.checks >= 2

    class FakeContextB:
        async def new_page(self):
            return FakePageB()

        async def storage_state(self):
            if FakePageB.checks >= 2:
                raise RuntimeError("Target page, context or browser has been closed")
            return {
                "cookies": [
                    {"name": "custom_a", "value": "1", "domain": ".pornhub.com"},
                    {"name": "custom_b", "value": "2", "domain": ".pornhub.com"},
                    {"name": "custom_c", "value": "3", "domain": ".pornhub.com"},
                ],
                "origins": [],
            }

    class FakeBrowserB:
        async def close(self):
            raise RuntimeError("Browser already closed")

    async def fake_launch_b(*args, **kwargs):
        return FakeBrowserB(), FakeContextB()

    monkeypatch.setattr(login_flow, "launch_stealth_context", fake_launch_b)
    res_b = await login_flow.launch_interactive_login("close_acc", "pornhub_video", timeout_sec=10)
    assert res_b["success"] is True
    assert res_b["status"] == "saved_on_close"
    assert res_b["cookie_count"] == 3
    assert load_storage_state("close_acc") is not None


@pytest.mark.asyncio
async def test_launch_stealth_context_wayland_and_missing_display(tmp_path, monkeypatch):
    import sys
    from src import browser as browser_mod

    monkeypatch.setattr(sys, "platform", "linux")
    monkeypatch.delenv("DISPLAY", raising=False)
    monkeypatch.delenv("WAYLAND_DISPLAY", raising=False)

    with pytest.raises(RuntimeError, match="Cookie JSON Import"):
        await browser_mod.launch_stealth_context(object(), headless=False)

    # Stale WAYLAND_DISPLAY without a live socket must also fail fast cleanly
    monkeypatch.setenv("WAYLAND_DISPLAY", "wayland-0")
    monkeypatch.setenv("XDG_RUNTIME_DIR", str(tmp_path / "missing-runtime"))
    with pytest.raises(RuntimeError, match="Cookie JSON Import"):
        await browser_mod.launch_stealth_context(object(), headless=False)

    captured_args = []
    captured_kwargs = {}

    class FakeChromium:
        async def launch(self, headless, args, proxy, **kwargs):
            captured_args.extend(args)
            captured_kwargs.update(kwargs)

            class FakeBrowser:
                async def new_context(self, **kwargs):
                    return object()

            return FakeBrowser()

    class FakePw:
        chromium = FakeChromium()

    # Live Wayland socket triggers Ozone-Wayland flags
    live_sock = tmp_path / "wayland-0"
    live_sock.touch()
    monkeypatch.setenv("XDG_RUNTIME_DIR", str(tmp_path))
    monkeypatch.setenv("WAYLAND_DISPLAY", "wayland-0")
    monkeypatch.setattr(browser_mod, "resolve_browser_executable", lambda *a, **kw: "/usr/bin/chromium-browser")
    await browser_mod.launch_stealth_context(FakePw(), headless=False)
    assert "--ozone-platform=wayland" in captured_args
    assert "--enable-features=UseOzonePlatform" in captured_args
    assert captured_kwargs.get("executable_path") == "/usr/bin/chromium-browser"
    assert isinstance(captured_kwargs.get("env"), dict)

    # Read-only $HOME redirects Chromium XDG dirs to a writable path
    monkeypatch.setattr(browser_mod, "_is_dir_writable", lambda p: False)
    ro_env = browser_mod.build_writable_browser_env({"HOME": "/readonly-home", "PATH": "/usr/bin"})
    assert ro_env["HOME"] != "/readonly-home"
    assert ro_env["XDG_CONFIG_HOME"].endswith("/.config")
    assert ro_env["XDG_DATA_HOME"].endswith("/.local/share")

    monkeypatch.setattr(browser_mod, "resolve_browser_executable", lambda *a, **kw: None)
    with pytest.raises(RuntimeError, match="No Chrome or Chromium browser found"):
        await browser_mod.launch_stealth_context(FakePw(), headless=True)


def test_resolve_browser_executable_prefers_override_and_finds_chromium(tmp_path, monkeypatch):
    from src.browser import resolve_browser_executable

    fake_bin = tmp_path / "custom-chrome"
    fake_bin.write_text("#!/bin/sh\nexit 0\n")
    fake_bin.chmod(0o755)
    monkeypatch.setenv("POLYPOST_BROWSER_EXECUTABLE", str(fake_bin))
    assert resolve_browser_executable() == str(fake_bin)


@pytest.mark.asyncio
async def test_anti_ban_user_agent_timezone_human_pause_and_permissions(tmp_path, monkeypatch):
    from src import browser as browser_mod
    from src.browser import build_matching_user_agent
    from src.uploaders.modular_uploader import human_pause

    assert "Chrome/152.0.7977.82" in build_matching_user_agent("152.0.7977.82")

    captured_ctx = {}

    class FakeBrowser:
        version = "152.0.7977.82"

        async def new_context(self, **kwargs):
            captured_ctx.update(kwargs)
            return object()

    class FakeChromium:
        async def launch(self, **kwargs):
            return FakeBrowser()

    class FakePw:
        chromium = FakeChromium()

    monkeypatch.delenv("POLYPOST_TIMEZONE", raising=False)
    monkeypatch.setattr(browser_mod, "resolve_browser_executable", lambda *a, **kw: "/usr/bin/chromium-browser")
    await browser_mod.launch_stealth_context(FakePw(), headless=True)
    assert "Chrome/152.0.7977.82" in captured_ctx["user_agent"]
    assert "timezone_id" not in captured_ctx

    monkeypatch.setenv("POLYPOST_TIMEZONE", "America/New_York")
    await browser_mod.launch_stealth_context(FakePw(), headless=True)
    assert captured_ctx["timezone_id"] == "America/New_York"

    # Verify human_pause invokes wait_for_timeout when present
    waited_ms = []

    class TimedPage:
        async def wait_for_timeout(self, ms: int):
            waited_ms.append(ms)

    monkeypatch.delenv("POLYPOST_HUMAN_DELAY_MS", raising=False)
    await human_pause(TimedPage(), 120, 200)
    assert len(waited_ms) == 1 and 120 <= waited_ms[0] <= 200

    # Verify save_session locks profile directory (0700) and files (0600)
    monkeypatch.setattr("src.session_vault.PROFILES_ROOT", tmp_path / "sec_profiles")
    state_file = save_session(
        "perm_acc",
        "pornhub_video",
        {"cookies": [{"name": "a", "value": "1"}]},
        metadata={"import_method": "cookie_json"},
    )
    assert (state_file.stat().st_mode & 0o777) == 0o600
    assert (state_file.parent.stat().st_mode & 0o777) == 0o700

    # Verify persist_refreshed_context_state saves rotated cookies & preserves metadata
    from src.session_vault import get_profile_meta, persist_refreshed_context_state
    from src.uploaders.modular_uploader import detect_security_challenge

    class RotatedContext:
        async def storage_state(self):
            return {
                "cookies": [
                    {"name": "a", "value": "rotated_2"},
                    {"name": "csrftoken", "value": "fresh_csrf"},
                ],
                "origins": [],
            }

    saved_ok = await persist_refreshed_context_state(RotatedContext(), "perm_acc", "pornhub_video")
    assert saved_ok is True
    refreshed = load_storage_state("perm_acc")
    assert refreshed["cookies"][0]["value"] == "rotated_2"
    meta = get_profile_meta("perm_acc")
    assert meta["import_method"] == "cookie_json"
    assert meta["cookie_count"] == 2

    # Verify detect_security_challenge catches checkpoint URLs and Cloudflare challenge titles
    class ChallengePage:
        url = "https://www.instagram.com/challenge/action/"

        async def title(self):
            return "Instagram"

    class CloudflarePage:
        url = "https://onlyfans.com/posts/create"

        async def title(self):
            return "Just a moment..."

    assert await detect_security_challenge(ChallengePage()) is not None
    assert await detect_security_challenge(CloudflarePage()) is not None


def test_x_login_does_not_close_prematurely_on_redirect_or_cross_domain_cookies():
    from src.login_flow import _extract_platform_auth_tokens, _is_authenticated_snapshot

    preloaded_cookies = [
        {"name": "sessionid", "value": "ig_secret_session", "domain": ".instagram.com", "path": "/"},
        {"name": "csrftoken", "value": "ig_csrf", "domain": ".instagram.com", "path": "/"},
        {"name": "gt", "value": "1856900000", "domain": ".x.com", "path": "/"},
        {"name": "guest_id", "value": "v1%3A1794619000", "domain": ".x.com", "path": "/"},
        {"name": "__cf_bm", "value": "cf_token", "domain": ".x.com", "path": "/"},
        {"name": "personalization_id", "value": "v1_abc", "domain": ".x.com", "path": "/"},
    ]
    baseline = _extract_platform_auth_tokens(
        preloaded_cookies,
        "x",
        "https://x.com/i/flow/login",
        "https://x.com/i/flow/login",
    )
    assert baseline == set()

    # Even if X redirects to https://x.com/ and has 6+ cookies (including Instagram's sessionid),
    # it must NOT auto-close before .x.com receives auth_token!
    assert (
        _is_authenticated_snapshot(
            preloaded_cookies,
            "https://x.com/i/flow/login",
            "https://x.com/",
            platform="x",
            baseline_tokens=baseline,
        )
        is False
    )

    # Once the user finishes signing in to X and .x.com sets auth_token, it SHOULD detect login:
    authed_cookies = [
        *preloaded_cookies,
        {"name": "auth_token", "value": "x_real_auth_token_999", "domain": ".x.com", "path": "/"},
    ]
    assert (
        _is_authenticated_snapshot(
            authed_cookies,
            "https://x.com/i/flow/login",
            "https://x.com/home",
            platform="x",
            baseline_tokens=baseline,
        )
        is True
    )


@pytest.mark.asyncio
async def test_no_secondary_origin_tabs_and_interrupted_goto_resilience(monkeypatch):
    import src.login_flow as lf
    from src.browser import launch_stealth_context

    # 1. Save a profile with an Instagram origin in storage_state
    save_session(
        "multi_origin_acc",
        "instagram",
        {
            "cookies": [{"name": "csrftoken", "value": "abc", "domain": ".instagram.com", "path": "/"}],
            "origins": [{"origin": "https://www.instagram.com", "localStorage": [{"name": "k", "value": "v"}]}],
        },
    )

    captured_context_kwargs = {}

    class DummyBrowser:
        version = "152.0.7977.82"

        async def new_context(self, **kwargs):
            captured_context_kwargs.update(kwargs)
            return "dummy_ctx"

    class DummyPlaywright:
        class chromium:
            @staticmethod
            async def launch(**kwargs):
                return DummyBrowser()

    _, _ = await launch_stealth_context(DummyPlaywright(), account_id="multi_origin_acc", headless=True)
    # Verify origins are stripped so Patchright never opens a temporary instagram.com tab via visitOrigins()
    assert captured_context_kwargs["storage_state"]["origins"] == []
    assert len(captured_context_kwargs["storage_state"]["cookies"]) == 1

    # 2. Verify launch_interactive_login survives interrupted page.goto() and uses context.cookies()
    storage_state_called = False
    poll_count = 0

    class RedirectingPage:
        url = "https://x.com/i/flow/login"

        async def goto(self, target_url, wait_until="domcontentloaded"):
            raise RuntimeError("Navigation is interrupted by another navigation")

        def is_closed(self):
            return False

    class CookieOnlyContext:
        async def new_page(self):
            return RedirectingPage()

        async def cookies(self):
            nonlocal poll_count
            poll_count += 1
            if poll_count == 1:
                return [{"name": "gt", "value": "111", "domain": ".x.com", "path": "/"}]
            return [
                {"name": "gt", "value": "111", "domain": ".x.com", "path": "/"},
                {"name": "auth_token", "value": "x_tok_ok", "domain": ".x.com", "path": "/"},
            ]

        async def storage_state(self):
            nonlocal storage_state_called
            storage_state_called = True
            raise AssertionError("storage_state() should not be called when context.cookies() is available")

    class ClosableBrowser:
        async def close(self):
            pass

    class FakeAsyncPlaywright:
        async def __aenter__(self):
            return object()

        async def __aexit__(self, exc_type, exc, tb):
            pass

    async def fake_launch(p, account_id=None, headless=False):
        return ClosableBrowser(), CookieOnlyContext()

    monkeypatch.setattr(lf, "async_playwright", lambda: FakeAsyncPlaywright())
    monkeypatch.setattr(lf, "launch_stealth_context", fake_launch)

    res = await lf.launch_interactive_login("multi_origin_acc", "x", timeout_sec=5, headless=True)
    assert res["success"] is True
    assert res["status"] == "authenticated"
    assert storage_state_called is False
    delete_profile("multi_origin_acc")


def test_per_account_proxy_persistence_and_expanded_platform_recipes(tmp_path):
    from src.config import get_proxy_for_account, load_settings, mask_proxy_url, set_proxy_for_account
    from src.login_flow import PLATFORM_AUTH_RULES, PLATFORM_LOGIN_URLS
    from src.uploaders.modular_uploader import get_platform_recipe

    cfg_file = tmp_path / "account-settings.json"
    res = set_proxy_for_account("x_acc_1", "http://user1:secretpass@198.51.100.10:8080", config_path=cfg_file)
    assert res["proxy"] == "http://***@198.51.100.10:8080"
    assert mask_proxy_url("socks5://u:p@10.0.0.1:1080") == "socks5://***@10.0.0.1:1080"

    loaded = load_settings(cfg_file)
    assert get_proxy_for_account("x_acc_1", loaded) == "http://user1:secretpass@198.51.100.10:8080"
    assert get_proxy_for_account("x_acc_2", loaded) is None

    # Clear proxy for x_acc_1
    cleared = set_proxy_for_account("x_acc_1", "", config_path=cfg_file)
    assert cleared["proxy"] is None

    # Verify newly requested platforms have login URLs, auth rules, and upload recipes
    for pid in (
        "rumble",
        "bitchute",
        "odysee",
        "manyvids_store",
        "manyvids_club",
        "onlyfans_feed",
        "onlyfans_ppv",
        "clips4sale",
        "iwantclips",
        "mym_fans",
        "justforfans",
        "loyalfans_store",
        "fanvue",
        "admireme",
    ):
        assert pid in PLATFORM_LOGIN_URLS
        assert pid in PLATFORM_AUTH_RULES
        recipe = get_platform_recipe(pid)
        assert recipe["upload_url"].startswith("https://")


def test_verify_proxy_connectivity_tcp_and_validation():
    import socket
    from src.config import verify_proxy_connectivity

    # Empty proxy should return ok=False with a clean message
    empty_res = verify_proxy_connectivity("")
    assert empty_res["ok"] is False

    # Spin up an ephemeral local TCP listener and verify TCP reachability check succeeds
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.bind(("127.0.0.1", 0))
    srv.listen(2)
    port = srv.getsockname()[1]
    try:
        res = verify_proxy_connectivity(f"socks5://user:pass@127.0.0.1:{port}", timeout_sec=1.5)
        assert res["ok"] is True
        assert res["latency_ms"] is not None
        assert res["proxy"] == f"socks5://***@127.0.0.1:{port}"
    finally:
        srv.close()


def test_audit_all_profiles_cookie_expiry_and_domains():
    import time
    from src.session_vault import audit_all_profiles, delete_profile, save_session

    now = time.time()
    save_session(
        "audit_valid_acc",
        "x",
        {
            "cookies": [
                {"name": "auth_token", "value": "tok_ok", "domain": ".x.com", "path": "/", "expires": now + 86400},
                {"name": "ct0", "value": "csrf_ok", "domain": ".x.com", "path": "/", "expires": -1},
            ],
            "origins": [],
        },
    )
    save_session(
        "audit_expired_acc",
        "onlyfans_feed",
        {
            "cookies": [
                {"name": "sess", "value": "old", "domain": ".onlyfans.com", "path": "/", "expires": now - 3600},
            ],
            "origins": [],
        },
    )
    try:
        report = audit_all_profiles(check_proxies=False)
        by_id = {item["account_id"]: item for item in report}
        assert "audit_valid_acc" in by_id
        assert by_id["audit_valid_acc"]["healthy"] is True
        assert by_id["audit_valid_acc"]["valid_cookie_count"] == 2
        assert "x.com" in by_id["audit_valid_acc"]["domains"]

        assert "audit_expired_acc" in by_id
        assert by_id["audit_expired_acc"]["healthy"] is False
        assert by_id["audit_expired_acc"]["valid_cookie_count"] == 0
        assert by_id["audit_expired_acc"]["expired_cookie_count"] == 1
    finally:
        delete_profile("audit_valid_acc")
        delete_profile("audit_expired_acc")


def test_export_and_import_vault_bundle():
    from src.session_vault import (
        delete_profile,
        export_vault_bundle,
        import_vault_bundle,
        load_cookies,
        save_session,
    )

    save_session(
        "bundle_test_acc",
        "rumble",
        {
            "cookies": [
                {"name": "r_sess", "value": "v123", "domain": ".rumble.com", "path": "/", "expires": -1},
            ],
            "origins": [],
        },
    )
    try:
        exported = export_vault_bundle()
        assert exported["version"] == 1
        matching = [p for p in exported["profiles"] if p["account_id"] == "bundle_test_acc"]
        assert len(matching) == 1

        delete_profile("bundle_test_acc")
        assert len(load_cookies("bundle_test_acc")) == 0

        res = import_vault_bundle({"profiles": matching, "proxies": {}})
        assert res["restored_profiles"] == 1
        assert len(load_cookies("bundle_test_acc")) == 1
    finally:
        delete_profile("bundle_test_acc")


def test_companion_media_stage_and_inline_materialization(tmp_path, monkeypatch):
    import base64
    from fastapi.testclient import TestClient
    from src import api as api_mod
    from src.uploaders import modular_uploader as mod_up
    from src.uploaders.base import UploadJobPayload

    monkeypatch.setattr(api_mod, "MONOREPO_ROOT", tmp_path)
    monkeypatch.setattr(mod_up, "MONOREPO_ROOT", tmp_path)

    client = TestClient(api_mod.app)
    resp = client.post(
        "/api/media/stage?filename=demo%20clip.mp4",
        content=b"FAKE_MP4_BYTES_1234",
        headers={"Origin": "https://autopost-gilt-gamma.vercel.app"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["sizeBytes"] == len(b"FAKE_MP4_BYTES_1234")
    staged = tmp_path / "data" / "uploads" / data["originalName"]
    assert staged.name.endswith("demo_clip.mp4")

    # Verify Private Network Access preflight headers for HTTPS web domain -> 127.0.0.1:8001
    opt = client.options(
        "/api/upload",
        headers={
            "Origin": "https://autopost-gilt-gamma.vercel.app",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Private-Network": "true",
        },
    )
    assert opt.status_code == 200
    assert opt.headers.get("access-control-allow-private-network") == "true"

    # Verify inline media_data_url decodes to temporary upload path
    raw_b64 = base64.b64encode(b"\x89PNG\r\n").decode("ascii")
    payload = UploadJobPayload(
        job_id="job_inline_1",
        account_id="acc1",
        platform_id="x",
        title="Test",
        media_data_url=f"data:image/png;base64,{raw_b64}",
    )
    uploader = mod_up.ModularBrowserUploader(payload)
    decoded_path = uploader._materialize_media_data_url()
    assert decoded_path is not None
    assert decoded_path.exists()
    assert decoded_path.read_bytes() == b"\x89PNG\r\n"





