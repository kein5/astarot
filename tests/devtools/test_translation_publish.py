"""tools/translation_onnx/publish.py without the network: staging, the catalog entry, its file."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from tools.translation_onnx import publish

REVISION = "c" * 40


def make_folder(root, name="m2m100_418M", variant="int8", license="MIT", data=False):
    folder = Path(root) / f"{name}-onnx-{variant}"
    folder.mkdir(parents=True)
    contents = {
        "encoder_model_quantized.onnx": b"encoder",
        "decoder_model_merged_quantized.onnx": b"decoder",
        "vocabulary.data": b"vocabulary",
        "tokenizer.json": b"{}",
        "vocab.json": b"{}",
    }
    if data:
        contents["decoder_model_merged_quantized.onnx_data"] = b"weights"
    for filename, body in contents.items():
        (folder / filename).write_bytes(body)
    manifest = {
        "schema": 2,
        "name": f"{name}-onnx-{variant}",
        "family": "m2m100" if name.startswith("m2m100") else "nllb",
        "variant": variant,
        "license": license,
        "source": {"repository": f"facebook/{name}", "revision": "d" * 40},
        "encoder": "encoder_model_quantized.onnx",
        "decoder": "decoder_model_merged_quantized.onnx",
        "verified_max_difference": 1e-5,
        "made_with": {"torch": "2.15.0", "onnx": "1.23.2"},
        "files": {filename: {"size": len(body), "sha256": hashlib.sha256(body).hexdigest()} for filename, body in contents.items()},
    }
    (folder / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    return folder, manifest


def pins_of(folder, manifest):
    pins = {name: (pin["size"], pin["sha256"]) for name, pin in manifest["files"].items()}
    path = folder / "manifest.json"
    pins["manifest.json"] = (path.stat().st_size, publish.sha256(path))
    return pins


class StageTests(unittest.TestCase):
    def test_a_staged_folder_has_the_files_the_card_and_the_licence(self):
        with tempfile.TemporaryDirectory() as root:
            folder, _ = make_folder(root)
            licence = Path(root) / "LICENSE.source"
            licence.write_text("MIT License\n", encoding="utf-8")
            out = publish.stage(folder, "owner/m2m100_418M-onnx-int8", Path(root) / "staged", licence)
            names = sorted(path.name for path in out.iterdir())
            self.assertEqual(names, sorted(["LICENSE", "README.md", "manifest.json", "encoder_model_quantized.onnx",
                                            "decoder_model_merged_quantized.onnx", "vocabulary.data", "tokenizer.json",
                                            "vocab.json"]))
            card = (out / "README.md").read_text(encoding="utf-8")
            self.assertIn("license: mit", card)
            self.assertIn("base_model: facebook/m2m100_418M", card)
            self.assertIn("not an official release", card)
            self.assertIn(hashlib.sha256(b"encoder").hexdigest(), card)

    def test_mit_needs_its_text_and_a_changed_file_is_refused(self):
        with tempfile.TemporaryDirectory() as root:
            folder, _ = make_folder(root)
            with self.assertRaises(SystemExit):
                publish.stage(folder, "owner/x", Path(root) / "staged")
            (folder / "vocab.json").write_bytes(b"[]")
            with self.assertRaises(SystemExit):
                publish.stage(folder, "owner/x", Path(root) / "staged2", Path(root) / "nothing")

    def test_a_non_commercial_card_says_so(self):
        with tempfile.TemporaryDirectory() as root:
            folder, _ = make_folder(root, name="nllb-200-distilled-600M", license="CC-BY-NC-4.0")
            out = publish.stage(folder, "owner/nllb", Path(root) / "staged")
            card = (out / "README.md").read_text(encoding="utf-8")
            self.assertIn("license: cc-by-nc-4.0", card)
            self.assertIn("Non-commercial use only", card)
            self.assertFalse((out / "LICENSE").exists())


class EntryTests(unittest.TestCase):
    def test_the_entry_pins_every_published_file_with_its_role(self):
        with tempfile.TemporaryDirectory() as root:
            folder, manifest = make_folder(root, data=True)
            new = publish.entry(manifest, "owner/m2m100_418M-onnx-int8", REVISION, pins_of(folder, manifest))
            self.assertEqual(new["id"], "m2m100-418m-onnx-int8")
            self.assertEqual(new["name"], "M2M100 418M · int8")
            self.assertEqual(new["revision"], REVISION)
            roles = {artifact["filename"]: artifact["role"] for artifact in new["artifacts"]}
            self.assertEqual(roles["manifest.json"], "manifest")
            self.assertEqual(roles["encoder_model_quantized.onnx"], "encoder")
            self.assertEqual(roles["vocabulary.data"], "weights")
            self.assertEqual(roles["decoder_model_merged_quantized.onnx_data"], "data")
            self.assertEqual(new["licenses"], [f"https://huggingface.co/owner/m2m100_418M-onnx-int8/blob/{REVISION}/README.md",
                                               f"https://huggingface.co/owner/m2m100_418M-onnx-int8/blob/{REVISION}/LICENSE"])

    def test_a_published_file_that_differs_or_a_short_revision_is_refused(self):
        with tempfile.TemporaryDirectory() as root:
            folder, manifest = make_folder(root)
            pins = pins_of(folder, manifest)
            pins["vocab.json"] = (2, "0" * 64)
            with self.assertRaises(SystemExit):
                publish.entry(manifest, "owner/x", REVISION, pins)
            with self.assertRaises(SystemExit):
                publish.entry(manifest, "owner/x", "main", pins_of(folder, manifest))

    def test_nllb_cites_the_licence_deed(self):
        with tempfile.TemporaryDirectory() as root:
            folder, manifest = make_folder(root, name="nllb-200-distilled-600M", variant="float16", license="CC-BY-NC-4.0")
            new = publish.entry(manifest, "owner/nllb", REVISION, pins_of(folder, manifest))
            self.assertEqual(new["id"], "nllb-200-distilled-600m-onnx-float16")
            self.assertIn("https://creativecommons.org/licenses/by-nc/4.0/", new["licenses"])

    def test_writing_replaces_the_same_id_and_keeps_the_order(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "translation_models.json"
            path.write_text(json.dumps({"models": [{"id": "z"}, {"id": "a-onnx-int8", "old": True}]}), encoding="utf-8")
            publish.write_entry({"id": "a-onnx-int8"}, path)
            publish.write_entry({"id": "m-onnx-int8"}, path)
            data = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual([model["id"] for model in data["models"]], ["a-onnx-int8", "m-onnx-int8", "z"])
            self.assertNotIn("old", data["models"][0])

    def test_the_shipped_data_file_is_a_list_of_entries(self):
        data = json.loads(publish.CATALOG_DATA.read_text(encoding="utf-8"))
        self.assertEqual(list(data), ["models"])


if __name__ == "__main__":
    unittest.main()
