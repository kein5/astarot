"""Notice selection without building packages."""
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
NSCURL_NOTICES = {
    "LICENSE.md", "LICENSE.brotli.md", "LICENSE.curl.md", "LICENSE.nghttp2.md",
    "LICENSE.openssl.md", "LICENSE.zlib.md", "LICENSE.zstd.md",
}


def test_windows_payload_collects_retained_nscurl_notices(tmp_path):
    from tools import app_resources
    staged = {name: source for source, name in app_resources.pairs("windows", tmp_path / "build", ROOT)}
    notices = {name.rsplit("/", 1)[1]: source for name, source in staged.items() if name.startswith("licenses/nscurl/")}
    assert set(notices) == NSCURL_NOTICES
    assert all(Path(source).parent == ROOT / "src-tauri/nsis/licenses/nscurl" for source in notices.values())
    assert all(Path(source).stat().st_size for source in notices.values())
    assert "licenses/nscurl/LICENSE.md" in app_resources.required("windows")


def test_bootstrapper_embeds_nscurl_notices_before_any_download():
    source = (ROOT / "src-tauri/nsis/template.nsi").read_text(encoding="utf-8")
    init = source.split("Function .onInit\n", 1)[1].split("FunctionEnd", 1)[0]
    assert 'SetOutPath "$PLUGINSDIR\\licenses\\nscurl"' in init
    assert 'File "..\\..\\..\\..\\nsis\\licenses\\nscurl\\LICENSE*.md"' in init
    assert "InitPluginsDir" in init
    assert "NScurl::" not in init
