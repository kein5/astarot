"""A PipeWire daemon of its own, with WirePlumber's policy, in a temporary folder.

The tests of the native helpers (astarot-source-bridge) and of the CI's audio
setup run on it, so the PC's own graph is never touched. It needs pipewire, wireplumber 0.5,
pw-loopback, pw-cat, pw-dump and pw-metadata; the Linux CI builds them into a prefix of their own
(tools/ci/setup_pipewire.sh). The Rust tests have the same graph in
native/audio-routing/tests/private_graph/mod.rs.

It was part of tools/voice_acceptance.py, which measured the Python backend and went with it
(#285).
"""
from contextlib import ExitStack, contextmanager
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time


# No ALSA, Bluetooth, PulseAudio, camera, or device enumeration modules.
PIPEWIRE_CONFIG = """
context.properties = {
    core.daemon = true
    core.name = vrct-acceptance
    default.clock.rate = 48000
    default.clock.quantum = 256
}
context.spa-libs = {
    audio.convert.* = audioconvert/libspa-audioconvert
    support.* = support/libspa-support
}
context.modules = [
    { name = libpipewire-module-rt flags = [ ifexists nofail ] }
    { name = libpipewire-module-protocol-native }
    { name = libpipewire-module-metadata }
    { name = libpipewire-module-spa-node-factory }
    { name = libpipewire-module-client-node }
    { name = libpipewire-module-access }
    { name = libpipewire-module-adapter }
    { name = libpipewire-module-link-factory }
]
context.objects = [
    { factory = spa-node-factory args = {
        factory.name = support.node.driver
        node.name = Dummy-Driver
        node.group = pipewire.dummy
        priority.driver = 20000
    } }
]
"""


def wait_for(predicate, timeout=5, code="acceptance_condition_timeout"):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(0.005)
    raise TimeoutError(code)


def stop_process(process):
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=1)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=1)


def start_process(stack, command, **kwargs):
    process = subprocess.Popen(command, stderr=subprocess.DEVNULL, **kwargs)
    stack.callback(stop_process, process)
    return process


def graph_snapshot():
    data = subprocess.run(["pw-dump"], capture_output=True, check=True, timeout=3)
    return json.loads(data.stdout)


def nodes():
    return {n["info"]["props"].get("node.name"): n for n in graph_snapshot()
            if n["type"] == "PipeWire:Interface:Node"}


def default_output():
    for node in graph_snapshot():
        if node.get("props", {}).get("metadata.name") == "default":
            for entry in node.get("metadata", []):
                if entry["key"] == "default.audio.sink":
                    return entry["value"].get("name")
    return None


def policy_installation():
    """Bind policy configuration, scripts and modules to the selected daemon."""
    binary = shutil.which("wireplumber")
    if not binary:
        raise RuntimeError("missing_wireplumber")
    binary = Path(binary).resolve(strict=True)
    prefix = binary.parent.parent
    data = prefix / "share/wireplumber"

    def inside(path):
        return path.resolve().is_relative_to(prefix)

    config = data / "wireplumber.conf"
    if not config.is_file() or not inside(config):
        raise RuntimeError("missing_wireplumber_policy_config")
    scripts = data / "scripts/lib"
    if not scripts.is_dir() or not inside(scripts):
        raise RuntimeError("missing_wireplumber_policy_data")
    # Arch and the isolated CI prefix use lib; Debian uses lib/<multiarch>.
    # Do not guess an architecture when multiple installations are present.
    candidates = [prefix / "lib/wireplumber-0.5", *prefix.glob("lib/*/wireplumber-0.5")]
    modules = {path.resolve() for path in candidates if path.is_dir()}
    if not modules:
        raise RuntimeError("missing_wireplumber_policy_modules")
    if len(modules) != 1:
        raise RuntimeError("ambiguous_wireplumber_policy_modules")
    module = modules.pop()
    lua = module / "libwireplumber-module-lua-scripting.so"
    if not lua.is_file() or not inside(lua):
        raise RuntimeError("missing_wireplumber_policy_modules")
    return str(binary), {
        "WIREPLUMBER_CONFIG_DIR": str(data),
        "WIREPLUMBER_DATA_DIR": str(data),
        "WIREPLUMBER_MODULE_DIR": str(module),
    }


@contextmanager
def private_graph(*, config_fragment=None, rate=48000):
    """Isolate both sockets and policy state; restore environment after workers exit."""
    if not sys.platform.startswith("linux"):
        raise RuntimeError("linux_required")
    if type(rate) is not int or rate not in (24000, 48000):
        raise ValueError('unsupported_acceptance_rate')
    for binary in ("pipewire", "wireplumber", "pw-loopback", "pw-cat", "pw-dump", "pw-metadata"):
        if not shutil.which(binary):
            raise RuntimeError(f"missing_{binary}")
    policy_binary, policy_environment = policy_installation()
    with tempfile.TemporaryDirectory(prefix="vrct-p1-") as directory, ExitStack() as stack:
        root = Path(directory)
        config = root / "acceptance.conf"
        configuration = PIPEWIRE_CONFIG.replace('default.clock.rate = 48000', f'default.clock.rate = {rate}')
        if config_fragment:
            fragment = Path(config_fragment).read_text(encoding="utf-8").strip()
            prefix = "context.modules = ["
            if not fragment.startswith(prefix) or not fragment.endswith("]"):
                raise ValueError("expected_modules_fragment")
            marker = "{ name = libpipewire-module-link-factory }"
            configuration = configuration.replace(marker, marker + "\n" + fragment[len(prefix):-1], 1)
        config.write_text(configuration, encoding="utf-8")
        overrides = {"PIPEWIRE_RUNTIME_DIR": directory, "PIPEWIRE_REMOTE": "vrct-acceptance",
                     "XDG_STATE_HOME": str(root / "state"), "XDG_CONFIG_HOME": str(root / "config"),
                     **policy_environment}
        old = {key: os.environ.get(key) for key in overrides}
        os.environ.update(overrides)

        def restore():
            for key, value in old.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value
        stack.callback(restore)
        daemon = start_process(stack, ["pipewire", "-c", str(config)], stdout=subprocess.DEVNULL)
        wait_for(lambda: (root / "vrct-acceptance").exists() or daemon.poll() is not None)
        if daemon.poll() is not None:
            raise RuntimeError("private_pipewire_failed")
        policy = start_process(stack, [policy_binary, "--profile", "policy"], stdout=subprocess.DEVNULL)
        # Wait for the policy client to appear before creating devices.
        def policy_ready():
            data = subprocess.run(["pw-dump"], capture_output=True, check=True, timeout=3)
            return any(str(n.get("info", {}).get("props", {}).get("application.process.id")) == str(policy.pid)
                       for n in json.loads(data.stdout))
        wait_for(policy_ready, code="private_policy_not_ready")
        if policy.poll() is not None:
            raise RuntimeError("private_policy_failed")
        yield stack


def loopback(stack, name):
    process = start_process(stack, [
        "pw-loopback", "--name", name, "--channels", "1", "--channel-map", "MONO",
        "--capture-props", f"media.class=Audio/Sink node.name={name}.sink node.virtual=true",
        "--playback-props", f"media.class=Audio/Source node.name={name}.source node.virtual=true node.passive=true",
    ], stdout=subprocess.DEVNULL)
    wait_for(lambda: {f"{name}.sink", f"{name}.source"} <= nodes().keys())
    return process
