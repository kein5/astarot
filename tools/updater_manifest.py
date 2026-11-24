"""Write latest.json for the Tauri updater from a signed release draft payload (issue #330).

    python -m tools.updater_manifest --payload build/release-draft/payload --version 0.4.0

The release draft job signs ASTAROT_setup.exe and the AppImage (ASTAROT-<version>-linux-x64-release
.AppImage) with `tauri signer sign --app-version <version>` first; each gets a `.sig` beside it.
latest.json names these files only, never their copies under the names up to 0.6.x
(tools/release_candidate.py, ADR-014 2.10). This writes latest.json into the
payload, pointing at the files where the published release will serve them, and removes the
`.sig` files, whose contents are now in latest.json.

Before writing, every signature is checked against the public key the app carries
(src-tauri/tauri.conf.json): the key ID has to match, and the signed trusted comment has to name
this version, because the app requires that (`requireSignedVersion`). When the `cryptography`
package is present the Ed25519 signatures themselves are verified too; `--require-verification`
makes its absence an error. A signature from another key, or for another version, stops the
draft instead of shipping an update every user would refuse.
"""

import argparse
import base64
import datetime
import hashlib
import json
from pathlib import Path

from tools.release_candidate import REPOSITORY, ROOT, WINDOWS_INSTALLER, linux_stem

WINDOWS_ASSET = WINDOWS_INSTALLER
MANIFEST = "latest.json"


class ManifestError(ValueError):
    pass


def _b64(text, what):
    try:
        return base64.b64decode(text.strip(), validate=True)
    except ValueError as error:
        raise ManifestError(f"{what} is not base64") from error


def public_key(config_path=ROOT / "src-tauri" / "tauri.conf.json"):
    """(key ID, 32-byte Ed25519 key) of the updater public key in tauri.conf.json."""
    config = json.loads(Path(config_path).read_text(encoding="utf-8"))
    encoded = config.get("plugins", {}).get("updater", {}).get("pubkey", "")
    if not encoded:
        raise ManifestError("tauri.conf.json carries no updater public key")
    lines = _b64(encoded, "The public key").decode("utf-8").splitlines()
    raw = _b64(lines[1], "The public key line") if len(lines) >= 2 else b""
    if len(raw) != 42 or raw[:2] != b"Ed":
        raise ManifestError("The updater public key is not a minisign Ed25519 key")
    return raw[2:10], raw[10:]


def parse_signature(sig_text):
    """The parts of a Tauri `.sig` file: base64 of a minisign signature file."""
    lines = _b64(sig_text, "The signature").decode("utf-8").splitlines()
    if len(lines) < 4 or not lines[2].startswith("trusted comment: "):
        raise ManifestError("The signature is not a minisign signature file")
    raw = _b64(lines[1], "The signature line")
    if len(raw) != 74:
        raise ManifestError("The signature line has the wrong length")
    trusted = lines[2].removeprefix("trusted comment: ")
    return dict(
        algorithm=raw[:2], key_id=raw[2:10], signature=raw[10:], trusted_comment=trusted,
        global_signature=_b64(lines[3], "The global signature"),
    )


def signed_version(trusted_comment):
    """The version `tauri signer sign --app-version` records; the app reads it the same way."""
    for field in trusted_comment.split("\t"):
        if field.startswith("version:"):
            return field.removeprefix("version:")
    return None


def _ed25519():
    try:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    except ImportError:
        return None
    return Ed25519PublicKey


def check_signature(path, sig_text, version, key, require_verification=False):
    key_id, key_bytes = key
    parts = parse_signature(sig_text)
    if parts["key_id"] != key_id:
        raise ManifestError(
            f"{path.name} was signed with key {parts['key_id'][::-1].hex().upper()}, "
            f"not the app's key {key_id[::-1].hex().upper()}: check the TAURI_SIGNING_PRIVATE_KEY secret"
        )
    if parts["algorithm"] != b"ED":
        raise ManifestError(f"{path.name}: expected a prehashed (ED) minisign signature")
    if signed_version(parts["trusted_comment"]) != version:
        raise ManifestError(f"{path.name}: the signature does not name version {version}")
    verifier = _ed25519()
    if verifier is None:
        if require_verification:
            raise ManifestError("The cryptography package is needed to verify the signatures")
        print(f"{path.name}: key ID and version checked; Ed25519 not verified (no cryptography package)")
        return False
    public = verifier.from_public_bytes(key_bytes)
    digest = hashlib.blake2b(path.read_bytes(), digest_size=64).digest()
    try:
        public.verify(parts["signature"], digest)
        public.verify(parts["global_signature"], parts["signature"] + parts["trusted_comment"].encode("utf-8"))
    except Exception as error:  # cryptography raises InvalidSignature
        raise ManifestError(f"{path.name}: the signature does not verify with the app's key") from error
    print(f"{path.name}: signature verified")
    return True


def linux_asset(version):
    return linux_stem(version) + ".AppImage"


def updater_files(payload, version):
    """{platform key: file} the app reads from latest.json (src-tauri/src/app_update.rs)."""
    windows = payload / WINDOWS_ASSET
    appimage = payload / linux_asset(version)
    if not windows.is_file():
        raise ManifestError(f"The payload has no {WINDOWS_ASSET}")
    if not appimage.is_file():
        raise ManifestError(f"The payload has no {appimage.name}")
    return {"windows-x86_64": windows, "linux-x86_64": appimage}


def write(payload, version, now=None, key=None, require_verification=False):
    payload = Path(payload)
    key = key or public_key()
    platforms = {}
    for platform, path in updater_files(payload, version).items():
        sig = path.with_name(path.name + ".sig")
        if not sig.is_file():
            raise ManifestError(f"{path.name} has no .sig: sign it with tauri signer sign --app-version")
        sig_text = sig.read_text(encoding="ascii").strip()
        check_signature(path, sig_text, version, key, require_verification)
        platforms[platform] = dict(
            signature=sig_text,
            url=f"https://github.com/{REPOSITORY}/releases/download/v{version}/{path.name}",
        )
    now = now or datetime.datetime.now(datetime.timezone.utc)
    manifest = dict(
        version=version,
        notes=f"https://github.com/{REPOSITORY}/releases/tag/v{version}",
        pub_date=now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        platforms=platforms,
    )
    (payload / MANIFEST).write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    for path in updater_files(payload, version).values():
        path.with_name(path.name + ".sig").unlink()
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--payload", type=Path, required=True)
    parser.add_argument("--version")
    parser.add_argument("--require-verification", action="store_true")
    args = parser.parse_args()
    version = args.version or json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
    manifest = write(args.payload, version, require_verification=args.require_verification)
    print(json.dumps({key: value for key, value in manifest.items() if key != "platforms"}, indent=2))
    print("platforms:", ", ".join(manifest["platforms"]))


if __name__ == "__main__":
    main()
