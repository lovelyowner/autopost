import json
import os
import shutil
import time
from pathlib import Path
from typing import Any, Dict, List, Optional
from .config import (
    get_proxy_for_account,
    load_settings,
    mask_proxy_url,
    set_proxy_for_account,
    verify_proxy_connectivity,
)
from .crypto_vault import decrypt_data, encrypt_data

PROFILES_ROOT = Path(__file__).resolve().parents[3] / "profiles"

def _safe_account_id(account_id: str) -> str:
    cleaned = "".join(c for c in account_id if c.isalnum() or c in ("-", "_", "."))
    if not cleaned or cleaned in (".", "..") or cleaned != account_id:
        raise ValueError(f"Invalid account_id: {account_id}")
    return cleaned

def get_profile_dir(account_id: str) -> Path:
    safe_id = _safe_account_id(account_id)
    p = PROFILES_ROOT / safe_id
    p.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(p, 0o700)
    except OSError:
        pass
    return p

def save_session(
    account_id: str,
    platform: str,
    storage_state: Dict[str, Any],
    metadata: Optional[Dict[str, Any]] = None,
) -> Path:
    pdir = get_profile_dir(account_id)
    state_file = pdir / "storage_state.json"

    existing_state = load_storage_state(account_id) or {}
    merged_cookies_map: Dict[tuple, Dict[str, Any]] = {}
    for c in existing_state.get("cookies", []):
        if isinstance(c, dict) and c.get("name"):
            key = (str(c.get("domain", "")), str(c.get("path", "/")), str(c.get("name", "")))
            merged_cookies_map[key] = c
    for c in storage_state.get("cookies", []):
        if isinstance(c, dict) and c.get("name"):
            key = (str(c.get("domain", "")), str(c.get("path", "/")), str(c.get("name", "")))
            merged_cookies_map[key] = c

    merged_origins_map: Dict[str, Dict[str, Any]] = {}
    for o in existing_state.get("origins", []):
        if isinstance(o, dict) and o.get("origin"):
            merged_origins_map[str(o["origin"])] = o
    for o in storage_state.get("origins", []):
        if isinstance(o, dict) and o.get("origin"):
            merged_origins_map[str(o["origin"])] = o

    merged_state = {
        **existing_state,
        **storage_state,
        "cookies": list(merged_cookies_map.values()),
        "origins": list(merged_origins_map.values()),
    }

    encrypted_state = encrypt_data(merged_state)
    with open(state_file, "w", encoding="utf-8") as f:
        json.dump(encrypted_state, f, indent=2)
    try:
        os.chmod(state_file, 0o600)
    except OSError:
        pass

    # Save cookies separately for easy access/inspection (encrypted if secret set)
    cookies_file = pdir / "cookies.json"
    cookies = merged_state.get("cookies", [])
    encrypted_cookies = encrypt_data(cookies)
    with open(cookies_file, "w", encoding="utf-8") as f:
        json.dump(encrypted_cookies, f, indent=2)
    try:
        os.chmod(cookies_file, 0o600)
    except OSError:
        pass

    meta_file = pdir / "metadata.json"
    prev_platforms = []
    if meta_file.exists():
        try:
            with open(meta_file, "r", encoding="utf-8") as mf:
                old_meta = json.load(mf)
                if isinstance(old_meta.get("platforms"), list):
                    prev_platforms.extend(str(p) for p in old_meta["platforms"] if p)
                if old_meta.get("platform"):
                    prev_platforms.append(str(old_meta["platform"]))
        except Exception:
            pass
    if platform:
        prev_platforms.append(str(platform))

    meta = {
        "account_id": account_id,
        "platform": platform,
        "platforms": sorted(set(prev_platforms)),
        "updated_at": int(time.time()),
        "encrypted": isinstance(encrypted_state, dict) and encrypted_state.get("__polypost_encrypted__", False),
        **(metadata or {}),
        "cookie_count": len(cookies),
    }
    with open(meta_file, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)
    try:
        os.chmod(meta_file, 0o600)
    except OSError:
        pass

    return state_file

def load_storage_state(account_id: str) -> Optional[Dict[str, Any]]:
    pdir = PROFILES_ROOT / account_id
    state_file = pdir / "storage_state.json"
    if not state_file.exists():
        return None
    try:
        with open(state_file, "r", encoding="utf-8") as f:
            raw = json.load(f)
            return decrypt_data(raw)
    except Exception:
        return None

def load_cookies(account_id: str) -> List[Dict[str, Any]]:
    pdir = PROFILES_ROOT / account_id
    cookies_file = pdir / "cookies.json"
    if not cookies_file.exists():
        return []
    try:
        with open(cookies_file, "r", encoding="utf-8") as f:
            raw = json.load(f)
            decrypted = decrypt_data(raw)
            return decrypted if isinstance(decrypted, list) else []
    except Exception:
        return []

def get_profile_meta(account_id: str) -> Optional[Dict[str, Any]]:
    pdir = PROFILES_ROOT / account_id
    meta_file = pdir / "metadata.json"
    if not meta_file.exists():
        return None
    try:
        with open(meta_file, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None

def list_profiles() -> List[Dict[str, Any]]:
    if not PROFILES_ROOT.exists():
        return []
    settings = load_settings()
    profiles = []
    for item in PROFILES_ROOT.iterdir():
        if item.is_dir():
            meta = get_profile_meta(item.name) or {"account_id": item.name}
            proxy = get_proxy_for_account(item.name, settings)
            meta["proxy"] = mask_proxy_url(proxy) if proxy else None
            profiles.append(meta)
    return profiles

def delete_profile(account_id: str) -> bool:
    safe_id = _safe_account_id(account_id)
    pdir = PROFILES_ROOT / safe_id
    if not pdir.exists():
        return False
    shutil.rmtree(pdir)
    return True


_SAME_SITE_MAP = {
    "strict": "Strict",
    "lax": "Lax",
    "none": "None",
    "no_restriction": "None",
}


def normalize_imported_storage_state(raw_payload: Any) -> Dict[str, Any]:
    """Normalize Cookie-Editor/EditThisCookie arrays or Playwright storage_state objects."""
    parsed = raw_payload
    if isinstance(parsed, str):
        stripped = parsed.strip()
        if not stripped:
            raise ValueError("Empty cookie JSON payload")
        try:
            parsed = json.loads(stripped)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid cookie JSON: {exc.msg}") from exc

    origins: List[Dict[str, Any]] = []
    if isinstance(parsed, dict):
        cookies_raw = parsed.get("cookies")
        if not isinstance(cookies_raw, list):
            raise ValueError("JSON object must contain a 'cookies' array")
        if isinstance(parsed.get("origins"), list):
            origins = parsed["origins"]
    elif isinstance(parsed, list):
        cookies_raw = parsed
    else:
        raise ValueError("Expected a JSON cookie array (Cookie-Editor) or Playwright storage_state object")

    normalized: List[Dict[str, Any]] = []
    for item in cookies_raw:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        domain = str(item.get("domain") or "").strip()
        if not name or not domain:
            continue

        raw_same_site = str(item.get("sameSite") or "").strip().lower()
        same_site = _SAME_SITE_MAP.get(raw_same_site, "Lax")

        expires_val: float = -1
        if not bool(item.get("session", False)):
            raw_exp = item.get("expires") if item.get("expires") is not None else item.get("expirationDate")
            if raw_exp is not None and not isinstance(raw_exp, bool):
                try:
                    parsed_exp = float(raw_exp)
                    if parsed_exp > 0:
                        expires_val = parsed_exp
                except (TypeError, ValueError):
                    pass

        normalized.append({
            "name": name,
            "value": str(item.get("value") or ""),
            "domain": domain,
            "path": str(item.get("path") or "/"),
            "expires": expires_val,
            "httpOnly": bool(item.get("httpOnly", False)),
            "secure": bool(item.get("secure", False)),
            "sameSite": same_site,
        })

    if not normalized:
        raise ValueError("No valid cookies with both 'name' and 'domain' were found")

    return {"cookies": normalized, "origins": origins}


def import_cookies_session(
    account_id: str,
    platform: str,
    raw_payload: Any,
) -> Dict[str, Any]:
    """Validate, normalize, encrypt, and save imported browser cookies into the vault."""
    _safe_account_id(account_id)
    state = normalize_imported_storage_state(raw_payload)
    cookie_count = len(state["cookies"])
    state_path = save_session(
        account_id,
        platform,
        state,
        metadata={
            "import_method": "cookie_json",
            "cookie_count": cookie_count,
        },
    )
    return {
        "success": True,
        "account_id": account_id,
        "platform": platform,
        "cookie_count": cookie_count,
        "state_path": str(state_path),
        "status": "imported",
    }


async def persist_refreshed_context_state(
    context: Any,
    account_id: str,
    platform: str,
) -> bool:
    """Save rotated Set-Cookie session tokens back into the vault after a live browser interaction."""
    if context is None or (not hasattr(context, "cookies") and not hasattr(context, "storage_state")):
        return False
    try:
        safe_id = _safe_account_id(account_id)
        if not (PROFILES_ROOT / safe_id).exists():
            return False
        fresh_cookies = None
        if hasattr(context, "cookies") and callable(context.cookies):
            fresh_cookies = await context.cookies()
        if fresh_cookies is not None and isinstance(fresh_cookies, list):
            fresh_state = {"cookies": fresh_cookies, "origins": []}
        elif hasattr(context, "storage_state") and callable(context.storage_state):
            fresh_state = await context.storage_state()
        else:
            return False
        if not isinstance(fresh_state, dict) or not fresh_state.get("cookies"):
            return False
        existing_meta = get_profile_meta(safe_id) or {}
        extra_meta = {
            k: v
            for k, v in existing_meta.items()
            if k not in ("account_id", "platform", "updated_at", "encrypted")
        }
        extra_meta["cookie_count"] = len(fresh_state["cookies"])
        save_session(safe_id, existing_meta.get("platform") or platform, fresh_state, metadata=extra_meta)
        return True
    except Exception:
        return False


def audit_all_profiles(check_proxies: bool = True) -> List[Dict[str, Any]]:
    """Fast multi-account pre-flight audit of vaulted cookie expiration and sticky proxy reachability."""
    profiles = list_profiles()
    settings = load_settings()
    now = time.time()
    results: List[Dict[str, Any]] = []

    for meta in profiles:
        acc_id = str(meta.get("account_id") or "")
        if not acc_id:
            continue
        cookies = load_cookies(acc_id)
        total = len(cookies)
        expired_count = 0
        valid_count = 0
        domains_set = set()

        for c in cookies:
            if not isinstance(c, dict):
                continue
            dom = str(c.get("domain") or "").lstrip(".").lower()
            if dom:
                domains_set.add(dom)
            exp = c.get("expires", -1)
            try:
                exp_f = float(exp) if exp is not None else -1.0
            except (TypeError, ValueError):
                exp_f = -1.0
            if exp_f > 0 and exp_f < now:
                expired_count += 1
            else:
                valid_count += 1

        raw_proxy = get_proxy_for_account(acc_id, settings)
        proxy_masked = mask_proxy_url(raw_proxy) if raw_proxy else None
        proxy_ok = True
        proxy_latency_ms: Optional[float] = None
        proxy_error: Optional[str] = None

        if raw_proxy and check_proxies:
            probe = verify_proxy_connectivity(raw_proxy, timeout_sec=1.5)
            proxy_ok = bool(probe.get("ok"))
            proxy_latency_ms = probe.get("latency_ms")
            if not proxy_ok:
                proxy_error = str(probe.get("error") or "Proxy unreachable")

        healthy = valid_count > 0 and proxy_ok
        domains_sorted = sorted(domains_set)[:5]
        domains_label = ", ".join(domains_sorted) if domains_sorted else "no domains"

        if valid_count == 0:
            reason = f"0 valid cookies ({expired_count} expired) — Re-Auth required"
        elif not proxy_ok:
            reason = f"{valid_count} valid cookies ({domains_label}), but {proxy_error}"
        elif proxy_masked and proxy_latency_ms is not None:
            reason = f"{valid_count} valid cookies ({domains_label}) · Proxy OK ({proxy_latency_ms} ms)"
        else:
            reason = f"{valid_count} valid cookies ({domains_label}) · Direct IP"

        results.append({
            **meta,
            "account_id": acc_id,
            "healthy": healthy,
            "cookie_count": total,
            "valid_cookie_count": valid_count,
            "expired_cookie_count": expired_count,
            "domains": domains_sorted,
            "proxy": proxy_masked,
            "proxy_ok": proxy_ok,
            "proxy_latency_ms": proxy_latency_ms,
            "reason": reason,
        })

    return results


def export_vault_bundle() -> Dict[str, Any]:
    """Export all vaulted browser sessions and sticky proxy assignments into a portable bundle."""
    profiles_out: List[Dict[str, Any]] = []
    for meta in list_profiles():
        acc_id = str(meta.get("account_id") or "")
        if not acc_id:
            continue
        state = load_storage_state(acc_id) or {"cookies": load_cookies(acc_id), "origins": []}
        profiles_out.append({
            "account_id": acc_id,
            "platform": meta.get("platform") or "generic",
            "metadata": meta,
            "storage_state": state,
        })
    settings = load_settings()
    return {
        "version": 1,
        "exported_at": int(time.time()),
        "profiles": profiles_out,
        "proxies": settings.proxies,
    }


def import_vault_bundle(bundle: Dict[str, Any]) -> Dict[str, Any]:
    """Restore vaulted browser sessions and sticky proxy assignments from an exported bundle."""
    if not isinstance(bundle, dict):
        raise ValueError("Invalid vault bundle payload")
    raw_profiles = bundle.get("profiles") or []
    restored_profiles = 0
    for item in raw_profiles:
        if not isinstance(item, dict):
            continue
        acc_id = str(item.get("account_id") or "").strip()
        if not acc_id:
            continue
        _safe_account_id(acc_id)
        platform = str(item.get("platform") or "generic")
        state = item.get("storage_state")
        if not isinstance(state, dict) or not isinstance(state.get("cookies"), list):
            continue
        meta = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
        save_session(acc_id, platform, state, metadata=meta)
        restored_profiles += 1

    restored_proxies = 0
    proxies_block = bundle.get("proxies")
    if isinstance(proxies_block, dict):
        acc_proxies = proxies_block.get("accounts")
        if isinstance(acc_proxies, dict):
            for acc_id, p_url in acc_proxies.items():
                if acc_id and isinstance(p_url, str) and p_url.strip() and "***" not in p_url:
                    set_proxy_for_account(str(acc_id), p_url.strip())
                    restored_proxies += 1

    return {
        "restored_profiles": restored_profiles,
        "restored_proxies": restored_proxies,
    }


