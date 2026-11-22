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
# The main binary from 0.7.0, and the one up to 0.6.x (ADR-014, 2.5 and 2.6). The "old" package
# plays a release up to 0.6.x and carries the old one; every other package carries the new one.
APP = "astarot.exe"
OLD_APP = "vrct-vox.exe"
# Packages up to 0.4 carried the Python sidecar beside the app; from 0.5.0 they do not. The
# "old" package is such a package: updating it to "new" removes the stale sidecar, while
# installing a package that has one (a downgrade) keeps it.
SIDECAR = "vrct-vox-sidecar.exe"
PACKAGE = "VRCT-VOX.zip"
# The keys up to 0.6.x, and the keys from ADR-014's step 5 on (2.5).
OLD_UNINSTALL_KEY = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\VRCT-VOX"
OLD_PRODUCT_KEY = r"Software\kein5\VRCT-VOX"
UNINSTALL_KEY = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\ASTAROT"
PRODUCT_KEY = r"Software\kein5\ASTAROT"
# The file a moved install leaves for the app: the old folder, UTF-16 after a byte order mark.
MOVED_FROM = "installer_moved_from.txt"
# No single ANSI code page holds all of these characters.
NON_ANSI_FOLDER = "ユーザー 한글 😀"
ARCHIVE_TIME = (2026, 1, 1, 0, 0, 0)
# The installer's own version. Installing it checks the package against the hashes built into
# the installer (src-tauri/nsis/package-hashes.nsh, written by prepare); other versions check
# the .sha256 file served next to the package.
OWN = json.loads((ROOT / "src-tauri/tauri.conf.json").read_text(encoding="utf-8"))["version"]


def payload_files(version):
    files = {
        (OLD_APP if version == "old" else APP): f"{version} executable stub".encode(),
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
    (ROOT / "src-tauri/nsis/package-hashes.nsh").write_text(f'!define PACKAGE_SHA256 "{released}"\n', encoding="ascii")
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


def moved_from_bytes(folder):
    return b"\xff\xfe" + str(folder).encode("utf-16-le")


def expect_updated(directory, before, moved_from=None, version="new"):
    """`moved_from`: the folder the installer moved the install from, named in the file it leaves.
    The main binary under either name goes with the rest of the app: only `version`'s stays."""
    expected = {k: v for k, v in before.items()
                if k not in (APP, OLD_APP, SIDECAR, "update.exe", "_internal") and not k.startswith("_internal/")}
    if moved_from is not None:
        expected[MOVED_FROM] = sha256(moved_from_bytes(moved_from)).hexdigest()
    for name, value in payload_files(version).items():
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
    """An update that stopped half way, by an installer up to 0.6.x: the main binary is the old
    one on both sides."""
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
    (directory / OLD_APP).rename(work / "old" / OLD_APP)
    if checkpoint == "exe-backup":
        return
    (directory / OLD_APP).write_bytes(payload_files("new")[APP])
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
    assert not (updated / OLD_APP).exists()
    print("PASS update success and user data retention", flush=True)
    print("PASS the main binary up to 0.6.x is replaced by the new one", flush=True)

    # A package under the old name (another version through /VERSION) is installed as it is:
    # its main binary stays, and the one under the new name goes.
    directory = clone("back to a package up to 0.6.x")
    run_install(installer, directory, "new", work / "temp-forward", True)
    run_install(installer, directory, "old", work / "temp-back", True)
    expect_updated(directory, before, version="old")
    assert not (directory / APP).exists()
    print("PASS a package with the main binary up to 0.6.x installs under that name", flush=True)

    # The in-app updater (src-tauri/src/app_update.rs) adds /UPDATE. The app's language setting
    # stays: no installer_language.txt for the app to apply at start.
    directory = clone("in-app update")
    (directory / "installer_language.txt").unlink()
    run_install(installer, directory, "new", work / "temp-in-app", True, extra="/UPDATE ")
    expect_updated(directory, {k: v for k, v in before.items() if k != "installer_language.txt"})
    print("PASS in-app update keeps the language setting", flush=True)

    # Apps up to 0.5 name their edition; a CUDA install passes /EDITION=gpu. There is no CUDA
    # package any more (#288): the installer takes the one package (the server has no other).
    for edition in ("cpu", "gpu"):
        directory = clone(f"in-app update from the {edition} edition")
        (directory / "installer_language.txt").unlink()
        with server.request_lock:
            seen = len(server.requests)
        run_install(installer, directory, "new", work / f"temp-edition-{edition}", True,
                    extra=f"/UPDATE /EDITION={edition} ")
        expect_updated(directory, {k: v for k, v in before.items() if k != "installer_language.txt"})
        with server.request_lock:
            names = {request["path"].rsplit("/", 1)[-1] for request in server.requests[seen:]}
        assert names <= {PACKAGE, PACKAGE + ".sha256"}, names
    print("PASS /EDITION=cpu and /EDITION=gpu install the one package", flush=True)

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
    with hold_file(directory / OLD_APP):
        run_install(installer, directory, "checksum-404", work / "temp-blocked", False)
        assert (directory / ".upd/committing").exists()
        assert (directory / ".upd/old" / OLD_APP).read_bytes() == payload_files("old")[OLD_APP]
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


def write_key(path, values):
    import winreg
    with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, path, 0, winreg.KEY_WRITE | winreg.KEY_WOW64_64KEY) as key:
        for name, value in values.items():
            winreg.SetValueEx(key, name, 0, winreg.REG_SZ, value)


def read_key(path):
    """Every value of the key, or None when there is no key."""
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, path, 0, winreg.KEY_READ | winreg.KEY_WOW64_64KEY) as key:
            values = {}
            for index in range(winreg.QueryInfoKey(key)[1]):
                name, value, _kind = winreg.EnumValue(key, index)
                values[name] = value
            return values
    except FileNotFoundError:
        return None


def clear_registration():
    import winreg
    for path in (PRODUCT_KEY, UNINSTALL_KEY, OLD_PRODUCT_KEY, OLD_UNINSTALL_KEY):
        try:
            winreg.DeleteKeyEx(winreg.HKEY_CURRENT_USER, path, winreg.KEY_WOW64_64KEY, 0)
        except FileNotFoundError:
            pass


def register_old_keys(directory, language="1033"):
    """The keys an installer up to 0.6.x wrote for an install in `directory`."""
    write_key(OLD_PRODUCT_KEY, {"": str(directory), "Installer Language": language})
    write_key(OLD_UNINSTALL_KEY, {"": str(directory), "DisplayVersion": "0.0.1", "DisplayName": "VRCT-VOX",
                                  "InstallLocation": f'"{directory}"',
                                  "UninstallString": f'"{directory / "uninstall.exe"}"'})


def register_old_install(directory, language="1033"):
    """A machine with an install of 0.5.x: its keys, and none of this version's."""
    clear_registration()
    register_old_keys(directory, language)


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


def make_shortcut(link, target, arguments=""):
    link.parent.mkdir(parents=True, exist_ok=True)
    script = (f"$s=(New-Object -ComObject WScript.Shell).CreateShortcut('{link}');"
              f"$s.TargetPath='{target}';$s.Arguments='{arguments}';$s.Save()")
    subprocess.run(["powershell", "-NoProfile", "-Command", script], check=True, timeout=60)


def uninstall_entry():
    entry = read_key(UNINSTALL_KEY)
    return None if entry is None else {name: entry.get(name) for name in ("DisplayName", "DisplayVersion", "InstallLocation")}


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


def run_default_install(installer, version, temp, extra="", uilang="en"):
    """No /D and no /NS: the default folder, the stored location and shortcuts as a user gets them."""
    language = f"/UILANG={uilang} " if uilang else ""
    command = f'"{installer}" /S {language}/VERSION={version} {extra}'.strip()
    result = subprocess.run(command, env=installer_environment(temp), timeout=180, check=False)
    assert result.returncode == 0, f"{version}: exit {result.returncode}"


def run_uninstall(directory):
    # _? keeps the uninstaller in place and makes it wait; it must come last, unquoted.
    subprocess.run(f'"{directory / "uninstall.exe"}" /S _?={directory}', timeout=180, check=True)


def rename_scenarios(installer, work):
    """The display name moves to productName (Issue #535). An update of an install made under the
    old name moves it as well (ADR-014, 2.5): move_scenarios."""
    local = Path(os.environ["LOCALAPPDATA"])
    new_dir, old_dir = local / PRODUCT_NAME, local / OLD_FOLDER
    desktop, programs = desktop_folder(), programs_folder()
    assert PRODUCT_NAME != OLD_FOLDER
    for path in (new_dir, old_dir):
        assert not path.exists(), f"Run on a disposable machine: {path} exists"
    assert uninstall_entry() is None and read_key(OLD_UNINSTALL_KEY) is None, \
        "Run on a disposable machine: an install is registered"

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
    # The location the uninstaller keeps for a later install goes too: the next mode starts clean.
    clear_registration()


def same_path(a, b):
    return os.path.normcase(os.path.normpath(str(a))) == os.path.normcase(os.path.normpath(str(b)))


def shortcut_property(link, name):
    script = f"(New-Object -ComObject WScript.Shell).CreateShortcut('{link}').{name}"
    result = subprocess.run(["powershell", "-NoProfile", "-Command", script],
                            capture_output=True, text=True, check=True, timeout=60)
    return result.stdout.strip()


def shortcut_target(link):
    return shortcut_property(link, "TargetPath")


def shortcut_places():
    desktop, programs = desktop_folder(), programs_folder()
    new = [desktop / f"{PRODUCT_NAME}.lnk", programs / PRODUCT_NAME / f"{PRODUCT_NAME}.lnk", programs / f"{PRODUCT_NAME}.lnk"]
    old = [desktop / OLD_SHORTCUT, programs / OLD_FOLDER / OLD_SHORTCUT, programs / OLD_SHORTCUT]
    return new, old


def remove_shortcuts():
    new, old = shortcut_places()
    for link in new + old:
        link.unlink(missing_ok=True)
    for folder in (programs_folder() / PRODUCT_NAME, programs_folder() / OLD_FOLDER):
        if folder.is_dir() and not any(folder.iterdir()):
            folder.rmdir()


def seed_install(installer, directory, temp):
    """The old package with user data in `directory`; no keys and no shortcuts: each scenario sets
    those up as the version it plays left them."""
    run_install(installer, directory, "old", temp, True)
    add_user_data(directory)
    clear_registration()
    remove_shortcuts()
    return snapshot(directory)


def expect_registration(directory, language=None):
    """The keys of this version record `directory`; the keys up to 0.6.x are gone; one Apps entry."""
    product = read_key(PRODUCT_KEY)
    assert product is not None and same_path(product[""], directory), product
    if language is not None:
        assert product.get("Installer Language") == language, product
    entry = read_key(UNINSTALL_KEY)
    assert entry is not None and entry["DisplayName"] == PRODUCT_NAME, entry
    assert same_path(entry["InstallLocation"].strip('"'), directory), entry
    assert same_path(entry["UninstallString"].strip('"'), directory / "uninstall.exe"), entry
    # ADR-014, 2.5, 8: the main binary under its new name.
    assert entry.get("MainBinaryName") == APP, entry
    assert same_path(entry["DisplayIcon"].strip('"'), directory / APP), entry
    assert read_key(OLD_PRODUCT_KEY) is None, read_key(OLD_PRODUCT_KEY)
    assert read_key(OLD_UNINSTALL_KEY) is None, read_key(OLD_UNINSTALL_KEY)
    assert uninstall_entries_named(PRODUCT_NAME, OLD_FOLDER) == [UNINSTALL_KEY.rsplit("\\", 1)[1]]


def reset_machine(*folders):
    remove_shortcuts()
    clear_registration()
    for folder in folders:
        if folder.exists():
            shutil.rmtree(folder)


def move_scenarios(installer, work):
    """ADR-014, 2.5: the default folder up to 0.5.0 and the registry keys move to ASTAROT."""
    local = Path(os.environ["LOCALAPPDATA"])
    new_dir, old_dir = local / PRODUCT_NAME, local / OLD_FOLDER
    for path in (new_dir, old_dir):
        assert not path.exists(), f"Run on a disposable machine: {path} exists"
    assert read_key(UNINSTALL_KEY) is None and read_key(OLD_UNINSTALL_KEY) is None, \
        "Run on a disposable machine: an install is registered"
    reset_machine()
    new_links, old_links = shortcut_places()
    desktop_link = new_links[0]

    # 0.5.0 and earlier: the old default folder, the old keys with the language the installer
    # last ran in, and the shortcuts 0.5.0 made. The in-app update moves the folder by renaming
    # it, leaves the file for the app, moves the keys, and points the shortcuts at the new place.
    seed_install(installer, old_dir, work / "temp-seed-0.5.0")
    register_old_install(old_dir, language="1041")
    for link in old_links:
        make_shortcut(link, old_dir / OLD_APP)
    before = snapshot(old_dir)
    run_default_install(installer, "new", work / "temp-move", extra="/UPDATE /EDITION=cpu", uilang=None)
    assert not old_dir.exists(), "Nothing, no link or junction, is left at the old place"
    expect_updated(new_dir, before, moved_from=old_dir)
    expect_registration(new_dir, language="1041")
    assert not any(link.exists() for link in old_links), [str(link) for link in old_links if link.exists()]
    for link in new_links:
        assert same_path(shortcut_target(link), new_dir / APP), link
    print("PASS the default folder of 0.5.0 moves with its data, keys, language and shortcuts", flush=True)

    # The next update finds the install by the new keys and moves nothing more. The app has not
    # started yet, so the file for it is still there.
    run_default_install(installer, "new", work / "temp-move-again", extra="/UPDATE", uilang=None)
    assert not old_dir.exists()
    expect_updated(new_dir, before, moved_from=old_dir)
    expect_registration(new_dir, language="1041")
    print("PASS the next update leaves the moved install where it is", flush=True)

    # The uninstaller removes the keys of both names; an update that stopped half way may have
    # left the old ones. It keeps the settings, and the file for the app goes.
    register_old_keys(old_dir)
    run_uninstall(new_dir)
    assert read_key(UNINSTALL_KEY) is None and read_key(OLD_UNINSTALL_KEY) is None
    assert read_key(OLD_PRODUCT_KEY) is None
    assert "Installer Language" not in (read_key(PRODUCT_KEY) or {})
    assert not any(link.exists() for link in new_links + old_links)
    assert (new_dir / "config.json").is_file(), "The uninstaller keeps settings unless asked"
    assert not (new_dir / MOVED_FROM).exists()
    print("PASS the uninstaller removes the keys of both names and keeps the settings", flush=True)
    reset_machine(new_dir)

    # 0.5.1 and later installed into the new default folder already: only the keys move. The
    # main binary takes its new name (2.5, 8): the shortcuts the installer made lead to it, and one
    # the user made under another name is left as it is.
    seed_install(installer, new_dir, work / "temp-seed-0.5.1")
    register_old_install(new_dir)
    for link in new_links[:2]:
        make_shortcut(link, new_dir / OLD_APP)
    own = desktop_folder() / "my ASTAROT.lnk"
    make_shortcut(own, new_dir / OLD_APP)
    before = snapshot(new_dir)
    run_default_install(installer, "new", work / "temp-keys-only", extra="/UPDATE")
    assert not old_dir.exists()
    expect_updated(new_dir, before)
    expect_registration(new_dir)
    for link in new_links[:2]:
        assert same_path(shortcut_target(link), new_dir / APP), link
    assert not new_links[2].exists(), "A shortcut the user removed is not made again"
    assert same_path(shortcut_target(own), new_dir / OLD_APP)
    own.unlink()
    print("PASS an install of 0.5.1 in the new folder keeps its place; only the keys move", flush=True)
    print("PASS the shortcuts the installer made lead to the main binary under its new name", flush=True)

    # The next update, with the main binary already under its new name, leaves the shortcuts as
    # they are: what the user changed in them stays.
    make_shortcut(desktop_link, new_dir / APP, arguments="--kept")
    run_default_install(installer, "new", work / "temp-keys-only-again", extra="/UPDATE")
    assert shortcut_property(desktop_link, "Arguments") == "--kept"
    print("PASS an update under the same name leaves the shortcuts alone", flush=True)
    reset_machine(new_dir)

    # A folder the user chose stays, even under the old name.
    chosen = work / "chosen place" / OLD_FOLDER
    seed_install(installer, chosen, work / "temp-seed-chosen")
    register_old_install(chosen)
    make_shortcut(desktop_link, chosen / OLD_APP)
    before = snapshot(chosen)
    run_default_install(installer, "new", work / "temp-chosen", extra="/UPDATE")
    expect_updated(chosen, before)
    expect_registration(chosen)
    assert same_path(shortcut_target(desktop_link), chosen / APP)
    assert not new_dir.exists() and not old_dir.exists()
    print("PASS a folder the user chose stays where it is", flush=True)
    reset_machine()

    # Something else in the new folder: nothing moves and nothing there is touched. The keys
    # record the old folder under the new names, and the next update moves the install once the
    # folder is empty (an empty folder is taken over).
    seed_install(installer, old_dir, work / "temp-seed-occupied")
    register_old_install(old_dir)
    new_dir.mkdir()
    (new_dir / "someone else's.txt").write_text("not the app's", encoding="utf-8")
    theirs = snapshot(new_dir)
    before = snapshot(old_dir)
    run_default_install(installer, "new", work / "temp-occupied", extra="/UPDATE")
    expect_updated(old_dir, before)
    assert snapshot(new_dir) == theirs
    expect_registration(old_dir)
    (new_dir / "someone else's.txt").unlink()
    before = snapshot(old_dir)
    run_default_install(installer, "new", work / "temp-occupied-retry", extra="/UPDATE")
    assert not old_dir.exists()
    expect_updated(new_dir, before, moved_from=old_dir)
    expect_registration(new_dir)
    print("PASS an occupied new folder keeps the install in place until the next update", flush=True)
    reset_machine(new_dir)

    # A file open in the old folder: the rename is refused, the update is still installed where
    # the install is, and the next update moves it.
    seed_install(installer, old_dir, work / "temp-seed-open")
    register_old_install(old_dir)
    before = snapshot(old_dir)
    with hold_file(old_dir / "weights/custom/model.bin"):
        run_default_install(installer, "new", work / "temp-open", extra="/UPDATE")
    expect_updated(old_dir, before)
    expect_registration(old_dir)
    assert not new_dir.exists()
    before = snapshot(old_dir)
    run_default_install(installer, "new", work / "temp-open-retry", extra="/UPDATE")
    assert not old_dir.exists()
    expect_updated(new_dir, before, moved_from=old_dir)
    expect_registration(new_dir)
    print("PASS a refused rename keeps the install in place until the next update", flush=True)
    reset_machine(new_dir)

    # A run that stopped after the rename: the folder and the file for the app are in the new
    # place. Stopped before the keys, only the old keys record the install, at the old place, and
    # the shortcuts may still lead there. Stopped between the keys, both record it (the old keys
    # at the old place), and the shortcuts lead to the new place already. The next update finds
    # the install, records it, removes the old keys and points the shortcuts at it.
    for keys in ("old keys", "both keys"):
        seed_install(installer, old_dir, work / f"temp-seed-stopped-{keys}")
        register_old_install(old_dir)
        (old_dir / MOVED_FROM).write_bytes(moved_from_bytes(old_dir))
        os.rename(old_dir, new_dir)
        if keys == "both keys":
            write_key(PRODUCT_KEY, {"": str(new_dir)})
            write_key(UNINSTALL_KEY, {"DisplayName": PRODUCT_NAME, "InstallLocation": f'"{new_dir}"',
                                      "UninstallString": f'"{new_dir / "uninstall.exe"}"'})
        # Stopped between the keys, the shortcuts were pointed at the new place and name already.
        make_shortcut(desktop_link, new_dir / APP if keys == "both keys" else old_dir / OLD_APP)
        before = snapshot(new_dir)
        run_default_install(installer, "new", work / f"temp-stopped-{keys}", extra="/UPDATE")
        assert not old_dir.exists()
        expect_updated(new_dir, before)
        expect_registration(new_dir)
        assert same_path(shortcut_target(desktop_link), new_dir / APP)
        print(f"PASS a move that stopped before the keys ({keys}) is finished at the next update", flush=True)
        reset_machine(new_dir)

    # Keys up to 0.6.x that record another install, which still has its uninstaller (0.5.0 put
    # back beside a newer install), stay with it, through the update and the uninstall.
    other = work / "other install"
    other.mkdir()
    (other / "uninstall.exe").write_bytes(b"another install's uninstaller")
    seed_install(installer, new_dir, work / "temp-seed-other")
    write_key(PRODUCT_KEY, {"": str(new_dir)})
    register_old_keys(other)
    run_default_install(installer, "new", work / "temp-other", extra="/UPDATE")
    assert same_path(read_key(PRODUCT_KEY)[""], new_dir)
    assert read_key(OLD_PRODUCT_KEY)[""] == str(other) and read_key(OLD_UNINSTALL_KEY) is not None
    run_uninstall(new_dir)
    assert read_key(UNINSTALL_KEY) is None
    assert read_key(OLD_PRODUCT_KEY)[""] == str(other) and read_key(OLD_UNINSTALL_KEY) is not None
    print("PASS keys up to 0.6.x of another install stay with it", flush=True)
    reset_machine(new_dir)


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
    parser.add_argument("--mode", choices=("prepare", "tar", "silent", "gui", "rename", "move"), required=True)
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
        elif args.mode == "move":
            move_scenarios(args.installer.resolve(), work)
        else:
            gui_scenario(args.installer.resolve(), work)


if __name__ == "__main__":
    main()
