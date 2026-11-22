"""tools/rvc_worker_bench.py: the numbers it reports, and one run against a stand-in worker that
speaks the VVC1 pipes (no model, no GPU)."""
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
import rvc_worker_bench as bench  # noqa: E402

# Answers `ready` for the block it is asked for, then one `output` per `input`, a little later.
FAKE_WORKER = textwrap.dedent("""
    import json, struct, sys, time
    args = sys.argv[1:]
    value = lambda name: args[args.index(name) + 1]
    session, block = value("--session"), int(value("--block-ms"))
    out, inp = sys.stdout.buffer, sys.stdin.buffer
    def send(header, pcm=b""):
        text = json.dumps({**header, "pcm_bytes": len(pcm)}).encode()
        out.write(b"VVC1" + struct.pack("<I", len(text)) + text + pcm); out.flush()
    send({"type": "ready", "protocol": 1, "session": session, "engine": "rvc", "profile": "low", "rate": 48000,
          "channels": 1, "block_frames": 48 * block, "latency_ms": 32})
    while True:
        prefix = inp.read(8)
        if len(prefix) < 8:
            break
        header = json.loads(inp.read(struct.unpack("<I", prefix[4:])[0]))
        pcm = inp.read(header["pcm_bytes"])
        time.sleep(0.002)
        send({**header, "type": "output", "state": "converted"}, bytes(len(pcm)))
""")


class NumbersTests(unittest.TestCase):
    def test_the_gpu_clock_is_read_after_the_worker_settled(self):
        # The first 30 % of a run (here up to t=3) is left out: the clock is still where it was.
        rows = [(1.0, "P8", 210, 0), (2.0, "P8", 210, 0), (4.0, "P2", 1950, 40), (6.0, "P3", 1185, 30), (9.0, "P2", 1935, 50)]
        summary = bench.clock_summary(rows, 0.0, 10.0)
        self.assertEqual(summary, {"sm_clock_p50": 1935, "sm_clock_min": 1185, "pstates": {"P2": 2, "P3": 1}, "use_mean": 40.0})
        self.assertEqual(bench.clock_summary([], 0.0, 10.0), {})

    def test_percentiles_are_numpys_linear_ones(self):
        values = [float(v) for v in range(1, 101)]
        self.assertEqual(bench.percentile(values, 50), 50.5)
        self.assertAlmostEqual(bench.percentile(values, 95), 95.05)
        self.assertEqual(bench.percentile([7.0], 95), 7.0)

    def test_the_first_answers_are_left_out_and_late_blocks_counted(self):
        times = [500.0] * bench.SETTLE + [30.0, 50.0, 90.0, 300.0]
        result = bench.summary(times, 80)
        self.assertEqual((result["n"], result["over_block"], result["over_late"], result["max"]), (4, 2, 1, 300.0))
        self.assertEqual(bench.summary([], 80), {"n": 0})

    def test_the_command_is_the_workers_own(self):
        command = bench.worker_command(Path("w"), Path("r"), Path("m.pth"), "directml", 40, "s" * 32, Path("d"))
        self.assertEqual(command[1:], ["--runtime", "r", "--model", "m.pth", "--session", "s" * 32, "--block-ms", "40",
                                       "--device", "directml", "--directml", "d"])
        self.assertNotIn("--directml", bench.worker_command(Path("w"), Path("r"), Path("m.pth"), "cuda", 80, "s", None))

    def test_a_packet_reads_back(self):
        import io
        header, pcm = bench.read_packet(io.BytesIO(bench.packet({"type": "input", "sequence": 3}, b"\x01\x02")))
        self.assertEqual((header["sequence"], header["pcm_bytes"], pcm), (3, 2, b"\x01\x02"))

    def test_the_tables_pool_the_rounds(self):
        run = lambda device, p50, mode="paced": {"device": device, "block_ms": 40, "mode": mode,  # noqa: E731
                                                  "times": {"n": 290, "p50": p50, "p95": p50 + 10, "max": p50 + 20, "over_block": 1, "over_late": 0}}
        table = bench.markdown([run("cuda", 49.1), run("cuda", 50.2), run("directml", 40.0), run("directml", 41.0, "sync")])
        self.assertIn("| cuda | 40 ms | 49.1–50.2 | 59.1–60.2 | 69.1–70.2 | 2 / 580 | 0 / 580 | 2 |", table)
        self.assertIn("| directml | 40 ms | 40.0 | 50.0 | 60.0 | 1 / 290 | 0 / 290 | 1 |", table)
        self.assertIn("Time per packet", table)


class StandInWorkerTests(unittest.TestCase):
    def test_a_run_times_every_answer(self):
        with tempfile.TemporaryDirectory() as folder:
            worker = Path(folder) / "fake_worker.py"
            worker.write_text(FAKE_WORKER)
            session = "0" * 32
            for sync in (True, False):
                command = [sys.executable, str(worker), "--session", session, "--block-ms", "20"]
                result = bench.run_case(command, 20, bench.SETTLE + 5, sync, session)
                self.assertEqual(result["first"]["type"], "ready", result)
                self.assertEqual(result["answered"], bench.SETTLE + 5)
                self.assertEqual(result["times"]["n"], 5)
                self.assertEqual(result["states"], {"converted": bench.SETTLE + 5})
                self.assertEqual(result["mode"], "sync" if sync else "paced")


if __name__ == "__main__":
    unittest.main()
