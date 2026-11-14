from abc import ABC, abstractmethod
from typing import Any, Dict, Optional
from pydantic import BaseModel

from ..config import load_settings


class ComplianceVerificationRequiredException(Exception):
    """Raised when 2257 compliance confirmation is required from the user before proceeding."""
    pass


class UploadJobPayload(BaseModel):
    job_id: str
    account_id: str
    platform_id: str
    file_path: str
    title: str
    description: str = ""
    tags: list[str] = []
    category: str = "General"
    watermark_path: Optional[str] = None
    confirmed_2257_attestation: bool = False
    records_id_2257: Optional[str] = None
    dry_run: bool = False
    auto_submit: bool = True
    extra_params: Dict[str, Any] = {}


class BaseUploader(ABC):
    def __init__(self, payload: UploadJobPayload):
        self.payload = payload
        self.settings = load_settings()

    def verify_compliance_gate(self, requires_adult_taxonomy: bool):
        if not requires_adult_taxonomy:
            return

        if self.settings.compliance.require_user_confirmation_for_2257:
            if not self.payload.confirmed_2257_attestation:
                raise ComplianceVerificationRequiredException(
                    f"Platform '{self.payload.platform_id}' requires 2257 record keeping attestation. "
                    f"User confirmation flag (confirmed_2257_attestation=true) is mandatory before form submission."
                )

    @abstractmethod
    async def execute(self) -> Dict[str, Any]:
        """Perform the automated or assisted upload workflow."""
        pass
