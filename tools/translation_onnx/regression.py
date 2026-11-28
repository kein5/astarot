"""Check that two ONNX bundles of one model translate the same, on compare.py's sentences.

    python tools/translation_onnx/regression.py --cli PATH --before DIR --after DIR --out RESULT.json

For a change to how export.py stores a model (such as storing a weight once), the bundle
it writes has to translate as the one before it did. Both bundles run through
native/translate-onnx's astarot-translate on the CPU, over the first N sentences of each
WMT20 direction, the same sentences compare.py takes. For each direction it reports how
many outputs have the same target ids, the failures on each side, and BLEU and chrF of
each side against the references.

Only sacrebleu is needed. Texts are compared in memory only; the result file holds
scores and counts, no text.
"""
import argparse
import json
from pathlib import Path
import sys

from compare import CODES, DIRECTIONS, cpu_name, run_onnx, scores, wmt20


def bundle(folder):
    manifest = json.loads((Path(folder) / "manifest.json").read_text(encoding="utf-8"))
    return manifest, sum(pin["size"] for pin in manifest["files"].values())


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--cli", required=True, help="native/translate-onnx's astarot-translate, a release build")
    parser.add_argument("--before", required=True, help="the bundle to compare against")
    parser.add_argument("--after", required=True, help="the bundle being checked")
    parser.add_argument("--sentences", type=int, default=100, help="sentences per direction")
    parser.add_argument("--directions", default=",".join(DIRECTIONS),
                        help="comma-separated WMT20 directions, all eight unless given")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    directions = [d for d in args.directions.split(",") if d]
    if not directions or any(d not in DIRECTIONS for d in directions):
        raise SystemExit(f"directions must be among {','.join(DIRECTIONS)}")
    (before, before_size), (after, after_size) = bundle(args.before), bundle(args.after)
    if before["family"] != after["family"] or before["source"] != after["source"]:
        raise SystemExit("the two bundles are not made from the same model")
    family = before["family"]
    report = dict(
        before=dict(name=before["name"], bytes=before_size, files={n: p["sha256"] for n, p in before["files"].items()}),
        after=dict(name=after["name"], bytes=after_size, files={n: p["sha256"] for n, p in after["files"].items()}),
        source=before["source"], sentences_per_direction=args.sentences,
        test_set="wmt20 (sacrebleu), first sentences of each direction",
        environment=dict(processor=cpu_name()), directions={}, totals={})
    totals = dict(sentences=0, same_ids=0, before_failed=0, after_failed=0, before_seconds=0.0, after_seconds=0.0)
    for direction in directions:
        source_language, target_language = direction.split("-")
        source_code, target_code = CODES[family][source_language], CODES[family][target_language]
        sources, references = wmt20(direction, args.sentences)
        requests = [dict(text=text, **{"from": source_code, "to": target_code}) for text in sources]
        old, old_seconds, _ = run_onnx(args.cli, args.before, requests)
        new, new_seconds, backend = run_onnx(args.cli, args.after, requests)
        row = dict(
            same_ids=sum("target_ids" in a and a.get("target_ids") == b.get("target_ids") for a, b in zip(old, new)),
            before=scores([r.get("text", False) for r in old], references, target_language),
            after=scores([r.get("text", False) for r in new], references, target_language),
            before_failed=sum("text" not in r for r in old), after_failed=sum("text" not in r for r in new),
            before_seconds=round(old_seconds, 1), after_seconds=round(new_seconds, 1), backend=backend)
        row["bleu_difference"] = round(row["after"]["bleu"] - row["before"]["bleu"], 2)
        row["chrf_difference"] = round(row["after"]["chrf"] - row["before"]["chrf"], 2)
        report["directions"][direction] = row
        totals["sentences"] += len(sources)
        for key in ("same_ids", "before_failed", "after_failed", "before_seconds", "after_seconds"):
            totals[key] += row[key]
        print(direction, json.dumps(row), flush=True)
    rows = report["directions"].values()
    totals["before_seconds"] = round(totals["before_seconds"], 1)
    totals["after_seconds"] = round(totals["after_seconds"], 1)
    totals["mean_bleu_difference"] = round(sum(r["bleu_difference"] for r in rows) / len(directions), 2)
    totals["mean_chrf_difference"] = round(sum(r["chrf_difference"] for r in rows) / len(directions), 2)
    report["totals"] = totals
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(totals))
    return 0 if totals["same_ids"] == totals["sentences"] else 1


if __name__ == "__main__":
    sys.exit(main())
