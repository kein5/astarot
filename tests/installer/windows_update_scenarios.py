"""Real NSIS update fault tests. Stdlib only except the separate --mode gui run.

Run --mode prepare only in the disposable CI checkout: it rewrites that checkout's
release URL and makes build stubs. No production URL override is introduced.
"""

import argparse
from contextlib import contextmanager
import ctypes
from hashlib import sha256
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import threading
import time
import zipfile


ROOT = Path(__file__).resolve().parents[2]
RELEASE_URL = "https://github.com/kein5/astarot/releases/download/$release_revision"
APP = "vrct-vox.exe"
# Packages up to 0.4 carried the Python sidecar beside the app; from 0.5.0 they do not. The
# "old" package is such a package: updating it to "new" removes the stale sidecar, while
# installing a package that has one (a downgrade) keeps it.
SIDECAR = "vrct-vox-sidecar.exe"
PACKAGE = "VRCT-VOX.zip"
UNINSTALL_KEY = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\VRCT-VOX"
PRODUCT_KEY = r"Software\kein5\VRCT-VOX"
# No single ANSI code page holds all of these characters.
NON_ANSI_FOLDER = "ユーザー 한글 😀"
ARCHIVE_TIME = (2026, 1, 1, 0, 0, 0)
# The installer's own version. Installing it checks the package against the hashes built into
# the installer (src-tauri/nsis/package-hashes.nsh, written by prepare); other versions check
# the .sha256 file served next to the package.
OWN = json.loads((ROOT / "src-tauri/tauri.conf.json").read_text(encoding="utf-8"))["version"]


def payload_files(version):
    files = {
        APP: f"{version} executable stub".encode(),
        "_internal/shared.txt": f"{version} dependency".encode(),
        f"_internal/{version}-only.txt": f"{version} only".encode(),
        "_internal/nested/padding.bin": bytes(range(256)) * 2048,
    }
    if version == "old":
        files[SIDECAR] = f"{version} sidecar stub".encode()
    return files


def archive_bytes(files):
    """The same files give the same bytes: writestr(name) would stamp the current time."""
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", zipfile.ZIP_STORED) as archive:
        for name, value in files.items():
            archive.writestr(zipfile.ZipInfo(name, date_time=ARCHIVE_TIME), value)
    return stream.getvalue()


def payloads():
    new = payload_files("new")
    good = archive_bytes(new)
    partial = bytearray(good)
    with zipfile.ZipFile(io.BytesIO(good)) as archive:
        info = archive.getinfo("_internal/new-only.txt")
        name_len, extra_len = struct.unpack_from("<HH", good, info.header_offset + 26)
        partial[info.header_offset + 30 + name_len + extra_len] ^= 0xFF
    return {
        "old": archive_bytes(payload_files("old")),
        "new": good,
        "checksum-404": good,
        "invalid-checksum": good,
        "hash-mismatch": good,
        "corrupt": b"This is not an archive.",
        "partial": bytes(partial),
        "no-exe": archive_bytes({k: v for k, v in new.items() if k != APP}),
        "no-internal": archive_bytes({k: v for k, v in new.items() if not k.startswith("_internal/")}),
        "range-fallback": good,
        # Served damaged (one byte changed, same length) the first time only.
        "damaged-once": good,
        OWN: good,
    }


class PackageServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, port):
        super().__init__(("127.0.0.1", port), PackageHandler)
        self.payloads = payloads()
        self.damaged = False
        self.requests = []
        self.request_lock = threading.Lock()


class PackageHandler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_HEAD(self):
        self.respond(head=True)

    def do_GET(self):
        self.respond(head=False)

    def respond(self, head):
        parts = self.path.strip("/").split("/")
        version = parts[0].removeprefix("v")
        range_header = self.headers.get("Range")
        with self.server.request_lock:
            self.server.requests.append({"method": self.command, "path": self.path, "range": range_header})
        if len(parts) != 2 or version not in self.server.payloads:
            self.send_error(404)
            return
        data = self.server.payloads[version]
        if parts[1] == PACKAGE + ".sha256":
            if version == "checksum-404":
                self.send_error(404)
                return
            data = sha256(data).hexdigest().encode()
            if version == "invalid-checksum":
                data = b"invalid"
            elif version == "hash-mismatch":
                data = b"0" * 64
        elif parts[1] != PACKAGE:
            self.send_error(404)
            return
        status, start, end = 200, 0, len(data) - 1
        if range_header:
            if version == "range-fallback" and range_header.startswith("bytes=0-"):
                self.send_error(416)
                return
            bounds = range_header.removeprefix("bytes=").split("-", 1)
            start, end = int(bounds[0]), int(bounds[1]) if bounds[1] else len(data) - 1
            if start > end or end >= len(data):
                self.send_error(416)
                return
            status = 206
        if version == "damaged-once" and parts[1] == PACKAGE and not head:
            with self.server.request_lock:
                damage, self.server.damaged = not self.server.damaged, True
            if damage:
                # The transfer completes and reports OK; only the SHA-256 check can tell.
                data = bytearray(data)
                data[start] ^= 0xFF
                data = bytes(data)
        self.send_response(status)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{len(data)}")
        self.end_headers()
        if not head:
            try:
                # Keep sibling requests alive long enough to require cancellation.
                for offset in range(start, end + 1, 8192):
                    if version == "range-fallback" and range_header:
                        time.sleep(0.2)
                    self.wfile.write(data[offset:min(offset + 8192, end + 1)])
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass


@contextmanager
def serve(port, log):
    server = PackageServer(port)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
        log.write_text(json.dumps(server.requests, indent=2), encoding="utf-8")


def snapshot(directory):
    """Include empty directories as well as every file's path and hash."""
    return {p.relative_to(directory).as_posix(): "directory" if p.is_dir() else sha256(p.read_bytes()).hexdigest()
            for p in sorted(directory.rglob("*"))}


def assert_tree(directory, expected):
    actual = snapshot(directory)
    assert actual == expected, json.dumps({
        "missing": sorted(expected.keys() - actual.keys()),
        "extra": sorted(actual.keys() - expected.keys()),
        "changed": sorted(k for k in actual.keys() & expected.keys() if actual[k] != expected[k]),
    }, indent=2)
    assert not (directory / ".upd").exists(), "Transaction work folder was retained"


def prepare(port):
    template = ROOT / "src-tauri/nsis/template.nsi"
    source = template.read_text(encoding="utf-8")
    assert source.count(RELEASE_URL) == 1, "Run prepare exactly once in a disposable checkout"
    template.write_text(source.replace(RELEASE_URL, f"http://127.0.0.1:{port}/$release_revision"), encoding="utf-8")
    # The hash of the package served for the installer's own version, as release.yml builds in.
    released = sha256(payloads()[OWN]).hexdigest()
    (ROOT / "src-tauri/nsis/package-hashes.nsh").write_text(
        f'!define PACKAGE_SHA256_CPU "{released}"\n!define PACKAGE_SHA256_GPU "{released}"\n', encoding="ascii")
    for name, data in {
        "dist/index.html": b"<!doctype html><title>Installer test stub</title>",
        "src-tauri/bin/_internal/stub.txt": b"resource build stub",
    }.items():
        path = ROOT / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)


def installer_command(installer, directory, version, silent=True, extra=""):
    # NSIS requires /D last, without quotes even when its value contains spaces.
    flags = "/S " if silent else ""
    return f'"{installer}" {flags}/NS /UILANG=en /VERSION={version} {extra}/D={directory}'


def installer_environment(temp):
    temp.mkdir(parents=True, exist_ok=True)
    return dict(os.environ, TEMP=str(temp), TMP=str(temp))


def run_install(installer, directory, version, temp, success, extra=""):
    result = subprocess.run(installer_command(installer, directory, version, extra=extra),
                            env=installer_environment(temp), timeout=180, check=False)
    assert result.returncode == (0 if success else 2), f"{version}: exit {result.returncode}"
    assert not list(temp.glob(PACKAGE + ".p*")), "Background transfer fragments remain"
    assert not (temp / PACKAGE).exists(), "Downloaded archive was not removed"
    assert not (temp / (PACKAGE + ".sha256")).exists(), "Checksum sidecar remains"


def add_user_data(directory):
    for name, value in {
        "config.json": '{"ui":"日本語","keep":true}',
        "weights/custom/model.bin": "private weights",
        "logs/session.log": "private log",
        "telemetry_state.json": '{"enabled":false}',
        "user.log": "keep log",
        "update.exe": "legacy updater",
    }.items():
        path = directory / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value, encoding="utf-8")
    (directory / "weights/empty").mkdir()


def expect_updated(directory, before):
    expected = {k: v for k, v in before.items()
                if k not in (APP, SIDECAR, "update.exe", "_internal") and not k.startswith("_internal/")}
    for name, value in payload_files("new").items():
        expected[name] = sha256(value).hexdigest()
        for parent in Path(name).parents:
            if str(parent) != ".":
                expected[parent.as_posix()] = "directory"
    assert (directory / "uninstall.exe").is_file()
    expected["uninstall.exe"] = sha256((directory / "uninstall.exe").read_bytes()).hexdigest()
    assert_tree(directory, expected)


@contextmanager
def hold_file(path):
    from ctypes import wintypes
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                                  wintypes.LPVOID, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
    kernel.CreateFileW.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.CreateFileW(str(path), 0x80000000, 3, None, 3, 0, None)  # no FILE_SHARE_DELETE
    if handle == wintypes.HANDLE(-1).value:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        yield
    finally:
        kernel.CloseHandle(handle)


def interrupted_commit(directory, checkpoint):
    work = directory / ".upd"
    for name in ("new", "old", "add", "discard"):
        (work / name).mkdir(parents=True)
    (work / "committing").touch()
    if checkpoint == "marker":
        return
    for name in ("uninstall.exe", "update.exe"):
        (directory / name).rename(work / "old" / name)
    if checkpoint == "uninstallers":
        return
    (directory / APP).rename(work / "old" / APP)
    if checkpoint == "exe-backup":
        return
    (directory / APP).write_bytes(payload_files("new")[APP])
    if checkpoint == "exe-replaced":
        return
    (directory / "_internal").rename(work / "old/_internal")
    (directory / "_internal").mkdir()
    (directory / "_internal/new-only.txt").write_bytes(b"interrupted")
    # Simulate a package entry absent from the old install.
    (work / "add/added.dll").touch()
    if checkpoint != "add-recorded":
        (directory / "added.dll").write_bytes(b"added")
    if checkpoint == "rollback-started":
        (directory / "added.dll").rename(work / "discard/added.dll")
        # Marker still present: rerunning rollback must tolerate this point.


def silent_scenarios(installer, work, server):
    baseline = work / "fresh install"
    run_install(installer, baseline, "old", work / "temp-fresh", True)
    for name, data in payload_files("old").items():
        assert (baseline / name).read_bytes() == data
    assert (baseline / "uninstall.exe").is_file()
    expected_fresh = {name: sha256(value).hexdigest() for name, value in payload_files("old").items()}
    expected_fresh.update({"_internal": "directory", "_internal/nested": "directory",
                          "uninstall.exe": sha256((baseline / "uninstall.exe").read_bytes()).hexdigest(),
                          "installer_language.txt": sha256(b"").hexdigest()})
    assert_tree(baseline, expected_fresh)
    print("PASS fresh install", flush=True)
    add_user_data(baseline)
    before = snapshot(baseline)

    def clone(name):
        directory = work / name
        shutil.copytree(baseline, directory)
        return directory

    updated = clone("update success")
    run_install(installer, updated, "new", work / "temp-success", True)
    expect_updated(updated, before)
    print("PASS update success and user data retention", flush=True)

    # The in-app updater (src-tauri/src/app_update.rs) adds /UPDATE and the edition. The app's
    # language setting stays: no installer_language.txt for the app to apply at start.
    directory = clone("in-app update")
    (directory / "installer_language.txt").unlink()
    run_install(installer, directory, "new", work / "temp-in-app", True, extra="/UPDATE /EDITION=cpu ")
    expect_updated(directory, {k: v for k, v in before.items() if k != "installer_language.txt"})
    print("PASS in-app update keeps the language setting", flush=True)

    # The installer's own version: the package is checked against the built-in hash, and the
    # .sha256 file next to it is not even fetched.
    directory = clone("built-in hash")
    run_install(installer, directory, OWN, work / "temp-built-in", True)
    expect_updated(directory, before)
    with server.request_lock:
        fetched = [request["path"] for request in server.requests if request["path"].startswith(f"/v{OWN}/")]
    assert fetched and not any(path.endswith(".sha256") for path in fetched), fetched
    print("PASS own version checked against the built-in hash", flush=True)

    # Someone who can replace release files swaps the package and its .sha256 together. The
    # published checksum matches the swapped package; the built-in hash does not.
    released = server.payloads[OWN]
    server.payloads[OWN] = archive_bytes(payload_files("old"))
    try:
        directory = clone("replaced package and checksum")
        run_install(installer, directory, OWN, work / "temp-replaced", False)
        assert_tree(directory, before)
    finally:
        server.payloads[OWN] = released
    print("PASS a package replaced with its checksum is refused", flush=True)

    non_ansi = work / NON_ANSI_FOLDER
    non_ansi.mkdir()
    directory = non_ansi / "install"
    shutil.copytree(baseline, directory)
    run_install(installer, directory, "new", non_ansi / "temp", True)
    expect_updated(directory, before)
    print("PASS update with temp and install folders outside the ANSI code page", flush=True)

    for version in ("checksum-404", "invalid-checksum", "hash-mismatch", "corrupt", "partial", "no-exe", "no-internal"):
        directory = clone(version)
        run_install(installer, directory, version, work / f"temp-{version}", False)
        assert_tree(directory, before)
        if version in ("corrupt", "partial", "no-exe", "no-internal"):
            assert (work / f"temp-{version}" / (PACKAGE + ".bad")).read_bytes() == server.payloads[version]
        if version == "hash-mismatch":
            # Downloaded again before giving up (#424), and a package that failed
            # verification is not kept.
            with server.request_lock:
                fetched = [r for r in server.requests
                           if r["method"] == "GET" and r["path"] == f"/v{version}/{PACKAGE}"]
            assert len(fetched) >= 3, fetched
            assert not (work / f"temp-{version}" / (PACKAGE + ".bad")).exists()
        print(f"PASS unchanged tree after {version}", flush=True)

    # A transfer that reports OK can still be damaged (#424): the SHA-256 check refuses it
    # and the next attempt downloads the package again, where the install succeeds. The
    # archive an earlier failed install kept is removed too.
    temp = work / "temp-damaged-once"
    temp.mkdir()
    (temp / (PACKAGE + ".bad")).write_bytes(b"kept by an earlier failed install")
    directory = clone("damaged once")
    run_install(installer, directory, "damaged-once", temp, True)
    expect_updated(directory, before)
    assert server.damaged
    assert not (temp / (PACKAGE + ".bad")).exists()
    print("PASS a damaged download is fetched again", flush=True)

    directory = clone("commit locked dependency")
    with hold_file(directory / "_internal/shared.txt"):
        run_install(installer, directory, "new", work / "temp-locked", False)
        assert_tree(directory, before)
    print("PASS rollback after executable replacement and locked dependency", flush=True)

    for checkpoint in ("marker", "uninstallers", "exe-backup", "exe-replaced", "add-recorded", "add-replaced", "rollback-started"):
        directory = clone("recovery-" + checkpoint)
        interrupted_commit(directory, checkpoint)
        run_install(installer, directory, "checksum-404", work / ("temp-recovery-" + checkpoint), False)
        assert_tree(directory, before)
        print(f"PASS interrupted commit recovery at {checkpoint}", flush=True)

    directory = clone("blocked recovery")
    interrupted_commit(directory, "exe-replaced")
    with hold_file(directory / APP):
        run_install(installer, directory, "checksum-404", work / "temp-blocked", False)
        assert (directory / ".upd/committing").exists()
        assert (directory / ".upd/old" / APP).read_bytes() == payload_files("old")[APP]
    run_install(installer, directory, "checksum-404", work / "temp-unblocked", False)
    assert_tree(directory, before)
    print("PASS blocked restoration retains backups and can be retried", flush=True)

    directory = clone("range fallback")
    run_install(installer, directory, "range-fallback", work / "temp-range", True)
    expect_updated(directory, before)
    requests = [r for r in server.requests if r["method"] == "GET" and r["path"] == "/vrange-fallback/" + PACKAGE]
    assert any(r["range"] for r in requests), "Parallel path not reached; check available disk space"
    assert any(r["range"] is None for r in requests), "Single-connection fallback not reached"
    print("PASS failed range falls back to a single connection", flush=True)

    fresh_failed = work / "failed fresh"
    run_install(installer, fresh_failed, "partial", work / "temp-fresh-failed", False)
    assert not fresh_failed.exists()
    print("PASS failed fresh install removes install folder", flush=True)


def register_old_install(directory):
    import winreg
    for path, values in {
        PRODUCT_KEY: {"": str(directory), "Installer Language": "1033"},
        UNINSTALL_KEY: {"": str(directory), "DisplayVersion": "0.0.1", "DisplayName": "VRCT-VOX",
                        "UninstallString": f'"{directory / "uninstall.exe"}"'},
    }.items():
        with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, path, 0, winreg.KEY_WRITE | winreg.KEY_WOW64_64KEY) as key:
            for name, value in values.items():
                winreg.SetValueEx(key, name, 0, winreg.REG_SZ, value)


def gui_scenario(installer, work):
    from pywinauto import Desktop
    directory = work / "gui old install"
    run_install(installer, directory, "old", work / "temp-gui-seed", True)
    add_user_data(directory)
    before = snapshot(directory)
    register_old_install(directory)
    process = subprocess.Popen(installer_command(installer, directory, "checksum-404", silent=False),
                               env=installer_environment(work / "temp-gui"))
    desktop = Desktop(backend="win32")
    selected = False
    saw_failure = False
    deadline = time.monotonic() + 120
    events = []
    try:
        while process.poll() is None and time.monotonic() < deadline:
            windows = desktop.windows(process=process.pid, visible_only=True)
            for window in windows:
                text = "\n".join(control.window_text() for control in window.descendants())
                events.append(text)
                buttons = [b for b in window.descendants(class_name="Button") if b.is_visible() and b.is_enabled()]
                uninstall_choice = [b for b in buttons if "uninstall before installing" in b.window_text().replace("&", "").lower()]
                if uninstall_choice:
                    # The default first radio must still be selected on arrival.
                    assert uninstall_choice[0].get_check_state() == 1
                    uninstall_choice[0].click()
                    selected = True
                if "Could not download the package checksum" in text:
                    saw_failure = True
                # A failed install leaves only Cancel, which also runs .onInstFailed.
                aborted = "Installation Aborted" in text
                for caption in ("Cancel",) if aborted else ("OK", "I Agree", "Next >", "Install", "Close", "Finish"):
                    matches = [b for b in buttons if b.window_text().replace("&", "").strip() == caption]
                    if matches:
                        matches[0].click()
                        time.sleep(0.2)
                        break
            time.sleep(0.1)
        assert process.poll() is not None, "Wizard timed out"
        assert process.returncode == 2, f"GUI failure exit: {process.returncode}"
        assert selected, "The upgrade maintenance choice was never reached"
        assert saw_failure, "The checksum failure dialog was never reached"
        assert_tree(directory, before)
        print("PASS default wizard uninstall-before-installing preserves old tree", flush=True)
    finally:
        (work / "gui-controls.json").write_text(json.dumps(events, indent=2), encoding="utf-8")
        if process.poll() is None:
            process.kill()
            process.wait(timeout=10)


PRODUCT_NAME = json.loads((ROOT / "src-tauri/tauri.conf.json").read_text(encoding="utf-8"))["productName"]
OLD_FOLDER = "VRCT-VOX"
OLD_SHORTCUT = "vrct-vox.lnk"


def shell_folder(csidl):
    buffer = ctypes.create_unicode_buffer(260)
    assert ctypes.windll.shell32.SHGetFolderPathW(None, csidl, None, 0, buffer) == 0
    return Path(buffer.value)


def desktop_folder():
    return shell_folder(0x10)  # CSIDL_DESKTOPDIRECTORY


def programs_folder():
    return shell_folder(0x02)  # CSIDL_PROGRAMS: the user's Start menu programs


def make_shortcut(link, target):
    link.parent.mkdir(parents=True, exist_ok=True)
    script = (f"$s=(New-Object -ComObject WScript.Shell).CreateShortcut('{link}');"
              f"$s.TargetPath='{target}';$s.Save()")
    subprocess.run(["powershell", "-NoProfile", "-Command", script], check=True, timeout=60)


def uninstall_entry():
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, UNINSTALL_KEY, 0, winreg.KEY_READ | winreg.KEY_WOW64_64KEY) as key:
            return {name: winreg.QueryValueEx(key, name)[0]
                    for name in ("DisplayName", "DisplayVersion", "InstallLocation")}
    except FileNotFoundError:
        return None


def uninstall_entries_named(*names):
    import winreg
    found = []
    root = r"Software\Microsoft\Windows\CurrentVersion\Uninstall"
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, root, 0, winreg.KEY_READ | winreg.KEY_WOW64_64KEY) as key:
        for index in range(winreg.QueryInfoKey(key)[0]):
            sub = winreg.EnumKey(key, index)
            try:
                with winreg.OpenKey(key, sub) as entry:
                    if winreg.QueryValueEx(entry, "DisplayName")[0] in names:
                        found.append(sub)
            except OSError:
                pass
    return found


def run_default_install(installer, version, temp, extra=""):
    """No /D and no /NS: the default folder, the stored location and shortcuts as a user gets them."""
    command = f'"{installer}" /S /UILANG=en /VERSION={version} {extra}'.strip()
    result = subprocess.run(command, env=installer_environment(temp), timeout=180, check=False)
    assert result.returncode == 0, f"{version}: exit {result.returncode}"


def run_uninstall(directory):
    # _? keeps the uninstaller in place and makes it wait; it must come last, unquoted.
    subprocess.run(f'"{directory / "uninstall.exe"}" /S _?={directory}', timeout=180, check=True)


def rename_scenarios(installer, work):
    """The display name moves to productName (Issue #535); identifiers and data stay."""
    local = Path(os.environ["LOCALAPPDATA"])
    new_dir, old_dir = local / PRODUCT_NAME, local / OLD_FOLDER
    desktop, programs = desktop_folder(), programs_folder()
    assert PRODUCT_NAME != OLD_FOLDER
    for path in (new_dir, old_dir):
        assert not path.exists(), f"Run on a disposable machine: {path} exists"
    assert uninstall_entry() is None, "Run on a disposable machine: an install is registered"

    # A new install: folder, Apps list and shortcuts carry the display name.
    run_default_install(installer, "new", work / "temp-rename-fresh")
    assert (new_dir / APP).is_file() and not old_dir.exists()
    entry = uninstall_entry()
    assert entry["DisplayName"] == PRODUCT_NAME, entry
    assert entry["InstallLocation"].strip('"') == str(new_dir), entry
    assert (desktop / f"{PRODUCT_NAME}.lnk").is_file()
    assert list(programs.rglob(f"{PRODUCT_NAME}.lnk")), "No Start menu shortcut"
    assert not (desktop / OLD_SHORTCUT).exists() and not list(programs.rglob(OLD_SHORTCUT))
    run_uninstall(new_dir)
    assert uninstall_entry() is None and not (desktop / f"{PRODUCT_NAME}.lnk").exists()
    assert not list(programs.rglob(f"{PRODUCT_NAME}.lnk"))
    shutil.rmtree(new_dir)
    print("PASS a new install uses the display name for folder, Apps list and shortcuts", flush=True)

    # An install made under the old name, with the shortcuts 0.5.0 made, updated in place.
    run_install(installer, old_dir, "old", work / "temp-rename-seed", True)
    add_user_data(old_dir)
    register_old_install(old_dir)
    old_links = [desktop / OLD_SHORTCUT, programs / OLD_FOLDER / OLD_SHORTCUT, programs / OLD_SHORTCUT]
    for link in old_links:
        make_shortcut(link, old_dir / APP)
    before = snapshot(old_dir)
    run_default_install(installer, "new", work / "temp-rename-update", extra="/UPDATE /EDITION=cpu")
    expect_updated(old_dir, before)
    assert not new_dir.exists(), "An update must not move settings and models to a new folder"
    entry = uninstall_entry()
    assert entry["DisplayName"] == PRODUCT_NAME and entry["InstallLocation"].strip('"') == str(old_dir), entry
    assert uninstall_entries_named(PRODUCT_NAME, OLD_FOLDER) == [OLD_FOLDER]
    assert not any(link.exists() for link in old_links), [str(l) for l in old_links if l.exists()]
    assert not (programs / OLD_FOLDER).exists()
    for link in (desktop / f"{PRODUCT_NAME}.lnk", programs / PRODUCT_NAME / f"{PRODUCT_NAME}.lnk",
                 programs / f"{PRODUCT_NAME}.lnk"):
        assert link.is_file(), link
    print("PASS an update keeps folder and data, renames the Apps entry and the shortcuts", flush=True)
    run_uninstall(old_dir)
    assert uninstall_entry() is None
    assert not (desktop / f"{PRODUCT_NAME}.lnk").exists()
    assert not list(programs.rglob(f"{PRODUCT_NAME}.lnk")) and not list(programs.rglob(OLD_SHORTCUT))
    assert (old_dir / "config.json").is_file(), "The uninstaller keeps settings unless asked"
    print("PASS the uninstaller removes the renamed shortcuts", flush=True)


def system_tar():
    # The installer's tar, not one that a tool put earlier on PATH.
    return str(Path(os.environ["SystemRoot"]) / "System32/tar.exe")


def verify_partial_fixture(work):
    archive = work / "partial-fixture.zip"
    archive.write_bytes(payloads()["partial"])
    destination = work / "partial-probe"
    destination.mkdir()
    result = subprocess.run([system_tar(), "-xvf", str(archive), "-C", str(destination)],
                            capture_output=True, timeout=30, check=False)
    (work / "partial-probe.log").write_bytes(result.stdout + result.stderr)
    assert result.returncode != 0, "Fixture must cause a real tar extraction error"
    assert (destination / APP).is_file(), "Fixture must fail after writing the executable"
    assert (destination / "_internal/shared.txt").is_file(), "Fixture must partially extract dependencies"


def extract_like_installer(staging, data):
    """The installer's call: the working directory is the only non-ASCII input."""
    target = staging / "new"
    target.mkdir(parents=True)
    (staging / PACKAGE).write_bytes(data)
    result = subprocess.run([system_tar(), "-xvf", "..\\" + PACKAGE], cwd=target,
                            capture_output=True, timeout=30, check=False)
    return target, result


def verify_extraction_outside_ansi(work):
    folder = work / NON_ANSI_FOLDER / "tar-probe"
    target, result = extract_like_installer(folder / "good", payloads()["new"])
    assert result.returncode == 0, result.stdout + result.stderr
    for name, value in payload_files("new").items():
        assert (target / name).read_bytes() == value, name
    print("PASS tar unpacks into a folder outside the ANSI code page", flush=True)
    for version in ("corrupt", "partial"):
        _target, result = extract_like_installer(folder / version, payloads()[version])
        assert result.returncode != 0, f"{version}: tar must still report a bad archive"
    print("PASS tar reports bad archives from a folder outside the ANSI code page", flush=True)
    # Not asserted: a later tar or a UTF-8 system locale may accept these paths.
    long_paths = subprocess.run([system_tar(), "-xvf", str(folder / "good" / PACKAGE), "-C", str(target)],
                                capture_output=True, timeout=30, check=False)
    print(f"NOTE long paths as arguments exit with {long_paths.returncode} here", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("prepare", "tar", "silent", "gui", "rename"), required=True)
    parser.add_argument("--port", type=int, default=18765)
    parser.add_argument("--installer", type=Path)
    parser.add_argument("--work-dir", type=Path, default=ROOT / ".review/tmp/windows-update")
    args = parser.parse_args()
    if args.mode == "prepare":
        prepare(args.port)
        return
    if os.name != "nt":
        parser.error("Real installer scenarios require Windows")
    if args.mode != "tar" and (args.installer is None or not args.installer.is_file()):
        parser.error("--installer must name the built NSIS executable")
    work = args.work_dir.resolve() / args.mode
    work.mkdir(parents=True, exist_ok=False)
    if args.mode == "tar":
        verify_extraction_outside_ansi(work)
        return
    with serve(args.port, work / "http-requests.json") as server:
        if args.mode == "silent":
            verify_partial_fixture(work)
            silent_scenarios(args.installer.resolve(), work, server)
        elif args.mode == "rename":
            rename_scenarios(args.installer.resolve(), work)
        else:
            gui_scenario(args.installer.resolve(), work)


if __name__ == "__main__":
    main()
