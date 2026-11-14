import json
import os
import socket
import time
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse
from pydantic import BaseModel, Field

MONOREPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_CONFIG_PATH = MONOREPO_ROOT / "config" / "account-settings.json"


_LAST_ENV_MTIME: float = 0.0
_KEYS_FROM_ENV_FILE: set[str] = set()


def reload_root_env_if_changed(force: bool = False) -> None:
    global _LAST_ENV_MTIME
    env_path = MONOREPO_ROOT / ".env"
    if not env_path.exists():
        return
    try:
        mtime = env_path.stat().st_mtime
        if not force and mtime <= _LAST_ENV_MTIME:
            return
        _LAST_ENV_MTIME = mtime
        parsed: Dict[str, str] = {}
        for raw in env_path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("export "):
                line = line[7:].strip()
            if "=" not in line:
                continue
            key, val = line.split("=", 1)
            key = key.strip()
            val = val.strip()
            if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
                val = val[1:-1]
            if key:
                parsed[key] = val
        for prev in list(_KEYS_FROM_ENV_FILE):
            if prev not in parsed or parsed[prev] == "":
                os.environ.pop(prev, None)
                _KEYS_FROM_ENV_FILE.discard(prev)
        for key, val in parsed.items():
            if val and (not force or not os.environ.get(key)):
                os.environ[key] = val
                _KEYS_FROM_ENV_FILE.add(key)
    except Exception:
        pass


reload_root_env_if_changed(force=True)

class ComplianceConfig(BaseModel):
    require_user_confirmation_for_2257: bool = True
    default_records_id: str = "REC-2257-VERIFIED-VAULT"
    custodian_contact: str = "custodian@example.com"

class AccountSettings(BaseModel):
    browser_launch_args: List[str] = Field(default_factory=lambda: [
        "--disable-blink-features=AutomationControlled",
        "--webrtc-ip-handling-policy=disable_non_proxied_udp",
        "--force-webrtc-ip-handling-policy"
    ])
    proxies: Dict[str, Any] = Field(default_factory=lambda: {
        "default": None,
        "accounts": {}
    })
    compliance: ComplianceConfig = Field(default_factory=ComplianceConfig)
    form_templates: Dict[str, Any] = Field(default_factory=dict)

def load_settings(config_path: Optional[Path] = None) -> AccountSettings:
    path = config_path or DEFAULT_CONFIG_PATH
    if not path.exists():
        return AccountSettings()
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return AccountSettings(**data)
    except Exception as e:
        print(f"Warning: Failed to load {path}: {e}. Using defaults.")
        return AccountSettings()

def get_proxy_for_account(account_id: str, settings: Optional[AccountSettings] = None) -> Optional[str]:
    s = settings or load_settings()
    acc_proxies = s.proxies.get("accounts", {})
    return acc_proxies.get(account_id, s.proxies.get("default"))


def mask_proxy_url(proxy_url: Optional[str]) -> Optional[str]:
    if not proxy_url:
        return None
    raw = str(proxy_url).strip()
    if not raw:
        return None
    if "@" in raw and "://" in raw:
        scheme, rest = raw.split("://", 1)
        _, host_part = rest.rsplit("@", 1)
        return f"{scheme}://***@{host_part}"
    return raw


def set_proxy_for_account(
    account_id: str,
    proxy_url: Optional[str],
    config_path: Optional[Path] = None,
) -> Dict[str, Any]:
    path = config_path or DEFAULT_CONFIG_PATH
    data: Dict[str, Any] = {}
    if path.exists():
        try:
            with open(path, "r", encoding="utf-8") as f:
                loaded = json.load(f)
                if isinstance(loaded, dict):
                    data = loaded
        except Exception:
            data = {}

    proxies = data.get("proxies")
    if not isinstance(proxies, dict):
        proxies = {"default": None, "accounts": {}}
    accounts = proxies.get("accounts")
    if not isinstance(accounts, dict):
        accounts = {}

    cleaned = (proxy_url or "").strip()
    if account_id == "default":
        proxies["default"] = cleaned if cleaned else None
    else:
        if cleaned:
            accounts[account_id] = cleaned
        else:
            accounts.pop(account_id, None)

    proxies["accounts"] = accounts
    data["proxies"] = proxies
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

    return {
        "account_id": account_id,
        "proxy": mask_proxy_url(cleaned) if cleaned else None,
        "default_proxy": mask_proxy_url(proxies.get("default")),
        "accounts": {k: mask_proxy_url(v) for k, v in accounts.items()},
    }


def verify_proxy_connectivity(proxy_url: str, timeout_sec: float = 3.5) -> Dict[str, Any]:
    raw = (proxy_url or "").strip()
    if not raw:
        return {"ok": False, "error": "Provide a proxy URL (e.g. http://user:pass@host:port)"}
    if "://" not in raw:
        raw = f"http://{raw}"
    parsed = urlparse(raw)
    host = parsed.hostname
    port = parsed.port or (443 if parsed.scheme == "https" else 1080 if parsed.scheme.startswith("socks") else 8080)
    if not host:
        return {"ok": False, "error": f"Invalid proxy hostname in '{mask_proxy_url(raw)}'"}

    t0 = time.perf_counter()
    try:
        with socket.create_connection((host, int(port)), timeout=timeout_sec):
            latency_ms = round((time.perf_counter() - t0) * 1000, 1)
            return {
                "ok": True,
                "proxy": mask_proxy_url(raw),
                "host": host,
                "port": int(port),
                "latency_ms": latency_ms,
                "message": f"Proxy {host}:{port} reachable ({latency_ms} ms TCP handshake)",
            }
    except Exception as exc:
        return {
            "ok": False,
            "proxy": mask_proxy_url(raw),
            "host": host,
            "port": int(port),
            "error": f"Proxy {host}:{port} unreachable: {exc}",
        }


def get_launch_args(extra_args: Optional[List[str]] = None, settings: Optional[AccountSettings] = None) -> List[str]:
    s = settings or load_settings()
    args = list(s.browser_launch_args)
    if extra_args:
        for arg in extra_args:
            if arg not in args:
                args.append(arg)
    return args
