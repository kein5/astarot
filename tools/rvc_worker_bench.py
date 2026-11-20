"""Times the RVC worker (vrct-rvc-worker) on the devices of this PC.

Two decisions wait on PCs other than the one first measured (a laptop with an RTX 3060 Ti over
Thunderbolt): the default block length (40 ms, #531) and the order of `auto` (CUDA before
DirectML). This tool gives the numbers they need from any PC with the app's runtimes set up;
the procedure and the first results are in
docs/voice-stack/rvc-execution-providers-2026-11-20.md.

The worker is started as the app starts it (no console window; on Windows with power throttling
off, so it is not kept on efficiency cores) and driven over its VVC1 pipes with a synthetic tone:
no recording, no text. Nothing it converts is kept. Each run is one fresh worker:

- `sync`: the next packet goes when the previous answer came. The time per packet is the work
  the worker does for one block.
- `paced`: one packet per block length, as the microphone sends them. The round trip is what
  the app waits for; a block whose answer takes longer than the block falls behind.

  python tools/rvc_worker_bench.py --worker <vrct-rvc-worker> --runtime <state>/vc_runtimes/rvc \
      [--directml <state>/vc_runtimes/onnxruntime-directml/lib] --model <voice.pth> \
      [--devices cuda,directml] [--block-ms 40,80] [--packets 300] [--rounds 3] [--json out.json]

Prints one JSON line per run and Markdown tables at the end; `--json` keeps every run.
"""
from __future__ import annotations

import argparse
import functools
import json
import math
import os
import struct
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import BinaryIO

RATE = 48_000
MAGIC = b"VVC1"
# The owner drops a block older than this (native/voice-conversion process.rs, LATE_NS).
LATE_MS = 240.0
# Answers left out of the numbers: the first blocks still settle the GPU.
SETTLE = 10
GPU_LIBRARIES = {"nvcuda.dll", "cudart64_13.dll", "cudnn64_9.dll", "onnxruntime_providers_cuda.dll", "directml.dll",
                 "nvwgf2umx.dll", "igd12umd64.dll", "amdxc64.dll", "libcuda.so.1", "libonnxruntime_providers_cuda.so"}


def packet(header: dict, pcm: bytes = b"") -> bytes:
    text = json.dumps({**header, "pcm_bytes": len(pcm)}).encode()
    return MAGIC + struct.pack("<I", len(text)) + text + pcm


def read_exact(stream: BinaryIO, size: int) -> bytes:
    data = b""
    while len(data) < size:
        chunk = stream.read(size - len(data))
        if not chunk:
            raise EOFError
        data += chunk
    return data


def read_packet(stream: BinaryIO) -> tuple[dict, bytes]:
    prefix = read_exact(stream, 8)
    if prefix[:4] != MAGIC:
        raise ValueError("not a VVC1 packet")
    header = json.loads(read_exact(stream, struct.unpack("<I", prefix[4:])[0]))
    return header, read_exact(stream, int(header.get("pcm_bytes", 0)))


def percentile(values: list[float], q: float) -> float:
    """NumPy's default (linear) percentile."""
    ordered = sorted(values)
    at = (len(ordered) - 1) * q / 100
    low = math.floor(at)
    high = min(low + 1, len(ordered) - 1)
    return ordered[low] + (ordered[high] - ordered[low]) * (at - low)


def summary(times_ms: list[float], block_ms: int) -> dict:
    kept = times_ms[SETTLE:] if len(times_ms) > SETTLE else times_ms
    if not kept:
        return {"n": 0}
    return {"n": len(kept), "p50": round(percentile(kept, 50), 1), "p95": round(percentile(kept, 95), 1), "max": round(max(kept), 1),
            "over_block": sum(t > block_ms for t in kept), "over_late": sum(t > LATE_MS for t in kept)}


@functools.lru_cache(maxsize=4)
def tone(block_ms: int, packets: int) -> tuple[bytes, ...]:
    """A tone with vibrato and harmonics, cut into packets of 48 kHz mono s16le."""
    frames = RATE // 1000 * block_ms
    phase, out = 0.0, []
    for n in range(packets):
        samples = []
        for i in range(frames):
            t = (n * frames + i) / RATE
            phase += 2 * math.pi * (180 + 20 * math.sin(2 * math.pi * 5 * t)) / RATE
            value = sum(0.12 / k * math.sin(k * phase) for k in range(1, 6))
            samples.append(max(-32768, min(32767, round(value * 32767))))
        out.append(struct.pack(f"<{frames}h", *samples))
    return tuple(out)


def worker_command(worker: Path, runtime: Path, model: Path, device: str, block_ms: int, session: str, directml: Path | None = None) -> list[str]:
    command = [str(worker), "--runtime", str(runtime), "--model", str(model), "--session", session, "--block-ms", str(block_ms), "--device", device]
    if directml:
        command += ["--directml", str(directml)]
    return command


def start(command: list[str]) -> subprocess.Popen:
    """Without a console window and, on Windows, without power throttling (child.rs does the same):
    started suspended, the hint set, then resumed."""
    if os.name != "nt":
        return subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    import ctypes

    child = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                             creationflags=subprocess.CREATE_NO_WINDOW | 0x00000004)  # CREATE_SUSPENDED

    class Throttling(ctypes.Structure):
        _fields_ = [("version", ctypes.c_ulong), ("control", ctypes.c_ulong), ("state", ctypes.c_ulong)]
    kernel32, ntdll = ctypes.WinDLL("kernel32"), ctypes.WinDLL("ntdll")
    kernel32.OpenProcess.restype = ctypes.c_void_p
    kernel32.SetProcessInformation.argtypes = (ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p, ctypes.c_ulong)
    kernel32.CloseHandle.argtypes = (ctypes.c_void_p,)
    ntdll.NtResumeProcess.argtypes = (ctypes.c_void_p,)
    handle = kernel32.OpenProcess(0x0200 | 0x0800, False, child.pid)  # SET_INFORMATION | SUSPEND_RESUME
    state = Throttling(1, 1, 0)  # control execution speed; state 0: not throttled
    kernel32.SetProcessInformation(handle, 4, ctypes.byref(state), ctypes.sizeof(state))
    ntdll.NtResumeProcess(handle)
    kernel32.CloseHandle(handle)
    return child


def gpu_libraries(pid: int) -> list[str]:
    """The GPU libraries the worker loaded: which device it really uses. Best effort."""
    names: set[str] = set()
    try:
        if os.name == "nt":
            import ctypes
            from ctypes import wintypes
            psapi, kernel32 = ctypes.WinDLL("psapi"), ctypes.WinDLL("kernel32")
            kernel32.OpenProcess.restype = wintypes.HANDLE
            handle = kernel32.OpenProcess(0x0400 | 0x0010, False, pid)
            modules, needed = (wintypes.HMODULE * 2048)(), wintypes.DWORD()
            psapi.EnumProcessModulesEx(handle, ctypes.byref(modules), ctypes.sizeof(modules), ctypes.byref(needed), 3)
            for i in range(needed.value // ctypes.sizeof(wintypes.HMODULE)):
                name = ctypes.create_unicode_buffer(260)
                psapi.GetModuleBaseNameW(handle, wintypes.HMODULE(modules[i]), name, 260)
                names.add(name.value.lower())
            kernel32.CloseHandle(handle)
        else:
            names = {line.rsplit("/", 1)[-1].strip() for line in Path(f"/proc/{pid}/maps").read_text().splitlines() if "/" in line}
    except OSError:
        return []
    return sorted(names & GPU_LIBRARIES)


def run_case(command: list[str], block_ms: int, packets: int, sync: bool, session: str, timeout_s: float = 60.0) -> dict:
    """One worker: wait for `ready`, send `packets` blocks, time each answer."""
    child = start(command)
    result: dict = {"block_ms": block_ms, "mode": "sync" if sync else "paced"}
    started = time.perf_counter()
    try:
        header, _ = read_packet(child.stdout)
        result["ready_s"] = round(time.perf_counter() - started, 2)
        result["first"] = {key: header.get(key) for key in ("type", "profile", "latency_ms", "block_frames", "code")}
        result["gpu_libraries"] = gpu_libraries(child.pid)
        if header.get("type") != "ready":
            return result
        audio = tone(block_ms, packets)
        sent: dict[int, float] = {}
        times: list[float] = []
        states: dict[str, int] = {}

        def answers() -> None:
            try:
                while len(times) < packets:
                    out, _ = read_packet(child.stdout)
                    if out.get("type") != "output":
                        result["stopped"] = {key: out.get(key) for key in ("type", "code")}
                        return
                    times.append((time.perf_counter() - sent[out["sequence"]]) * 1000)
                    states[out.get("state", "")] = states.get(out.get("state", ""), 0) + 1
            except (EOFError, KeyError, ValueError):
                return
        reader = threading.Thread(target=answers, daemon=True)
        reader.start()
        base = time.perf_counter()
        for n in range(packets):
            if sync:
                while len(times) < n and reader.is_alive():
                    time.sleep(0.0002)
            else:
                while time.perf_counter() < base + n * block_ms / 1000:
                    time.sleep(0.0005)
            if not reader.is_alive():
                break
            now_ns = time.time_ns()
            sent[n] = time.perf_counter()
            child.stdin.write(packet({"type": "input", "session": session, "sequence": n, "start_ns": now_ns,
                                      "end_ns": now_ns + block_ms * 1_000_000, "rate": RATE, "channels": 1}, audio[n]))
            child.stdin.flush()
        reader.join(timeout=timeout_s)
        result["times"] = summary(times, block_ms)
        result["answered"] = len(times)
        result["states"] = states
    except (EOFError, ValueError, OSError) as error:
        result["error"] = type(error).__name__
    finally:
        try:
            child.stdin.close()
        except OSError:
            pass
        try:
            child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait()
        child.stdout.close()
    return result


def markdown(results: list[dict]) -> str:
    """The comparison as tables: per device and block, pooled over rounds by their ranges."""
    lines = []
    for mode, title in (("paced", "Round trip, one packet per block (ms)"), ("sync", "Time per packet, back to back (ms)")):
        rows = [r for r in results if r.get("mode") == mode and r.get("times", {}).get("n")]
        if not rows:
            continue
        lines += [f"### {title}", "", "| Device | Block | p50 | p95 | Max | Over the block | Over 240 ms | Runs |", "|---|---|---|---|---|---|---|---|"]
        for device, block in sorted({(r["device"], r["block_ms"]) for r in rows}):
            group = [r["times"] for r in rows if r["device"] == device and r["block_ms"] == block]
            span = lambda key: f"{min(g[key] for g in group)}–{max(g[key] for g in group)}" if len(group) > 1 else f"{group[0][key]}"  # noqa: E731
            over = f"{sum(g['over_block'] for g in group)} / {sum(g['n'] for g in group)}"
            late = f"{sum(g['over_late'] for g in group)} / {sum(g['n'] for g in group)}"
            lines.append(f"| {device} | {block} ms | {span('p50')} | {span('p95')} | {span('max')} | {over} | {late} | {len(group)} |")
        lines.append("")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--worker", type=Path, required=True)
    parser.add_argument("--runtime", type=Path, required=True, help="the RVC runtime folder (lib/ and assets/)")
    parser.add_argument("--directml", type=Path, help="the DirectML runtime's lib/ (Windows)")
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--devices", default="cuda,directml")
    parser.add_argument("--block-ms", default="40,80")
    parser.add_argument("--modes", default="sync,paced")
    parser.add_argument("--packets", type=int, default=300)
    parser.add_argument("--rounds", type=int, default=3)
    parser.add_argument("--json", type=Path)
    args = parser.parse_args(argv)
    devices = [d for d in args.devices.split(",") if d]
    blocks = [int(b) for b in args.block_ms.split(",") if b]
    modes = [m for m in args.modes.split(",") if m]
    if not set(modes) <= {"sync", "paced"} or not all(b in range(20, 201, 20) for b in blocks):
        parser.error("modes are sync and paced; blocks are 20 to 200 ms in steps of 20")
    results = []
    for round_ in range(1, args.rounds + 1):
        # The order turns each round, so no device always runs on a GPU fresh from the last.
        shift = (round_ - 1) % len(devices)
        for block in blocks:
            for device in devices[shift:] + devices[:shift]:
                for mode in modes:
                    session = uuid.uuid4().hex
                    command = worker_command(args.worker, args.runtime, args.model, device, block, session, args.directml)
                    result = {"round": round_, "device": device, **run_case(command, block, args.packets, mode == "sync", session)}
                    results.append(result)
                    print(json.dumps(result), flush=True)
    print()
    print(markdown(results))
    if args.json:
        args.json.write_text(json.dumps(results, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
