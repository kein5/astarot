"""Compare native/translate-onnx with the app's CTranslate2 translator on WMT20 test sets.

    python tools/translation_onnx/compare.py m2m100_418M --onnx DIR --cli PATH --out RESULT.json

Run it with the packages of tools/translation_onnx/requirements.txt (ctranslate2, transformers,
tokenizers, sentencepiece and sacrebleu; uv.lock held the Python backend's own pins until it went
in 0.6.0). The CTranslate2 side downloads the backend's pinned model, checks it against
ctranslate2_pins.py, and translates as its translation_translator.py did: the same tokenizer
files, the same options and the same checks. Both sides run on the CPU with 4 threads.

For each direction it takes the first N sentences of the WMT20 test set and reports:

- BLEU and chrF of each side against the references, and the difference;
- how many translations are the same on both sides, and chrF of one against the other;
- that the Rust tokenizer gives the app's source ids, and decodes as the app does.

Texts are compared in memory only; the result file holds scores and counts, no text.
"""
import argparse
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
# name -> (the app's weight type, the CTranslate2 repository it downloads)
MODELS = {
    "m2m100_418M": ("m2m100_418M-ct2-int8", "jncraton/m2m100_418M-ct2-int8"),
    "m2m100_1.2B": ("m2m100_1.2B-ct2-int8", "jncraton/m2m100_1.2B-ct2-int8"),
    "nllb-200-distilled-600M": ("nllb-200-distilled-600M-ct2-int8", "JustFrederik/nllb-200-distilled-600M-ct2-int8"),
    "nllb-200-distilled-1.3B": ("nllb-200-distilled-1.3B-ct2-int8", "OpenNMT/nllb-200-distilled-1.3B-ct2-int8"),
    "nllb-200-3.3B": ("nllb-200-3.3B-ct2-int8", "OpenNMT/nllb-200-3.3B-ct2-int8"),
}
# WMT20 directions, and each language's code for each family.
DIRECTIONS = ["en-ja", "ja-en", "en-zh", "zh-en", "en-de", "de-en", "en-ru", "ru-en"]
CODES = {
    "m2m100": {"en": "en", "ja": "ja", "zh": "zh", "de": "de", "ru": "ru"},
    "nllb": {"en": "eng_Latn", "ja": "jpn_Jpan", "zh": "zho_Hans", "de": "deu_Latn", "ru": "rus_Cyrl"},
}
# What translation_translator.py passes (checked against its source below).
MAX_INPUT_LENGTH = 1024
MAX_DECODING_LENGTH = 256
M2M100_BEAM_SIZE = 5
# utils.getBestComputeType's order for a CPU.
CPU_COMPUTE_TYPES = ["int8_bfloat16", "int8_float16", "int8", "bfloat16", "float16", "int8_float32", "float32"]


def load_pins():
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from ctranslate2_pins import MODEL_PINS, tokenizerFilePins, verifyPinnedFile
    return MODEL_PINS, tokenizerFilePins, verifyPinnedFile


class AppTranslator:
    """The app's translateCTranslate2 on the CPU, step for step."""

    def __init__(self, weight_type, repo, model_dir=None, compute_type=None):
        import ctranslate2
        import transformers
        from huggingface_hub import snapshot_download

        pins, tokenizer_pins, verify = load_pins()
        pin = pins[repo]
        path = Path(snapshot_download(repo, revision=pin["revision"]))
        for name, (size, digest) in pin["files"].items():
            if not verify(str(path / name), size, digest):
                raise SystemExit(f"{repo}/{name} does not match the app's pin")
        self.m2m100 = weight_type.startswith("m2m100")
        tokenizer_class = transformers.M2M100Tokenizer if self.m2m100 else transformers.NllbTokenizerFast
        with tempfile.TemporaryDirectory(prefix="vrct-compare-tokenizer-") as temporary:
            for name in tokenizer_pins(repo):
                shutil.copyfile(path / name, Path(temporary) / name)
            self.tokenizer = tokenizer_class.from_pretrained(temporary, local_files_only=True)
        supported = set(ctranslate2.get_supported_compute_types("cpu"))
        self.compute_type = compute_type or next(t for t in CPU_COMPUTE_TYPES if t in supported)
        # The app's tokenizer always; another model folder only to check the decoding.
        self.translator = ctranslate2.Translator(str(model_dir or path), device="cpu", device_index=0,
                                                 compute_type=self.compute_type, inter_threads=1, intra_threads=4)

    def source_ids(self, message, source_language):
        self.tokenizer.src_lang = source_language
        return self.tokenizer.encode(message, truncation=False)

    def translate(self, message, source_language, target_language):
        tokenizer = self.tokenizer
        tokenizer.src_lang = source_language
        source = tokenizer.convert_ids_to_tokens(tokenizer.encode(message, truncation=False))
        if len(source) > MAX_INPUT_LENGTH:
            return False
        decoding = {}
        if self.m2m100:
            target_prefix = [tokenizer.lang_code_to_token[target_language]]
            decoding["beam_size"] = M2M100_BEAM_SIZE
        else:
            target_prefix = [target_language]
        results = self.translator.translate_batch(
            [source], target_prefix=[target_prefix], max_input_length=0,
            max_decoding_length=MAX_DECODING_LENGTH, return_end_token=True, **decoding)
        target = results[0].hypotheses[0]
        if not target or target[-1] != tokenizer.eos_token:
            return False
        return tokenizer.decode(tokenizer.convert_tokens_to_ids(target[1:-1]))

    def decode(self, ids):
        return self.tokenizer.decode(ids)


def wmt20(direction, count):
    from sacrebleu.utils import get_reference_files, get_source_file
    with open(get_source_file("wmt20", direction), encoding="utf-8") as source:
        sources = [line.rstrip("\n") for line in source]
    with open(get_reference_files("wmt20", direction)[0], encoding="utf-8") as reference:
        references = [line.rstrip("\n") for line in reference]
    return sources[:count], references[:count]


def scores(hypotheses, references, target):
    from sacrebleu.metrics import BLEU, CHRF
    tokenize = "char" if target in ("ja", "zh") else "13a"
    # A failed translation counts as an empty one.
    hypotheses = [h if isinstance(h, str) else "" for h in hypotheses]
    return dict(bleu=round(BLEU(tokenize=tokenize).corpus_score(hypotheses, [references]).score, 2),
                chrf=round(CHRF().corpus_score(hypotheses, [references]).score, 2))


def run_onnx(cli, folder, requests):
    child = subprocess.Popen([cli, folder, "--device", "cpu"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, text=True, encoding="utf-8")
    results = []
    began = time.perf_counter()
    for request in requests:
        child.stdin.write(json.dumps(request, ensure_ascii=False) + "\n")
        child.stdin.flush()
        results.append(json.loads(child.stdout.readline()))
    elapsed = time.perf_counter() - began
    child.stdin.close()
    backend = child.stderr.readline().strip()
    child.wait(timeout=60)
    return results, elapsed, backend


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("model", choices=sorted(MODELS))
    parser.add_argument("--onnx", required=True, help="the folder export.py wrote")
    parser.add_argument("--cli", required=True, help="native/translate-onnx's vrct-translate, a release build")
    parser.add_argument("--sentences", type=int, default=100, help="sentences per direction")
    parser.add_argument("--directions", default=",".join(DIRECTIONS),
                        help="comma-separated WMT20 directions, all eight unless given")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--ct2-model", type=Path,
                        help="a CTranslate2 model folder in place of the app's, such as a float32 conversion")
    parser.add_argument("--compute-type", help="CTranslate2's compute type in place of the app's choice")
    args = parser.parse_args()

    directions = [d for d in args.directions.split(",") if d]
    if not directions or any(d not in DIRECTIONS for d in directions):
        raise SystemExit(f"directions must be among {','.join(DIRECTIONS)}")
    weight_type, repo = MODELS[args.model]
    app = AppTranslator(weight_type, repo, args.ct2_model, args.compute_type)
    family = "m2m100" if app.m2m100 else "nllb"
    manifest = json.loads((Path(args.onnx) / "manifest.json").read_text(encoding="utf-8"))
    report = dict(
        model=args.model, app_weight=weight_type, app_repository=repo, onnx=manifest["name"],
        ct2_model="the app's pinned model" if args.ct2_model is None else f"a local conversion ({args.ct2_model.name})",
        onnx_files={name: pin["sha256"] for name, pin in manifest["files"].items()},
        sentences_per_direction=args.sentences, test_set="wmt20 (sacrebleu), first sentences of each direction",
        environment=dict(machine=platform.machine(), system=platform.system(), processor=cpu_name(),
                         ctranslate2_compute_type=app.compute_type, threads=4, packages=packages()),
        directions={}, totals={})
    totals = dict(sentences=0, same=0, source_ids_differ=0, decode_differs=0, app_failed=0, onnx_failed=0,
                  app_seconds=0.0, onnx_seconds=0.0)
    for direction in directions:
        source_language, target_language = direction.split("-")
        source_code, target_code = CODES[family][source_language], CODES[family][target_language]
        sources, references = wmt20(direction, args.sentences)

        began = time.perf_counter()
        app_texts = [app.translate(text, source_code, target_code) for text in sources]
        app_seconds = time.perf_counter() - began
        requests = [dict(text=text, **{"from": source_code, "to": target_code}) for text in sources]
        onnx_results, onnx_seconds, backend = run_onnx(args.cli, args.onnx, requests)
        onnx_texts = [result.get("text", False) for result in onnx_results]

        source_ids_differ = sum(app.source_ids(text, source_code) != result.get("source_ids")
                                for text, result in zip(sources, onnx_results))
        decode_differs = sum(app.decode(result["target_ids"][1:-1]) != result["text"]
                             for result in onnx_results if "text" in result)
        same = sum(isinstance(a, str) and a == o for a, o in zip(app_texts, onnx_texts))
        from sacrebleu.metrics import CHRF
        agreement = CHRF().corpus_score([o if isinstance(o, str) else "" for o in onnx_texts],
                                        [[a if isinstance(a, str) else "" for a in app_texts]]).score
        row = dict(
            app=scores(app_texts, references, target_language),
            onnx=scores(onnx_texts, references, target_language),
            same_translation=same, chrf_onnx_against_app=round(agreement, 2),
            source_ids_differ=source_ids_differ, decode_differs=decode_differs,
            app_failed=sum(not isinstance(t, str) for t in app_texts),
            onnx_failed=sum(not isinstance(t, str) for t in onnx_texts),
            onnx_errors=sorted({r["error"] for r in onnx_results if "error" in r}),
            app_seconds=round(app_seconds, 1), onnx_seconds=round(onnx_seconds, 1), onnx_backend=backend)
        row["bleu_difference"] = round(row["onnx"]["bleu"] - row["app"]["bleu"], 2)
        row["chrf_difference"] = round(row["onnx"]["chrf"] - row["app"]["chrf"], 2)
        report["directions"][direction] = row
        for key in ("same", "source_ids_differ", "decode_differs", "app_failed", "onnx_failed"):
            totals[key] += row["same_translation" if key == "same" else key]
        totals["sentences"] += len(sources)
        totals["app_seconds"] += app_seconds
        totals["onnx_seconds"] += onnx_seconds
        print(direction, json.dumps(row, ensure_ascii=False), flush=True)
    totals["app_seconds"] = round(totals["app_seconds"], 1)
    totals["onnx_seconds"] = round(totals["onnx_seconds"], 1)
    rows = report["directions"].values()
    totals["mean_bleu_difference"] = round(sum(r["bleu_difference"] for r in rows) / len(directions), 2)
    totals["mean_chrf_difference"] = round(sum(r["chrf_difference"] for r in rows) / len(directions), 2)
    report["totals"] = totals
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(totals))
    return 0


def cpu_name():
    try:
        for line in Path("/proc/cpuinfo").read_text(encoding="utf-8").splitlines():
            if line.startswith("model name"):
                return line.split(":", 1)[1].strip()
    except OSError:
        pass
    return platform.processor()


def packages():
    from importlib.metadata import version
    return {name: version(name) for name in ("ctranslate2", "transformers", "tokenizers", "sentencepiece", "sacrebleu")}


if __name__ == "__main__":
    os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
    sys.exit(main())
