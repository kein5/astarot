import asyncio
import importlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tomllib
from types import SimpleNamespace
from unittest.mock import Mock

ROOT = Path(__file__).resolve().parents[2]


def test_fork_identity_and_backend_contract():
    conf = json.loads((ROOT / "src-tauri/tauri.conf.json").read_text(encoding="utf-8"))
    # The installer's title, install folder, shortcuts, the Apps list and the executable's
    # version information show productName (Issue #535). The identifiers below stay.
    assert conf["productName"] == "ASTAROT"
    assert conf["mainBinaryName"] == "vrct-vox"
    # Changing it moves Tauri data and desktop integration (portal, app id).
    assert conf["identifier"] == "io.github.kein5.vrct-vox"
    assert conf["bundle"]["publisher"] == "kein5"
    assert "m's software" in conf["bundle"]["copyright"]
    # The window title is the display name (ADR-011 P1).
    assert conf["app"]["windows"][0]["title"] == "ASTAROT"
    # The backend runs inside the app: no program ships beside it and the UI starts none.
    assert "externalBin" not in conf["bundle"]
    assert conf["bundle"]["resources"] == {"bin/_internal": "_internal"}
    controller = (ROOT / "src-ui/views/app/_app_controllers/StartPythonController.jsx").read_text(encoding="utf-8")
    assert "Command.sidecar" not in controller and "plugin-shell" not in controller
    assert "createCoreBackendCommand" in controller


def test_build_metadata_and_launchers_agree_on_renamed_binaries():
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    lock = json.loads((ROOT / "package-lock.json").read_text(encoding="utf-8"))
    cargo = tomllib.loads((ROOT / "src-tauri/Cargo.toml").read_text(encoding="utf-8"))
    cargo_lock = tomllib.loads((ROOT / "src-tauri/Cargo.lock").read_text(encoding="utf-8"))
    assert package["name"] == lock["name"] == lock["packages"][""]["name"] == cargo["package"]["name"] == "vrct-vox"
    assert any(p["name"] == "vrct-vox" and p["version"] == cargo["package"]["version"] for p in cargo_lock["package"])
    desktop = (ROOT / "packaging/appimage/vrct-vox.desktop").read_text(encoding="utf-8")
    # Name is only shown in menus (ADR-011 P1); the file name, Exec, Icon and StartupWMClass identify the app.
    assert "Name=ASTAROT\n" in desktop and "Exec=vrct-vox\n" in desktop
    assert "Icon=vrct-vox\n" in desktop and "StartupWMClass=vrct-vox\n" in desktop
    # The AppImage starts the GUI only; the backend core runs inside it.
    assert not (ROOT / "packaging/appimage/sidecar").exists()
    assert not (ROOT / "spec").exists(), "no PyInstaller build is left"


def test_windows_installer_identity_finds_previous_install_location():
    script = (ROOT / "src-tauri/nsis/template.nsi").read_text(encoding="utf-8")
    assert '!define INSTALLREGNAME "VRCT-VOX"' in script
    assert 'Uninstall\\${INSTALLREGNAME}"' in script
    assert 'Software\\${MANUFACTURER}\\${INSTALLREGNAME}"' in script
    assert 'WriteRegStr SHCTX "${UNINSTKEY}" "DisplayName" "${PRODUCTNAME}"' in script
    install = script[script.index("\nSection Install\n"):script.index("SectionEnd", script.index("\nSection Install\n"))]
    assert 'Delete "$INSTDIR\\config.json"' not in install


def test_installer_never_skips_the_package_checksum():
    script = (ROOT / "src-tauri/nsis/template.nsi").read_text(encoding="utf-8")
    assert '"HTTP|404"' not in script
    assert "size-only" not in script


def test_upstream_telemetry_stays_unused_even_with_stale_upstream_key(monkeypatch):
    # Deliberately simulate an ignored key file left behind by an old build.
    # VRCT-VOX has usage events of its own now; upstream's key and SDK must still never be used.
    sdk = Mock()
    monkeypatch.setitem(sys.modules, "telemetry_keys", SimpleNamespace(APP_KEYS={"stable": "test", "beta": "test"}))
    monkeypatch.setitem(sys.modules, "aptabase", SimpleNamespace(Aptabase=sdk))
    import models.telemetry.client as client
    importlib.reload(client)
    assert not hasattr(client, "AptabaseWrapper")
    # A closed port on this PC: the event goes nowhere, and never to upstream.
    wrapper = client.IngestClient(endpoint="http://127.0.0.1:9/v1/events", timeout=0.5)
    async def lifecycle():
        await wrapper.start("test", "ja")
        await wrapper.track("app_started", {})
        await wrapper.stop()
    asyncio.run(lifecycle())
    sdk.assert_not_called()
    source = (ROOT / "src-python/models/telemetry/client.py").read_text(encoding="utf-8")
    assert "import aptabase" not in source and "import telemetry_keys" not in source and "from telemetry_keys" not in source
    assert client.ENDPOINT.startswith("https://vrct-vox-telemetry.") and "aptabase" not in client.ENDPOINT


def test_download_sources_belong_to_fork():
    from config import config
    assert "/repos/kein5/astarot/releases" in config.GITHUB_URL
    assert "/repos/kein5/astarot/releases" in config.GITHUB_RELEASES_LIST_URL
    assert config.setupDownloadUrl("3.6.0", tag="v3.6.0") == "https://github.com/kein5/astarot/releases/download/v3.6.0/VRCT-VOX_setup.exe"
    script = (ROOT / "src-tauri/nsis/template.nsi").read_text(encoding="utf-8")
    assert "ms-software/VRCT" not in script
    assert "https://github.com/kein5/astarot/releases/download/" in script


# The old name kein5/VRCT-VOX is now a repository of its own that keeps only a copy of the 0.5.0
# release (Issue #534), so GitHub no longer forwards it. Shipped code and the release workflow
# must name the current repository, or downloads newer than 0.5.0 return 404.
OLD_REPOSITORY = re.compile(r"(github\.com|repos)/kein5/VRCT-VOX\b", re.IGNORECASE)
SHIPPED = ("src-tauri", "native", "src-ui", "src-python", "spec", "bat")
RELEASE_FILES = (".github/workflows/prepare-release.yml", ".github/workflows/release-draft-auto.yml",
                 ".github/workflows/release-back-merge.yml", "tools/release_candidate.py",
                 "tools/release_automation.py", "tools/updater_manifest.py", "tools/linux_packages.py")


def test_shipped_code_does_not_name_the_old_repository():
    tracked = subprocess.run(["git", "ls-files", "--", *SHIPPED, *RELEASE_FILES], cwd=ROOT,
                             capture_output=True, text=True, check=True).stdout.splitlines()
    offenders = []
    for name in tracked:
        path = ROOT / name
        if path.suffix.lower() in {".png", ".ico", ".icns", ".jpg", ".gif", ".webp", ".onnx", ".wav", ".bin"}:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):  # binaries, submodules and links
            continue
        offenders += [f"{name}:{n}" for n, line in enumerate(text.splitlines(), 1) if OLD_REPOSITORY.search(line)]
    assert offenders == []


def test_release_workflow_cannot_publish_or_inject_upstream_keys():
    import yaml
    workflow = yaml.load((ROOT / ".github/workflows/release.yml").read_text(encoding="utf-8"), Loader=yaml.BaseLoader)
    assert set(workflow["on"]) == {"workflow_dispatch", "pull_request"}
    assert workflow["on"]["pull_request"] == {"branches": ["main"]}
    assert workflow["permissions"] == {"contents": "read"}
    text = json.dumps(workflow)
    for forbidden in ("HF_TOKEN", "TELEMETRY_KEY", "hf upload", "create-release", "upload-release-asset", "ms-software/VRCT"):
        assert forbidden not in text
    assert "--nsis" in text
    # One Windows package since #288; VRCT-VOX_cuda.zip was released up to 0.5.
    assert "VRCT-VOX.zip" in text and "VRCT-VOX_cuda.zip" not in text
