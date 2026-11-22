import json
from pathlib import Path
import re
import subprocess
import tomllib

ROOT = Path(__file__).resolve().parents[2]


def test_fork_identity_and_backend_contract():
    conf = json.loads((ROOT / "src-tauri/tauri.conf.json").read_text(encoding="utf-8"))
    # The installer's title, install folder, shortcuts, the Apps list and the executable's
    # version information show productName (Issue #535). The executable moved with its own step of
    # ADR-014 (2.5 and 2.6): the installer replaces vrct-vox.exe, and the window class follows it.
    assert conf["productName"] == "ASTAROT"
    assert conf["mainBinaryName"] == "astarot"
    # The app ID moved with the desktop integration's migration (ADR-014, 2.6): Tauri's data
    # folder, the portals' app id and the desktop file follow it.
    assert conf["identifier"] == "io.github.kein5.astarot"
    assert conf["bundle"]["publisher"] == "kein5"
    assert "m's software" in conf["bundle"]["copyright"]
    # The window title is the display name (ADR-011 P1).
    assert conf["app"]["windows"][0]["title"] == "ASTAROT"
    # The backend runs inside the app: no program ships beside it and the UI starts none.
    assert "externalBin" not in conf["bundle"]
    assert conf["bundle"]["resources"] == {"bin/_internal": "_internal"}
    controller = (ROOT / "src-ui/views/app/_app_controllers/StartPythonController.tsx").read_text(encoding="utf-8")
    assert "Command.sidecar" not in controller and "plugin-shell" not in controller
    assert "createCoreBackendCommand" in controller


def test_build_metadata_and_launchers_agree_on_renamed_binaries():
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    lock = json.loads((ROOT / "package-lock.json").read_text(encoding="utf-8"))
    cargo = tomllib.loads((ROOT / "src-tauri/Cargo.toml").read_text(encoding="utf-8"))
    cargo_lock = tomllib.loads((ROOT / "src-tauri/Cargo.lock").read_text(encoding="utf-8"))
    # The packages are astarot (ADR-014, PR 12), and so is the executable (PR 6).
    assert package["name"] == lock["name"] == lock["packages"][""]["name"] == cargo["package"]["name"] == "astarot"
    assert any(p["name"] == "astarot" and p["version"] == cargo["package"]["version"] for p in cargo_lock["package"])
    conf = json.loads((ROOT / "src-tauri/tauri.conf.json").read_text(encoding="utf-8"))
    assert [b["name"] for b in cargo["bin"]] == ["astarot"] == [conf["mainBinaryName"]]
    desktop = (ROOT / "packaging/appimage/astarot.desktop").read_text(encoding="utf-8")
    # Name is only shown in menus (ADR-011 P1); the file name, Exec, Icon and StartupWMClass identify the app.
    # Exec and StartupWMClass follow the executable (ADR-014, 2.6); the file name and the icon are
    # the Linux package's (2.7). All of them are astarot from 0.7.0.
    assert not (ROOT / "packaging/appimage/vrct-vox.desktop").exists()
    assert "Name=ASTAROT\n" in desktop and "Exec=astarot\n" in desktop
    assert "Icon=astarot\n" in desktop and "StartupWMClass=astarot\n" in desktop
    # The AppImage starts the GUI only; the backend core runs inside it.
    assert not (ROOT / "packaging/appimage/sidecar").exists()
    assert not (ROOT / "spec").exists(), "no PyInstaller build is left"


def test_windows_installer_identity_finds_previous_install_location():
    script = (ROOT / "src-tauri/nsis/template.nsi").read_text(encoding="utf-8")
    # ADR-014, 2.5: the keys moved to ASTAROT; an install recorded under VRCT-VOX is still found.
    assert '!define INSTALLREGNAME "ASTAROT"' in script
    assert '!define OLDINSTALLREGNAME "VRCT-VOX"' in script
    assert 'Uninstall\\${INSTALLREGNAME}"' in script
    assert 'Software\\${MANUFACTURER}\\${INSTALLREGNAME}"' in script
    assert 'Uninstall\\${OLDINSTALLREGNAME}"' in script
    assert 'Software\\${MANUFACTURER}\\${OLDINSTALLREGNAME}"' in script
    assert 'WriteRegStr SHCTX "${UNINSTKEY}" "DisplayName" "${PRODUCTNAME}"' in script
    install = script[script.index("\nSection Install\n"):script.index("SectionEnd", script.index("\nSection Install\n"))]
    assert 'Delete "$INSTDIR\\config.json"' not in install


def test_installer_never_skips_the_package_checksum():
    script = (ROOT / "src-tauri/nsis/template.nsi").read_text(encoding="utf-8")
    assert '"HTTP|404"' not in script
    assert "size-only" not in script


def test_installer_downloads_belong_to_fork():
    # The app's own release URLs are checked by native/core/tests/updates.rs.
    script = (ROOT / "src-tauri/nsis/template.nsi").read_text(encoding="utf-8")
    assert "ms-software/VRCT" not in script
    assert "https://github.com/kein5/astarot/releases/download/" in script


# The old name kein5/VRCT-VOX is now a repository of its own that keeps only a copy of the 0.5.0
# release (Issue #534), so GitHub no longer forwards it. Shipped code and the release workflow
# must name the current repository, or downloads newer than 0.5.0 return 404.
OLD_REPOSITORY = re.compile(r"(github\.com|repos)/kein5/VRCT-VOX\b", re.IGNORECASE)
SHIPPED = ("src-tauri", "native", "src-ui", "spec", "bat")
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
    # One Windows package since #288; VRCT-VOX_cuda.zip was released up to 0.5. It is ASTAROT.zip
    # from 0.7.0 (ADR-014, 2.10); tools/release_candidate.py adds the copy under the old name.
    assert "ASTAROT.zip" in text and "VRCT-VOX.zip" not in text and "_cuda.zip" not in text
