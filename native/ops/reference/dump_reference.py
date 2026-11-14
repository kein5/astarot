"""Write what the Python download module produces, for the Rust crate's tests to compare against.

    python native/ops/reference/dump_reference.py            # rewrite tests/data/python_reference.json
    python native/ops/reference/dump_reference.py --check    # fail if the file is out of date

The file holds the download catalog as the backend answers it (with a fixed root), the URL of
every artifact, and the receipt.json and owner.json of every entry, byte for byte. Nothing here
opens the network or reads a model. tests/voice/test_native_ops_reference.py runs --check.
"""
from dataclasses import asdict
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]
OUTPUT = Path(__file__).resolve().parents[1] / "tests" / "data" / "python_reference.json"
# A fixed, absolute root, so the destinations do not depend on the PC that wrote the file.
FIXED_ROOT = "/vrct-ops-reference/downloaded_models"


def reference():
    sys.path.insert(0, str(ROOT / "src-python"))
    from models.model_downloads.catalog import CATALOG, SPEECH_FIELDS, TARGETS, artifact_url
    from models.model_downloads.manager import Downloads

    downloads = Downloads(FIXED_ROOT)
    catalog = downloads.catalog()
    # The destination is an OS path ("D:\\vrct-ops-reference\\..." on Windows). Written with "/"
    # from the fixed root, the file is the same on every OS; the check below keeps it the
    # backend's own <root>/<id>/<revision>.
    for row in catalog["models"]:
        expected = Path(FIXED_ROOT).absolute() / row["id"] / row["revision"]
        assert Path(row["destination"]) == expected, row["id"]
        row["destination"] = f"{FIXED_ROOT}/{row['id']}/{row['revision']}"
    receipts, owners, urls = {}, {}, {}
    for model in CATALOG:
        receipts[model.id] = json.dumps(asdict(model), ensure_ascii=False, indent=2)
        owners[model.id] = json.dumps(dict(product="VRCT-VOX-model-download-v1", id=model.id, revision=model.revision,
                                           files=[a.filename for a in model.artifacts],
                                           directory=".partial-" + "0" * 32))
        urls[model.id] = [artifact_url(model, artifact) for artifact in model.artifacts]
    return {"root": FIXED_ROOT, "catalog": catalog, "urls": urls, "receipts": receipts, "owners": owners,
            "targets": list(TARGETS), "speech_fields": {k: list(v) for k, v in SPEECH_FIELDS.items()}}


def render():
    return json.dumps(reference(), ensure_ascii=False, indent=1) + "\n"


def main(argv):
    text = render()
    if argv[1:] == ["--check"]:
        current = OUTPUT.read_text(encoding="utf-8") if OUTPUT.exists() else ""
        if current != text:
            print(f"{OUTPUT} is out of date: run python native/ops/reference/dump_reference.py", file=sys.stderr)
            return 1
        return 0
    if argv[1:]:
        print(__doc__, file=sys.stderr)
        return 2
    OUTPUT.write_text(text, encoding="utf-8", newline="\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
