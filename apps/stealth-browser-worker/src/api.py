import asyncio
import re
from typing import Any, Dict, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .config import load_settings, mask_proxy_url, set_proxy_for_account, verify_proxy_connectivity
from .health_check import verify_session_health
from .login_flow import launch_interactive_login, request_login_completion
from .session_vault import (
    audit_all_profiles,
    delete_profile,
    export_vault_bundle,
    import_cookies_session,
    import_vault_bundle,
    list_profiles,
    load_storage_state,
    save_session,
)
from .uploaders.base import ComplianceVerificationRequiredException, UploadJobPayload
from .uploaders.modular_uploader import (
    ModularBrowserUploader,
    PREVIEWS_DIR,
    get_platform_recipe,
    inspect_platform_selectors,
)

app = FastAPI(title="PolyPost Stealth Browser Worker", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class LoginRequest(BaseModel):
    account_id: str
    platform: str
    headless: bool = False
    timeout_sec: int = 180

class CompleteLoginRequest(BaseModel):
    account_id: str

class ImportCookiesRequest(BaseModel):
    account_id: str
    platform: str
    cookies_json: Any

class HealthCheckRequest(BaseModel):
    account_id: str
    platform: str

class InspectSelectorsRequest(BaseModel):
    account_id: str
    platform: str
    custom_url: Optional[str] = None
    headless: bool = True

class Confirm2257Request(BaseModel):
    job_id: str
    records_id: str
    custodian_signature: str

class SetProxyRequest(BaseModel):
    account_id: str
    proxy_url: Optional[str] = None

# In-memory record for pending 2257 confirmations
PENDING_COMPLIANCE: Dict[str, Dict[str, Any]] = {}

@app.get("/health")
async def root_health():
    return {"status": "ok", "service": "stealth-browser-worker"}

@app.get("/api/config")
async def get_config():
    return load_settings().model_dump()

@app.get("/api/profiles")
async def get_profiles():
    return {"profiles": list_profiles()}

@app.get("/api/proxies")
async def get_proxies():
    s = load_settings()
    acc_map = s.proxies.get("accounts", {}) or {}
    return {
        "default_proxy": mask_proxy_url(s.proxies.get("default")),
        "accounts": {k: mask_proxy_url(v) for k, v in acc_map.items()},
    }

@app.post("/api/proxies")
async def update_proxy(req: SetProxyRequest):
    return set_proxy_for_account(req.account_id, req.proxy_url)

@app.post("/api/proxies/test")
async def test_proxy(req: SetProxyRequest):
    return verify_proxy_connectivity(req.proxy_url or "")

@app.delete("/api/profiles/{account_id}")
async def remove_profile(account_id: str):
    try:
        removed = delete_profile(account_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not removed:
        raise HTTPException(status_code=404, detail=f"Profile '{account_id}' not found")
    return {"deleted": True, "account_id": account_id}

@app.post("/api/sessions/login")
async def trigger_login(req: LoginRequest):
    try:
        res = await launch_interactive_login(
            account_id=req.account_id,
            platform=req.platform,
            headless=req.headless,
            timeout_sec=req.timeout_sec,
        )
        return res
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/sessions/login/complete")
async def complete_active_login(req: CompleteLoginRequest):
    signaled = request_login_completion(req.account_id)
    if not signaled:
        raise HTTPException(
            status_code=404,
            detail=f"No active browser login window found for '{req.account_id}'",
        )
    return {"signaled": True, "account_id": req.account_id}

@app.post("/api/sessions/import")
async def import_cookies(req: ImportCookiesRequest):
    try:
        return import_cookies_session(
            account_id=req.account_id,
            platform=req.platform,
            raw_payload=req.cookies_json,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/sessions/health")
async def check_health(req: HealthCheckRequest):
    return await verify_session_health(req.account_id, req.platform)

@app.post("/api/sessions/audit-all")
async def audit_all_sessions():
    return {"profiles": audit_all_profiles(check_proxies=True)}

@app.get("/api/vault/bundle")
async def get_vault_bundle():
    return export_vault_bundle()

@app.post("/api/vault/bundle")
async def post_vault_bundle(payload: Dict[str, Any]):
    try:
        return import_vault_bundle(payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/sessions/inspect")
async def inspect_selectors(req: InspectSelectorsRequest):
    return await inspect_platform_selectors(
        account_id=req.account_id,
        platform_id=req.platform,
        custom_url=req.custom_url,
        headless=req.headless,
    )

@app.get("/api/previews/{filename}")
async def get_preview_screenshot(filename: str):
    if not re.fullmatch(r"[a-zA-Z0-9._-]+\.png", filename):
        raise HTTPException(status_code=400, detail="Invalid preview filename")
    target = (PREVIEWS_DIR / filename).resolve()
    if target.parent != PREVIEWS_DIR.resolve() or not target.exists():
        raise HTTPException(status_code=404, detail="Preview screenshot not found")
    return FileResponse(str(target), media_type="image/png")

@app.get("/api/selectors/{platform_id}")
async def get_selectors_recipe(platform_id: str):
    return {"platform_id": platform_id, "recipe": get_platform_recipe(platform_id)}


@app.post("/api/compliance/confirm-2257")
async def confirm_2257(req: Confirm2257Request):
    PENDING_COMPLIANCE[req.job_id] = {
        "confirmed": True,
        "records_id": req.records_id,
        "signature": req.custodian_signature,
    }
    return {"status": "confirmed", "job_id": req.job_id}

@app.post("/api/upload")
async def handle_upload(payload: UploadJobPayload):
    # Check if pre-confirmed via compliance endpoint
    if payload.job_id in PENDING_COMPLIANCE:
        payload.confirmed_2257_attestation = True
        payload.records_id_2257 = PENDING_COMPLIANCE[payload.job_id]["records_id"]

    uploader = ModularBrowserUploader(payload)
    try:
        result = await uploader.execute()
        return result
    except ComplianceVerificationRequiredException as ce:
        raise HTTPException(
            status_code=428,  # Precondition Required
            detail={"error": "COMPLIANCE_CONFIRMATION_REQUIRED", "message": str(ce)},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
