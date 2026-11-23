"""tools/download_retry.py and where it is used (the CI audit of 2026-11-22, item 4): a download
that failed for a passing reason starts over; a 404 or a file that does not match its pin does
not. Every apt-get update and install in CI asks apt to try a failed fetch again."""
import hashlib
from pathlib import Path
import re
import sys
import tempfile
import unittest
from unittest import mock
import urllib.error

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))

import download_retry  # noqa: E402
import runtime_libraries  # noqa: E402


def http_error(code):
    return urllib.error.HTTPError("https://example.invalid/x", code, "status", {}, None)


class Response:
    def __init__(self, data):
        self.data, self.done = data, False

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self, size=-1):
        if self.done:
            return b""
        self.done = True
        return self.data


class RetryTests(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.object(download_retry, "SLEEP")
        self.sleep = patcher.start()
        self.addCleanup(patcher.stop)
        silence = mock.patch("sys.stderr")
        silence.start()
        self.addCleanup(silence.stop)

    def test_passing_failures_are_told_from_lasting_ones(self):
        for error in (http_error(408), http_error(429), http_error(500), http_error(503), urllib.error.URLError("reset"),
                      TimeoutError(), ConnectionResetError()):
            self.assertTrue(download_retry.transient(error), error)
        for error in (http_error(404), http_error(403), ValueError("does not match its pin"), SystemExit(1)):
            self.assertFalse(download_retry.transient(error), error)

    def test_a_passing_failure_is_tried_again_after_a_wait(self):
        answers = [urllib.error.URLError("reset"), http_error(503), "data"]

        def attempt():
            answer = answers.pop(0)
            if isinstance(answer, Exception):
                raise answer
            return answer

        self.assertEqual(download_retry.retrying(attempt, "x"), "data")
        self.assertEqual([call.args[0] for call in self.sleep.call_args_list], [5, 15])

    def test_a_lasting_failure_goes_up_at_once(self):
        attempt = mock.Mock(side_effect=http_error(404))
        with self.assertRaises(urllib.error.HTTPError):
            download_retry.retrying(attempt, "x")
        self.assertEqual(attempt.call_count, 1)
        self.sleep.assert_not_called()

    def test_the_last_error_goes_up_after_the_last_try(self):
        attempt = mock.Mock(side_effect=TimeoutError("slow"))
        with self.assertRaises(TimeoutError):
            download_retry.retrying(attempt, "x")
        self.assertEqual(attempt.call_count, len(download_retry.DELAYS) + 1)

    def test_a_runtime_library_download_starts_over_after_a_reset(self):
        data = b"archive"
        archive = {"name": "lib.zip", "url": "https://example.invalid/lib.zip", "size": len(data),
                   "sha256": hashlib.sha256(data).hexdigest()}
        answers = [ConnectionResetError("reset"), Response(data)]

        def opener(url, timeout):
            answer = answers.pop(0)
            if isinstance(answer, Exception):
                raise answer
            return answer

        with tempfile.TemporaryDirectory() as cache:
            path = runtime_libraries.fetch(archive, cache, opener=opener)
            self.assertEqual(path.read_bytes(), data)
            self.assertEqual(sorted(p.name for p in Path(cache).iterdir()), ["lib.zip"], "no partial file is left")
        self.assertEqual(self.sleep.call_count, 1)


class DownloadersUseTheRetryTests(unittest.TestCase):
    def test_each_downloader_runs_its_download_through_the_retry(self):
        for name in ("runtime_libraries.py", "speechcpp_bundle.py", "sudachi_dictionary.py", "build_appimage.py",
                     "update_channels.py"):
            self.assertIn("retrying(", (ROOT / "tools" / name).read_text(encoding="utf-8"), name)

    def test_every_apt_get_update_and_install_in_ci_tries_a_failed_fetch_again(self):
        files = [*sorted((ROOT / ".github/workflows").glob("*.yml")), ROOT / "tools/ci/check_linux_package.sh"]
        found = 0
        for path in files:
            for line in path.read_text(encoding="utf-8").splitlines():
                for call in re.findall(r"apt-get [^&|;]*?\b(?:update|install)\b", line):
                    found += 1
                    self.assertIn("-o Acquire::Retries=3", call, f"{path.relative_to(ROOT)}: {line.strip()}")
        self.assertGreater(found, 0)


if __name__ == "__main__":
    unittest.main()
