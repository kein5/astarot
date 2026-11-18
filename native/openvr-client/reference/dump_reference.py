"""Write pyopenvr's OpenVR function tables, for the Rust crates that call them by position.

    python native/openvr-client/reference/dump_reference.py            # rewrite tests/data/pyopenvr_fn_tables.json
    python native/openvr-client/reference/dump_reference.py --check    # fail if the file is out of date

The VR overlay (native/vr-overlay/src/openvr.rs) and the OCR's VR capture
(native/ocr-runtime/src/capture/openvr.rs) call the OpenVR client library's function tables by
position. A wrong position calls another function without any error (#610). The file holds, for
each interface version they call, the names of its functions in table order, as pyopenvr has
them (its IVR*_FnTable structures, the order of openvr_capi.h). pyopenvr is pinned in uv.lock,
and the app ships the client library from the same wheel. Each crate's tests check every
position it declares against this file (vrct_openvr_client::fn_table!).

Run with the app's Python (pyopenvr installed). src-python/test/test_openvr_fn_tables.py runs
the same comparison as --check.
"""
from importlib.metadata import version
import json
from pathlib import Path
import sys

OUTPUT = Path(__file__).resolve().parents[1] / "tests" / "data" / "pyopenvr_fn_tables.json"
# The interfaces the crates call. A crate that calls another one adds it here.
INTERFACES = ("IVRSystem", "IVROverlay", "IVRApplications", "IVRRenderModels", "IVRCompositor")


def reference():
    import openvr

    tables = {}
    for name in INTERFACES:
        table = getattr(openvr, f"{name}_FnTable")
        tables[getattr(openvr, f"{name}_Version")] = [field for field, _ in table._fields_]
    return {"generator": "native/openvr-client/reference/dump_reference.py", "pyopenvr": version("openvr"),
            "tables": tables}


def render():
    return json.dumps(reference(), ensure_ascii=False, indent=1) + "\n"


def main(argv):
    text = render()
    if argv[1:] == ["--check"]:
        current = OUTPUT.read_text(encoding="utf-8") if OUTPUT.exists() else ""
        if current != text:
            print(f"{OUTPUT} is out of date: run python native/openvr-client/reference/dump_reference.py", file=sys.stderr)
            return 1
        return 0
    if argv[1:]:
        print(__doc__, file=sys.stderr)
        return 2
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(text, encoding="utf-8", newline="\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
