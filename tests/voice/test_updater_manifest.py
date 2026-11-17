"""latest.json for the in-app updater (issue #330): what the release draft job writes."""

import base64
import datetime
import hashlib
import json

import pytest

from tools import updater_manifest
from tools.updater_manifest import ManifestError, public_key, write

VERSION = "0.4.0"
APPIMAGE = f"VRCT-VOX-{VERSION}-linux-x64-vulkan-release.AppImage"
NOW = datetime.datetime(2026, 11, 15, 12, 0, tzinfo=datetime.timezone.utc)


def _line(data):
    return base64.b64encode(data).decode("ascii")


class Key:
    """A throwaway minisign key, signing the way `tauri signer sign --app-version` does."""

    def __init__(self, key_id=b"\x11" * 8):
        ed25519 = pytest.importorskip("cryptography.hazmat.primitives.asymmetric.ed25519")
        from cryptography.hazmat.primitives import serialization
        self.private = ed25519.Ed25519PrivateKey.generate()
        raw = self.private.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
        self.key_id = key_id
        self.pair = (key_id, raw)

    def sign(self, path, version):
        signature = self.private.sign(hashlib.blake2b(path.read_bytes(), digest_size=64).digest())
        trusted = f"timestamp:1\tfile:{path.name}\tversion:{version}"
        global_signature = self.private.sign(signature + trusted.encode())
        text = "\n".join([
            "untrusted comment: signature from tauri secret key",
            _line(b"ED" + self.key_id + signature),
            "trusted comment: " + trusted,
            _line(global_signature),
        ]) + "\n"
        path.with_name(path.name + ".sig").write_text(_line(text.encode()), encoding="ascii")


@pytest.fixture
def payload(tmp_path):
    for name in ("VRCT-VOX_setup.exe", APPIMAGE, "VRCT-VOX.zip"):
        (tmp_path / name).write_bytes(name.encode() * 64)
    return tmp_path


def sign_all(key, payload, version=VERSION):
    key.sign(payload / "VRCT-VOX_setup.exe", version)
    key.sign(payload / APPIMAGE, version)


def test_the_app_key_is_the_release_key():
    key_id, raw = public_key()
    # The ID minisign prints, little-endian in the key.
    assert key_id[::-1].hex().upper() == "1178836E5C9F510B"
    assert len(raw) == 32


def test_latest_json_points_at_the_release_files(payload):
    key = Key()
    sign_all(key, payload)
    manifest = write(payload, VERSION, now=NOW, key=key.pair, require_verification=True)
    assert manifest["version"] == VERSION
    assert manifest["pub_date"] == "2026-11-15T12:00:00Z"
    base = f"https://github.com/kein5/astarot/releases/download/v{VERSION}/"
    assert manifest["platforms"]["windows-x86_64"]["url"] == base + "VRCT-VOX_setup.exe"
    assert manifest["platforms"]["linux-x86_64"]["url"] == base + APPIMAGE
    assert json.loads((payload / "latest.json").read_text()) == manifest
    # The signatures moved into latest.json; the draft carries no loose .sig files.
    assert not list(payload.glob("*.sig"))


def test_a_signature_from_another_key_stops_the_draft(payload):
    sign_all(Key(key_id=b"\x22" * 8), payload)
    with pytest.raises(ManifestError, match="TAURI_SIGNING_PRIVATE_KEY"):
        write(payload, VERSION, key=Key().pair)
    assert not (payload / "latest.json").exists()


def test_a_forged_signature_with_the_right_key_id_stops_the_draft(payload):
    key = Key()
    sign_all(Key(), payload)  # same default key ID, other key
    with pytest.raises(ManifestError, match="does not verify"):
        write(payload, VERSION, key=key.pair)


def test_the_signature_has_to_name_this_version(payload):
    key = Key()
    sign_all(key, payload, version="0.3.0")
    with pytest.raises(ManifestError, match="does not name version 0.4.0"):
        write(payload, VERSION, key=key.pair)


def test_unsigned_or_missing_files_stop_the_draft(payload):
    key = Key()
    key.sign(payload / "VRCT-VOX_setup.exe", VERSION)
    with pytest.raises(ManifestError, match="has no .sig"):
        write(payload, VERSION, key=key.pair)
    (payload / APPIMAGE).unlink()
    with pytest.raises(ManifestError, match="exactly one AppImage"):
        write(payload, VERSION, key=key.pair)


def test_without_cryptography_the_key_and_version_are_still_checked(payload, monkeypatch):
    key = Key()
    sign_all(key, payload)
    monkeypatch.setattr(updater_manifest, "_ed25519", lambda: None)
    with pytest.raises(ManifestError, match="cryptography"):
        write(payload, VERSION, key=key.pair, require_verification=True)
    assert write(payload, VERSION, key=key.pair)["platforms"]
