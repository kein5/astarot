"""Publish an export.py folder and register it in the model download catalog.

    python tools/translation_onnx/publish.py stage FOLDER --repo OWNER/NAME --out STAGING [--license-file FILE]
    python tools/translation_onnx/publish.py upload STAGING --repo OWNER/NAME
    python tools/translation_onnx/publish.py catalog FOLDER --repo OWNER/NAME --revision COMMIT [--write]

stage    copies the folder's files and writes the model card (README.md: the source model and
         its licence, what was changed, how it was made, each file's SHA-256) and, for a
         licence that asks for its text with the copies (MIT), LICENSE from --license-file.
upload   creates the repository if needed and uploads STAGING as one commit (needs a write
         token in HF_TOKEN). Publishing is an outward step: run it only after the maintainer
         has checked the staged folder, the licence and the repository name.
catalog  reads the published files at COMMIT (sizes and SHA-256 from the Hub, the small files
         downloaded and hashed), checks them against the folder's manifest, and prints the
         entry for native/ops/data/translation_models.json; --write puts it there (replacing
         an entry with the same id). Then raise CATALOG_VERSION (native/ops/data/README.md).

Nothing here runs in the app. The network steps need huggingface_hub (requirements.txt).
"""
import argparse
import hashlib
import json
import os
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CATALOG_DATA = ROOT / "native" / "ops" / "data" / "translation_models.json"
# What the download dialog shows for each source model.
DISPLAY = {
    "m2m100_418M": "M2M100 418M",
    "m2m100_1.2B": "M2M100 1.2B",
    "nllb-200-distilled-600M": "NLLB-200 distilled 600M",
    "nllb-200-distilled-1.3B": "NLLB-200 distilled 1.3B",
    "nllb-200-3.3B": "NLLB-200 3.3B",
}
PROVIDER = "Meta / VRCT-VOX"
# The creators of each source family, named on the model card as the licences ask (CC-BY).
AUTHORS = {"m2m100": "Meta AI (FAIR)", "nllb": "Meta AI (the NLLB team)"}
# What each variant changed in the weights, for the model card's list of changes.
VARIANT_CHANGES = {
    "int8": "dynamic int8 weights of every MatMul (ONNX Runtime `quantize_dynamic`); the vocabulary matrix "
            "(the embeddings, and the output layer transposed) is stored once, in `vocabulary.data`",
    "float32": "none; the weights are the source model's",
    "float16": "float16 weights and computation (ONNX Runtime `convert_float_to_float16`); inputs and outputs "
               "stay float32",
    "int4": "int4 weights of every MatMul with a constant weight (ONNX Runtime `MatMulNBitsQuantizer`, blocks "
            "of 32, symmetric)",
}
# The licences whose copies must carry the licence text, and those cited by their deed.
NEEDS_TEXT = {"MIT"}
DEEDS = {"CC-BY-NC-4.0": "https://creativecommons.org/licenses/by-nc/4.0/"}
MANIFEST = "manifest.json"


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def read_manifest(folder):
    manifest = json.loads((Path(folder) / MANIFEST).read_text(encoding="utf-8"))
    if manifest.get("schema") != 2 or not manifest.get("variant"):
        raise SystemExit("the folder is not an export.py folder of schema 2")
    return manifest


def source_name(manifest):
    """The export.py name the folder was made from (`m2m100_418M`)."""
    suffix = f"-onnx-{manifest['variant']}"
    if not manifest["name"].endswith(suffix):
        raise SystemExit("the manifest's name does not end with -onnx-<variant>")
    return manifest["name"][: -len(suffix)]


def catalog_id(manifest):
    """`m2m100_418M-onnx-int8` -> `m2m100-418m-onnx-int8` (native/core's catalog_id)."""
    return manifest["name"].lower().replace("_", "-").replace(".", "-")


def role(filename, manifest):
    if filename == MANIFEST:
        return "manifest"
    if filename == manifest["encoder"]:
        return "encoder"
    if filename == manifest["decoder"]:
        return "decoder"
    if filename == "tokenizer.json":
        return "tokenizer"
    if filename == "vocab.json":
        return "vocabulary"
    if filename == "vocabulary.data":
        return "weights"
    if filename.endswith((".onnx_data", ".onnx.data")):
        return "data"
    raise SystemExit(f"{filename}: no catalog role for this file")


def model_card(manifest, repo):
    source = manifest["source"]
    name = source_name(manifest)
    license = manifest["license"]
    base = source.get("repository", name)
    lines = [
        "---",
        f"license: {license.lower()}",
        f"base_model: {base}",
        "library_name: onnx",
        "pipeline_tag: translation",
        "tags:",
        "  - onnx",
        "  - vrct-vox",
        "---",
        "",
        f"# {DISPLAY.get(name, name)} · {manifest['variant']} (ONNX)",
        "",
        f"This repository holds [{base}](https://huggingface.co/{base}) converted to ONNX for the local "
        "translation of VRCT-VOX (`native/translate-onnx`). It is not an official release of the original model.",
        "",
        "## Source and licence",
        "",
        f"- Source model: [{base}](https://huggingface.co/{base}) at commit `{source.get('revision', 'unknown')}`.",
    ]
    if manifest.get("family") in AUTHORS:
        lines.append(f"- Authors of the source model: {AUTHORS[manifest['family']]}. They did not make or endorse "
                     "this conversion.")
    lines += [
        f"- Licence: {license}, the licence of the source model. These files are a modified version of it and stay "
        "under the same licence.",
    ]
    if license in DEEDS:
        lines.append(f"- Licence text: {DEEDS[license]}. Non-commercial use only.")
    if license in NEEDS_TEXT:
        lines.append("- The licence text is in `LICENSE`.")
    lines += [
        "",
        "## Changes from the source model",
        "",
        "- The model's own layers were exported with `torch.onnx.export` into an encoder graph and a decoder graph "
        "whose first step and cached steps are one graph (`use_cache_branch`); the export was checked against "
        f"transformers' forward pass (largest difference {manifest.get('verified_max_difference')}).",
        f"- Quantization: `{manifest['variant']}`: {VARIANT_CHANGES.get(manifest['variant'], 'see manifest.json')}.",
        "- `tokenizer.json` and `vocab.json` give the same ids as the source model's tokenizer.",
        "",
        "## How it was made",
        "",
        "`tools/translation_onnx/export.py` of VRCT-VOX, with "
        + ", ".join(f"{package} {version}" for package, version in sorted(manifest.get("made_with", {}).items()))
        + ".",
        "",
        "## Files",
        "",
        "| File | Bytes | SHA-256 |",
        "|---|---:|---|",
    ]
    for filename, pin in sorted(manifest["files"].items()):
        lines.append(f"| `{filename}` | {pin['size']} | `{pin['sha256']}` |")
    lines += ["", f"`{MANIFEST}` lists the same sizes and hashes. Repository: `{repo}`.", ""]
    return "\n".join(lines)


def stage(folder, repo, out, license_file=None):
    folder, out = Path(folder), Path(out)
    manifest = read_manifest(folder)
    for filename, pin in manifest["files"].items():
        path = folder / filename
        if not path.is_file() or path.stat().st_size != pin["size"] or sha256(path) != pin["sha256"]:
            raise SystemExit(f"{filename} differs from the manifest")
    if manifest["license"] in NEEDS_TEXT and license_file is None:
        raise SystemExit(f"{manifest['license']} asks for its text with the copies: give --license-file")
    out.mkdir(parents=True, exist_ok=False)
    for filename in [MANIFEST, *manifest["files"]]:
        shutil.copyfile(folder / filename, out / filename)
    if license_file is not None:
        shutil.copyfile(license_file, out / "LICENSE")
    (out / "README.md").write_text(model_card(manifest, repo), encoding="utf-8")
    return out


def upload(staging, repo):
    from huggingface_hub import HfApi

    token = os.environ.get("HF_TOKEN")
    if not token:
        raise SystemExit("set HF_TOKEN to a write token of the repository's owner")
    api = HfApi(token=token)
    api.create_repo(repo, repo_type="model", exist_ok=True)
    commit = api.upload_folder(repo_id=repo, folder_path=str(staging), repo_type="model",
                               commit_message="Add the ONNX export for VRCT-VOX")
    return commit.oid


def remote_pins(repo, revision, filenames):
    """{filename: (size, sha256)} of the files at the revision, as the Hub serves them."""
    from huggingface_hub import HfApi, hf_hub_download

    pins = {}
    for info in HfApi().get_paths_info(repo, filenames, revision=revision, expand=True):
        lfs = getattr(info, "lfs", None)
        if lfs is not None:
            pins[info.path] = (lfs.size, lfs.sha256)
        else:
            # Small files are not in LFS; the Hub gives their git hash, so hash them here.
            path = hf_hub_download(repo, info.path, revision=revision)
            pins[info.path] = (Path(path).stat().st_size, sha256(path))
    return pins


def entry(manifest, repo, revision, pins, notice=None):
    """The translation_models.json entry, after checking the published files.

    notice: the download review's text for this model, one of TRANSLATION_NOTICES in catalog.rs
    (`model_downloads.notice_<notice>` in locales/); None for the general `translation`.
    """
    license = manifest["license"]
    if notice is not None and not (notice.replace("_", "").isalnum() and notice == notice.lower()):
        raise SystemExit("the notice is a lower-case name such as translation_nllb_600m")
    if len(revision) != 40 or any(c not in "0123456789abcdef" for c in revision):
        raise SystemExit("the revision is a full commit hash")
    files = [MANIFEST, *sorted(manifest["files"])]
    for filename in files[1:]:
        want = manifest["files"][filename]
        if pins.get(filename) != (want["size"], want["sha256"]):
            raise SystemExit(f"{filename} at {revision} differs from the manifest")
    if MANIFEST not in pins:
        raise SystemExit(f"{MANIFEST} is not at {revision}")
    licenses = [f"https://huggingface.co/{repo}/blob/{revision}/README.md"]
    if license in NEEDS_TEXT:
        licenses.append(f"https://huggingface.co/{repo}/blob/{revision}/LICENSE")
    if license in DEEDS:
        licenses.append(DEEDS[license])
    name = source_name(manifest)
    new = {
        "id": catalog_id(manifest),
        "name": f"{DISPLAY.get(name, name)} · {manifest['variant']}",
        "provider": PROVIDER,
        "repo": repo,
        "revision": revision,
        "license": license,
        "licenses": licenses,
    }
    if notice not in (None, "translation"):
        new["notice"] = notice
    new["artifacts"] = [
        {"filename": filename, "size": pins[filename][0], "sha256": pins[filename][1], "role": role(filename, manifest)}
        for filename in files
    ]
    return new


def write_entry(new, path=CATALOG_DATA):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    models = [model for model in data["models"] if model["id"] != new["id"]]
    models.append(new)
    data["models"] = sorted(models, key=lambda model: model["id"])
    Path(path).write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    commands = parser.add_subparsers(dest="command", required=True)
    staged = commands.add_parser("stage")
    staged.add_argument("folder", type=Path)
    staged.add_argument("--repo", required=True)
    staged.add_argument("--out", type=Path, required=True)
    staged.add_argument("--license-file", type=Path)
    uploaded = commands.add_parser("upload")
    uploaded.add_argument("staging", type=Path)
    uploaded.add_argument("--repo", required=True)
    listed = commands.add_parser("catalog")
    listed.add_argument("folder", type=Path)
    listed.add_argument("--repo", required=True)
    listed.add_argument("--revision", required=True)
    listed.add_argument("--write", action="store_true")
    listed.add_argument("--notice", help="the download review's text for this model, a name in "
                                          "TRANSLATION_NOTICES of catalog.rs (default: translation)")
    args = parser.parse_args()
    if args.command == "stage":
        print(stage(args.folder, args.repo, args.out, args.license_file))
    elif args.command == "upload":
        print(upload(args.staging, args.repo))
    else:
        manifest = read_manifest(args.folder)
        pins = remote_pins(args.repo, args.revision, [MANIFEST, *manifest["files"]])
        new = entry(manifest, args.repo, args.revision, pins, args.notice)
        if args.write:
            write_entry(new)
        print(json.dumps(new, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
