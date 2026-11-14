import base64
import hashlib
import hmac
import json
import os
from typing import Any, Dict, Optional

from .config import reload_root_env_if_changed

def _derive_keys(secret: str) -> tuple[bytes, bytes]:
    master = hashlib.sha256(secret.encode("utf-8")).digest()
    enc_key = hmac.new(master, b"encryption-key-polypost", hashlib.sha256).digest()
    mac_key = hmac.new(master, b"authentication-key-polypost", hashlib.sha256).digest()
    return enc_key, mac_key

def _keystream(enc_key: bytes, iv: bytes, length: int) -> bytes:
    stream = bytearray()
    counter = 0
    while len(stream) < length:
        block = hmac.new(enc_key, iv + counter.to_bytes(4, "big"), hashlib.sha256).digest()
        stream.extend(block)
        counter += 1
    return bytes(stream[:length])

def encrypt_data(data: Any, secret: Optional[str] = None) -> Dict[str, Any]:
    reload_root_env_if_changed()
    key = secret or os.environ.get("POLYPOST_SECRET_KEY")
    if not key:
        return data

    serialized = json.dumps(data).encode("utf-8")
    enc_key, mac_key = _derive_keys(key)
    iv = os.urandom(16)
    ks = _keystream(enc_key, iv, len(serialized))
    ciphertext = bytes(a ^ b for a, b in zip(serialized, ks))
    mac = hmac.new(mac_key, iv + ciphertext, hashlib.sha256).hexdigest()

    return {
        "__polypost_encrypted__": True,
        "iv": iv.hex(),
        "mac": mac,
        "ciphertext": ciphertext.hex(),
    }

def decrypt_data(data: Any, secret: Optional[str] = None) -> Any:
    if not isinstance(data, dict) or not data.get("__polypost_encrypted__"):
        return data

    reload_root_env_if_changed()
    key = secret or os.environ.get("POLYPOST_SECRET_KEY")
    if not key:
        raise ValueError("Cannot decrypt profile: POLYPOST_SECRET_KEY is not configured.")

    enc_key, mac_key = _derive_keys(key)
    iv = bytes.fromhex(data["iv"])
    ciphertext = bytes.fromhex(data["ciphertext"])
    expected_mac = hmac.new(mac_key, iv + ciphertext, hashlib.sha256).hexdigest()

    if not hmac.compare_digest(data["mac"], expected_mac):
        raise ValueError("Integrity check failed: invalid MAC signature on encrypted profile.")

    ks = _keystream(enc_key, iv, len(ciphertext))
    plaintext = bytes(a ^ b for a, b in zip(ciphertext, ks))
    return json.loads(plaintext.decode("utf-8"))
