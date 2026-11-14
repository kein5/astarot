"""Model-specific review and consent for the built-in download handlers.

The fingerprint covers all pinned files, the bundled tokenizer source and
the displayed license. A saved selection or the startup switch is not consent.
"""
import hashlib
import json
from threading import Lock

from models.builtin_model_pins import MODEL_PINS, tokenizerFilePins
from models.translation.translation_utils import ctranslate2_weights

_CONSENT_LOCK = Lock()


def legacyModelReview(kind: str, weight_type: str) -> dict:
    # The built-in Whisper weights were the other kind until the local Whisper engine was
    # removed (#288); speech.cpp models go through models/model_downloads instead.
    if kind == "ctranslate2":
        weight = ctranslate2_weights[weight_type]
        repo = weight["hf_repo"]
        license_name = weight["license"]
        restricted = weight["commercial_use"] is False
        pin = MODEL_PINS[repo]
        tokenizer = {
            "repo": repo, "revision": pin["revision"], "bundled": True,
            "files": tokenizerFilePins(repo),
        }
        name = f"CTranslate2 {weight_type}"
    else:
        raise KeyError(kind)
    pin = MODEL_PINS[repo]
    entry = {
        "id": f"{kind}:{weight_type}", "kind": kind, "weight_type": weight_type,
        "name": name, "provider": repo.split("/")[0], "repo": repo,
        "revision": pin["revision"], "license": license_name,
        "non_commercial": restricted, "files": pin["files"], "tokenizer": tokenizer,
    }
    entry["manifest_version"] = hashlib.sha256(
        json.dumps(entry, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    entry["total_bytes"] = sum(size for size, _ in pin["files"].values())
    entry["tokenizer_size_unknown"] = False
    return entry


def legacyModelCatalog() -> list:
    return [legacyModelReview("ctranslate2", weight) for weight in ctranslate2_weights]


def consentedLegacyRequest(config, kind: str, weight_type: str):
    """Build a startup request only for consent recorded for the current manifest."""
    entry = legacyModelReview(kind, weight_type)
    if getattr(config, "LEGACY_MODEL_DOWNLOAD_CONSENTS", {}).get(entry["id"]) != entry["manifest_version"]:
        return None
    return {"weight_type": weight_type, "consent": True, "manifest_version": entry["manifest_version"]}


def recordLegacyConsent(config, kind: str, data) -> bool:
    if not isinstance(data, dict) or data.get("consent") is not True:
        return False
    try:
        entry = legacyModelReview(kind, data.get("weight_type"))
    except (KeyError, TypeError):
        return False
    if data.get("manifest_version") != entry["manifest_version"]:
        return False
    with _CONSENT_LOCK:
        config.LEGACY_MODEL_DOWNLOAD_CONSENTS = {
            **getattr(config, "LEGACY_MODEL_DOWNLOAD_CONSENTS", {}),
            entry["id"]: entry["manifest_version"],
        }
    return True
