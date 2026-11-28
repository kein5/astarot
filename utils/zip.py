import zipfile
import argparse
from pathlib import Path
import time
import os
import tempfile
import sys
from tqdm import tqdm # tqdmをインポート

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from check_voice_distribution import check

# ONNX Runtime and DirectML, when a crate in astarot.exe links them dynamically: ort's
# copy-dylibs puts them beside the binary in target/release, and Windows loads them from there
# (decision 2 in docs/voice-stack/core-integration.md).
ONNX_RUNTIME_LIBRARIES = ("onnxruntime.dll", "onnxruntime_providers_shared.dll", "DirectML.dll")

# The files at the top of the package, beside each other once installed: the app, and the
# SteamVR application manifest that names it (#1384). SteamVR starts the binary the manifest
# names relative to the manifest's own folder, so the two must sit together.
PACKAGE_FILES = ("src-tauri/target/release/astarot.exe", "src-tauri/steamvr/astarot.vrmanifest")

def zip_files_and_directory(zip_name, file_paths, dir_paths, verbose=False):
    # Reject missing inputs and stale forbidden resources before touching a
    # previous candidate. A partial ZIP must never masquerade as a release.
    check([*file_paths, *dir_paths])
    output = Path(zip_name)
    entries = []
    for value in file_paths:
        path = Path(value)
        if not path.is_file():
            raise ValueError(f"Not an input file: {path}")
        entries.append((path, path.name))
    for value in dir_paths:
        path = Path(value)
        if not path.is_dir():
            raise ValueError(f"Not an input directory: {path}")
        entries.extend((item, Path(path.name) / item.relative_to(path))
                       for item in path.rglob("*") if item.is_file())
    if not entries:
        raise ValueError("No package inputs")
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=output.parent, suffix=".zip", delete=False) as stream:
            temporary = Path(stream.name)
        with zipfile.ZipFile(temporary, "w", zipfile.ZIP_DEFLATED) as archive:
            for path, name in tqdm(entries, desc="Packaging", unit="file"):
                archive.write(path, name)
                if verbose:
                    print(f"Add: {name}")
        check([temporary])
        os.replace(temporary, output)
        print(f"Created and inspected: {output}")
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    start_time = time.time()
    parser = argparse.ArgumentParser(description="Create a zip file from specified files and directories.")
    parser.add_argument("--zip_name", type=str, default="ASTAROT.zip", help="Name of the output zip file.")
    parser.add_argument(
        "--file_paths",
        type=str,
        nargs="*",
        default=list(PACKAGE_FILES),
        help="List of file paths to include in the zip."
    )
    parser.add_argument(
        "--beside_exe",
        type=str,
        nargs="*",
        default=[f"src-tauri/target/release/{name}" for name in ONNX_RUNTIME_LIBRARIES],
        help="Libraries that sit beside astarot.exe when the build put them there."
    )
    parser.add_argument(
        "--dir_paths",
        type=str,
        nargs="*",
        default=["src-tauri/target/release/_internal"],
        help="List of directory paths to include in the zip."
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Increase output verbosity."
    )
    args = parser.parse_args()

    beside = [path for path in args.beside_exe if Path(path).is_file()]
    zip_files_and_directory(args.zip_name, [*args.file_paths, *beside], args.dir_paths, args.verbose)
    end_time = time.time()
    processing_time = end_time - start_time
    print(f"Complete! Processing time: {processing_time:.2f} seconds")
