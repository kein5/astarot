#!/usr/bin/env python3
"""Generate the reference catalogs of the functional specification from source.

The tables under docs/spec/reference/ list every IPC endpoint, error code and
config key:

    python tools/spec_catalog.py --write   # regenerate the tables
    python tools/spec_catalog.py --check   # exit 1 when they are out of date

The rows of the Python backend are in tools/spec_python_baseline.json, read from
src-python (mainloop.py, utils.py, errors.py, config.py) before it was removed
in 0.6.0 (#285). What only the Rust core has (native/core) is in
tools/spec_core_additions.json and comes after them. The UI's side (its routes
and the error codes it handles) is read from src-ui with regular expressions;
nothing is imported or run.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "spec" / "reference"
UI = ROOT / "src-ui" / "logics"
PYTHON_BASELINE = ROOT / "tools" / "spec_python_baseline.json"
CORE_ADDITIONS = ROOT / "tools" / "spec_core_additions.json"

HEADER = (
    "<!-- 自動生成。手で編集しない。`python tools/spec_catalog.py --write`で更新する。 -->\n"
)


def cell(value: object) -> str:
    text = "" if value is None else str(value)
    return re.sub(r"\s+", " ", text).replace("|", "\\|").strip()


def code(value: object) -> str:
    text = cell(value)
    return f"`{text}`" if text else ""


def table(head: list[str], rows: list[list[str]]) -> str:
    lines = ["| " + " | ".join(head) + " |", "|" + "|".join("---" for _ in head) + "|"]
    lines += ["| " + " | ".join(row) + " |" for row in rows]
    return "\n".join(lines) + "\n"


def core_additions() -> dict:
    """Endpoints, error codes and config keys only the Rust core has."""
    return json.loads(CORE_ADDITIONS.read_text(encoding="utf-8"))


def python_baseline() -> dict:
    """The Python backend's endpoints, notifications, error codes and config keys."""
    return json.loads(PYTHON_BASELINE.read_text(encoding="utf-8"))


# --- IPC endpoints -------------------------------------------------------------

def ui_routes() -> dict[str, str]:
    """Endpoint -> UI handler, mirroring buildRouteMetaList() in useReceiveRoutes.ts."""
    routes_js = (UI / "useReceiveRoutes.ts").read_text(encoding="utf-8")
    setter_js = (UI / "configs" / "config_page_setter" / "ui_config_setter.ts").read_text(encoding="utf-8")
    routes: dict[str, str] = {}
    static = re.findall(r'\{\s*endpoint:\s*"([^"]+)",\s*ns:\s*\w+,\s*hook_name:\s*(?:"(\w+)"|null),\s*method_name:\s*(?:"(\w+)"|null)', routes_js)
    for endpoint, hook, method in static:
        routes[endpoint] = f"{hook}.{method}" if hook else "（受け取るだけ）"

    def add(endpoint: str, hook: str, method: str) -> None:
        routes.setdefault(endpoint, f"{hook}.{method}")

    # One entry per `Category:`; default values may hold nested braces.
    starts = [m.start() for m in re.finditer(r"\bCategory:", setter_js)]
    for start, end in zip(starts, starts[1:] + [len(setter_js)]):
        block = setter_js[start:end]
        field = lambda key: (re.search(rf'{key}:\s*"([^"]+)"', block) or [None, None])[1]
        base, ep, logics, ui_template = field("Base_Name"), field("base_endpoint_name"), field("logics_template_id"), field("ui_template_id")
        category = field("Category")
        if not (base and ep and category):
            continue
        hook = f"use{category}"
        if '"from_backend"' in block:
            add(f"/run/{ep}", hook, f"updateFromBackend{base}")
        add(f"/get/data/{ep}", hook, f"updateFromBackend{base}")
        if logics == "get_set_delete":
            add(f"/delete/data/{ep}", hook, f"deleteSuccess{base}")
        if logics not in ("get_list", "get_only"):
            add(f"/set/data/{ep}", hook, f"setSuccess{base}")
        if logics == "toggle_enable_disable" or ui_template == "toggle":
            add(f"/set/enable/{ep}", hook, f"setSuccess{base}")
            add(f"/set/disable/{ep}", hook, f"setSuccess{base}")
        if logics == "weight_download_status":
            add(f"/get/data/selectable_{ep}_type_dict", hook, f"updateDownloaded{base}")
            add(f"/run/download_progress_{ep}", hook, f"updateDownloadProgress{base}")
            add(f"/run/downloaded_{ep}", hook, f"downloaded{base}")
            add(f"/run/pending_{ep}", hook, f"pending{base}")
            add(f"/run/download_{ep}", hook, f"downloaded{base}")
    return routes


def kind_of(endpoint: str) -> str:
    for prefix, label in (("/get/data/", "取得"), ("/set/data/", "設定"), ("/delete/data/", "削除"),
                          ("/set/enable/", "有効化"), ("/set/disable/", "無効化"), ("/run/", "実行")):
        if endpoint.startswith(prefix):
            return label
    return "その他"


def sensitive_markers() -> tuple[str, ...]:
    """`SENSITIVE_ENDPOINT_MARKERS`: Python's, then the core's."""
    return tuple(python_baseline()["sensitive_markers"]) + tuple(core_additions().get("sensitive_markers", []))


def render_endpoints() -> str:
    baseline = python_baseline()
    routes = ui_routes()
    markers = sensitive_markers()
    # Requests the receiver answers at once instead of queueing (Main.receiver).
    immediate = set(baseline["immediate"])

    requests = []
    for entry in baseline["endpoints"]:
        endpoint, handler_name = entry["endpoint"], entry["handler"]
        before_init = "可" if entry["before_init"] else "待つ"
        notes = []
        if endpoint in immediate:
            notes.append("即時（キューを通らない）")
        if any(m in endpoint.lower() for m in markers):
            notes.append("ログで伏せる")
        requests.append([code(endpoint), kind_of(endpoint), code(handler_name), before_init,
                         cell(routes.get(endpoint, "—")), cell("、".join(notes))])

    core = core_additions()["endpoints"]
    for entry in core:
        endpoint = entry["endpoint"]
        notes = ["中核のみ"]
        if entry.get("immediate"):
            notes.append("即時（キューを通らない）")
        if any(m in endpoint.lower() for m in markers):
            notes.append("ログで伏せる")
        requests.append([code(endpoint), kind_of(endpoint), code(entry["handler"]), "可" if entry["before_init"] else "待つ",
                         cell(routes.get(endpoint, "—")), cell("、".join(notes))])

    pushes = [[code(entry["name"]), code(entry["endpoint"]), cell(routes.get(entry["endpoint"], "—"))] for entry in baseline["notifications"]]

    request_set = {entry["endpoint"] for entry in baseline["endpoints"]} | {entry["endpoint"] for entry in core}
    push_set = {entry["endpoint"] for entry in baseline["notifications"]}
    unrouted = sorted((request_set | push_set) - set(routes))
    ui_only = sorted(e for e in routes if e not in request_set | push_set)

    kinds = {}
    for row in requests:
        kinds[row[1]] = kinds.get(row[1], 0) + 1
    summary = "、".join(f"{k} {n}" for k, n in sorted(kinds.items()))

    out = [HEADER, "# IPCエンドポイント一覧\n",
           "UIからサイドカーへの要求（`mapping`）と、サイドカーからUIへの通知（`run_mapping`）の一覧。"
           "メッセージの形、状態コード、ロックと再試行の規則は[IPCプロトコル](../ipc-protocol.md)にある。\n",
           "列の意味:\n",
           "- 初期化前: 「待つ」は初期化が終わるまでロックされる要求（サイドカーが約30秒まで入れ直し、解けなければ423を返す）。「可」は起動直後から受け付ける。",
           "- UIの受信先: 200の応答を処理するUIのフック（`useReceiveRoutes.ts`の静的ルートと`ui_config_setter.ts`の定義から生成）。「—」は受信先がない。",
           "- ログで伏せる: `process.log`で値を`***MASKED***`に置き換える（`SENSITIVE_ENDPOINT_MARKERS`）。stdoutのIPCそのものは伏せない。",
           "- 中核のみ: Pythonになく、中核（`native/core`）で足したもの。`tools/spec_core_additions.json`から表の末尾に足した。\n",
           f"## 要求（{len(requests)}件: {summary}）\n",
           table(["エンドポイント", "種別", "処理（controller）", "初期化前", "UIの受信先", "備考"], requests),
           f"\n## 通知（サイドカーからUIへ、{len(pushes)}件）\n",
           "要求への応答とは別に、サイドカーが自分から送るメッセージ。`controller.run(status, run_mapping[名前], result)`で送る。\n",
           table(["名前", "エンドポイント", "UIの受信先"], pushes),
           f"\n## UIに受信先がないエンドポイント（{len(unrouted)}件）\n",
           "200で届いた場合にUIが`Invalid endpoint`としてコンソールに出すもの。ただし、400で届くエラーの通知（`/run/error_…`など）は`errorHandling_Backend`が処理し、"
           "`/run/initialization_complete`は`receiveRoutes`が個別に処理するので、このどちらかに当たるものは実害がない。\n",
           "".join(f"- {code(e)}\n" for e in unrouted) or "なし\n",
           f"\n## UIだけにあるルート（{len(ui_only)}件）\n",
           "UIに受信先が定義されているが、サイドカーの`mapping`と`run_mapping`にはないもの。多くは`ui_config_setter.ts`の定義が機械的に作るルートで、使われない。\n",
           "".join(f"- {code(e)}\n" for e in ui_only) or "なし\n"]
    return "\n".join(out)


# --- error codes ----------------------------------------------------------------

def render_errors() -> str:
    baseline = python_baseline()
    handler_js = (UI / "_useBackendErrorHandling.ts").read_text(encoding="utf-8")
    handled = set(re.findall(r'case "([A-Z0-9_]+)"', handler_js)) | set(re.findall(r"^\s+([A-Z0-9_]+):\s*\"common_error", handler_js, re.M))

    rows = []
    for entry in baseline["errors"] + core_additions()["errors"]:
        rows.append([code(entry["code"]), cell(entry["category"]), cell(entry["message"]), cell(entry["severity"]),
                     "要" if entry["user_action_required"] else "", "あり" if entry["code"] in handled else ""])
    missing = baseline["errors_without_metadata"]

    out = [HEADER, "# エラーコード一覧\n",
           "Pythonのバックエンドのコード（0.6.0で消した`src-python/errors.py`の`ErrorCode`と`ERROR_METADATA`を写した`tools/spec_python_baseline.json`）から生成した。"
           "中核（`native/core`）だけにあるコードは`tools/spec_core_additions.json`から表の末尾に足した。"
           "応答の形とUIでの見せ方は[横断的な振る舞い](../cross-cutting.md#エラーの扱い)にある。\n",
           "- 既定メッセージ: サイドカーが返す英語の`message`。UIは多くの場合`locales/`の文言に置き換えて表示する。",
           "- UIの個別処理: `_useBackendErrorHandling.ts`に専用の分岐（値の巻き戻しや翻訳した文言の表示）がある。"
           "空欄のコードは、音声やモデル取得など別の経路で処理されるか、汎用の通知になる。\n",
           f"## コード（{len(rows)}件）\n",
           table(["コード", "分類", "既定メッセージ", "重大度", "利用者の対処", "UIの個別処理"], rows)]
    if missing:
        out += [f"\n## メタデータのないコード（{len(missing)}件）\n", "既定メッセージは`GENERAL_UNKNOWN`のものになる。\n",
                "".join(f"- {code(m)}\n" for m in missing)]
    return "\n".join(out)


# --- config keys -----------------------------------------------------------------

def app_version() -> str:
    return json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]


def render_config() -> str:
    persisted, runtime = [], []
    for entry in python_baseline()["config"]:
        # The version the app reports, as Python's `self._VERSION` held it.
        default = f"'{app_version()}'" if entry["key"] == "VERSION" else entry["default"]
        row = [code(entry["key"]), cell(entry["check"]), code(default), entry["save"]]
        (persisted if entry["persisted"] else runtime).append(row)

    for entry in core_additions()["config"]:
        persisted.append([code(entry["key"]), cell(entry["check"] + "（中核のみ）"), code(entry["default"]), cell(entry["save"])])

    out = [HEADER, "# 設定キー一覧\n",
           "Pythonのバックエンドのキー（0.6.0で消した`src-python/config.py`の`Config`クラスと`init_config()`の既定値を写した`tools/spec_python_baseline.json`）から生成した。"
           "中核（`native/core`）だけにあるキーは`tools/spec_core_additions.json`から表の末尾に足した。"
           "保存の仕組み（2秒の遅延、置き換えによる書き込み、読み込み時の検証）は[データ形式と保存](../data-and-persistence.md)にある。\n",
           "チャット読み取りの`OCR_CAPTURE_REGION`はデスクトップウィンドウ用、`OCR_VR_CAPTURE_REGION`はSteamVRの左目側の映像用。"
           "旧版の単一範囲はウィンドウ用に保持し、未保存のVR側には全体を補う。"
           "[範囲の形と移行](../data-and-persistence.md#チャット読み取りの範囲)を参照。\n",
           f"## config.jsonに保存するキー（{len(persisted)}件）\n",
           table(["キー", "型・検証", "既定値", "保存"], persisted),
           f"\n## 保存しないキー（{len(runtime)}件）\n",
           "実行中だけの状態、選択肢の一覧、読み取り専用の値。起動のたびに既定値や検出結果から作り直す。\n",
           table(["キー", "型・検証", "既定値", "扱い"], runtime)]
    return "\n".join(out)


CATALOGS = {
    "ipc-endpoints.md": render_endpoints,
    "error-codes.md": render_errors,
    "config-keys.md": render_config,
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--write", action="store_true", help="regenerate docs/spec/reference/")
    mode.add_argument("--check", action="store_true", help="exit 1 when docs/spec/reference/ is out of date")
    args = parser.parse_args()

    stale = []
    for name, render in CATALOGS.items():
        path = OUT / name
        text = render()
        if args.write:
            if path.exists() and path.read_text(encoding="utf-8") == text:
                continue
            path.parent.mkdir(parents=True, exist_ok=True)
            # LF on every OS, as the repository stores it; Windows would otherwise write CRLF.
            with open(path, "w", encoding="utf-8", newline="\n") as handle:
                handle.write(text)
            print(f"wrote {path.relative_to(ROOT) if ROOT in path.parents else path}")
        elif not path.exists() or path.read_text(encoding="utf-8") != text:
            stale.append(str(path.relative_to(ROOT)))
    if stale:
        print("Out of date (run `python tools/spec_catalog.py --write`): " + ", ".join(stale), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
