"""tools/sudachi_dictionary.py: the pinned SudachiDict is checked before it is staged."""
import hashlib
import io
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
import app_resources  # noqa: E402
import sudachi_dictionary as sd  # noqa: E402

DICTIONARY = b"dictionary bytes"


def archive(path, edition="small", dictionary=DICTIONARY):
    folder = f"sudachi-dictionary-{sd.VERSION}"
    with zipfile.ZipFile(path, "w") as bundle:
        bundle.writestr(f"{folder}/system_{edition}.dic", dictionary)
        bundle.writestr(f"{folder}/LEGAL", "legal")
        bundle.writestr(f"{folder}/LICENSE-2.0.txt", "apache")
    return path


def pinned(data):
    return dict(size=len(data), sha256=hashlib.sha256(data).hexdigest())


class SudachiDictionaryTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_every_edition_is_pinned_from_the_official_archive(self):
        self.assertEqual(set(sd.EDITIONS), {"full", "core", "small"})
        for edition, values in sd.EDITIONS.items():
            self.assertTrue(sd.url(edition).startswith("https://"), edition)
            self.assertEqual(len(values["sha256"]), 64)
            self.assertEqual(len(values["archive_sha256"]), 64)

    def test_a_checked_dictionary_is_staged_with_its_license_texts(self):
        zipped = archive(self.dir / "small.zip")
        editions = {"small": dict(pinned(DICTIONARY), archive_size=0, archive_sha256="")}
        with mock.patch.dict(sd.EDITIONS, editions):
            record = sd.stage(zipped, "small", self.dir / "out")
            self.assertEqual(sd.check(self.dir / "out"), [])
        self.assertEqual(record["edition"], "small")
        self.assertEqual(sorted(p.name for p in (self.dir / "out").iterdir()),
                         ["LEGAL", "LICENSE-2.0.txt", "dictionary.json", "system.dic"])
        self.assertEqual(json.loads((self.dir / "out/dictionary.json").read_text())["license"], "Apache-2.0")
        # The app's _internal carries the folder as it is.
        build = self.dir
        (build / "sudachi").mkdir()
        (build / "sudachi/system.dic").write_bytes(DICTIONARY)
        names = {target for _, target in app_resources.pairs("windows", build, ROOT)}
        self.assertIn("build/sudachi/system.dic", names)

    def test_a_dictionary_that_differs_from_the_pin_is_refused(self):
        zipped = archive(self.dir / "small.zip", dictionary=b"something else")
        editions = {"small": dict(pinned(DICTIONARY), archive_size=0, archive_sha256="")}
        with mock.patch.dict(sd.EDITIONS, editions), self.assertRaises(SystemExit):
            sd.stage(zipped, "small", self.dir / "out")
        self.assertFalse((self.dir / "out").exists())

    def test_a_download_that_differs_from_the_pin_is_refused(self):
        def opener(url, timeout):
            self.assertEqual(url, sd.url("core"))
            return io.BytesIO(b"not the archive")
        with self.assertRaises(SystemExit):
            sd.download_archive("core", self.dir / "core.zip", opener=opener)

    def test_the_packages_ship_full_and_fetch_takes_it_by_default(self):
        # Decision 3 (2026-11-21, #924): the readings 0.4 gave.
        self.assertEqual(sd.SHIPPED_EDITION, "full")
        with mock.patch.object(sd, "ensure", return_value=dict(version=sd.VERSION, edition="full", size=1)) as ensure:
            self.assertEqual(sd.main(["fetch", "--output", str(self.dir / "out")]), 0)
        self.assertEqual(ensure.call_args.args[0], "full")
        for name in ("bat/build.bat", "tools/build_linux.py"):
            source = (ROOT / name).read_text(encoding="utf-8")
            self.assertTrue("sudachi_dictionary.py fetch --edition full" in source or "SHIPPED_EDITION" in source, name)

    def test_a_checked_folder_of_the_edition_is_kept_and_another_is_replaced(self):
        served = io.BytesIO()
        archive(served, "core", b"core bytes")
        served = served.getvalue()
        editions = {"small": dict(pinned(DICTIONARY), archive_size=0, archive_sha256=""),
                    "core": dict(pinned(b"core bytes"), archive_size=len(served),
                                 archive_sha256=hashlib.sha256(served).hexdigest())}
        downloads = []

        def opener(url, timeout):
            downloads.append(url)
            return io.BytesIO(served)
        with mock.patch.dict(sd.EDITIONS, editions):
            sd.stage(archive(self.dir / "small.zip"), "small", self.dir / "out")
            # The same edition, checked: kept, nothing downloaded.
            self.assertEqual(sd.ensure("small", self.dir / "out", opener=opener)["edition"], "small")
            self.assertEqual(downloads, [])
            # Another edition: downloaded to the archive given, then staged in place of it.
            kept = self.dir / "archives" / sd.archive_name("core")
            self.assertEqual(sd.ensure("core", self.dir / "out", archive=kept, opener=opener)["edition"], "core")
            self.assertEqual(downloads, [sd.url("core")])
            self.assertTrue(kept.is_file())
            self.assertEqual(sd.check(self.dir / "out"), [])
            # The archive kept before serves the next build without the network.
            (self.dir / "out/system.dic").write_bytes(b"damaged")
            sd.ensure("core", self.dir / "out", archive=kept, download=False, opener=opener)
            self.assertEqual(downloads, [sd.url("core")])
            with self.assertRaises(SystemExit):
                sd.ensure("small", self.dir / "elsewhere", archive=self.dir / "none.zip", download=False)

    def test_a_staged_folder_without_its_record_is_incomplete(self):
        self.assertEqual(sd.check(self.dir), ["dictionary.json"])


if __name__ == "__main__":
    unittest.main()
