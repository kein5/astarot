#!/usr/bin/env python3
"""Generate the reference catalogs of the functional specification from source.

The tables under docs/spec/reference/ list every IPC endpoint, error code and
config key:

    python tools/spec_catalog.py --write   # regenerate the tables
    python tools/spec_catalog.py --check   # exit 1 when they are out of date

What the Rust core answers, pushes and keeps is in tools/spec_core_catalog.json,
which native/core/tests/spec_catalog.rs writes from the core and keeps current
(VRCT_SPEC_CATALOG_WRITE=1 cargo test --test spec_catalog in native/core). The
checks of the config keys are read from native/core/src/config/schema.rs, and the
UI's side (its routes and the error codes it handles) from src-ui; both with
regular expressions. Nothing is built, imported or run.
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
CORE_CATALOG = ROOT / "tools" / "spec_core_catalog.json"
SCHEMA = ROOT / "native" / "core" / "src" / "config" / "schema.rs"

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


def core_catalog() -> dict:
    """The core's endpoints, notifications, error codes and config keys."""
    return json.loads(CORE_CATALOG.read_text(encoding="utf-8"))


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


def render_endpoints() -> str:
    catalog = core_catalog()
    routes = ui_routes()
    markers = tuple(catalog["sensitive_markers"])

    requests = []
    for entry in catalog["endpoints"]:
        endpoint = entry["endpoint"]
        notes = []
        if entry["immediate"]:
            notes.append("即時（キューを通らない）")
        if any(m in endpoint.lower() for m in markers):
            notes.append("ログで伏せる")
        requests.append([code(endpoint), kind_of(endpoint), "待つ" if entry["wait_for_init"] else "可",
                         cell(routes.get(endpoint, "—")), cell("、".join(notes))])

    pushes = [[code(entry["name"]), code(entry["endpoint"]), cell(routes.get(entry["endpoint"], "—"))]
              for entry in catalog["notifications"]]

    request_set = {entry["endpoint"] for entry in catalog["endpoints"]}
    push_set = {entry["endpoint"] for entry in catalog["notifications"]}
    unrouted = sorted((request_set | push_set) - set(routes))
    ui_only = sorted(e for e in routes if e not in request_set | push_set)

    kinds = {}
    for row in requests:
        kinds[row[1]] = kinds.get(row[1], 0) + 1
    summary = "、".join(f"{k} {n}" for k, n in sorted(kinds.items()))

    out = [HEADER, "# IPCエンドポイント一覧\n",
           "UIから中核への要求と、中核からUIへの通知（`RUN_MAPPING`）の一覧。"
           "中核（`native/core`）が`tests/spec_catalog.rs`で書き出した`tools/spec_core_catalog.json`から生成した。"
           "メッセージの形、状態コード、ロックと再試行の規則は[IPCプロトコル](../ipc-protocol.md)にある。\n",
           "列の意味:\n",
           "- 初期化前: 「待つ」は初期化が終わるまでロックされる要求（中核が約30秒まで入れ直し、解けなければ423を返す）。「可」は起動直後から受け付ける。",
           "- UIの受信先: 200の応答を処理するUIのフック（`useReceiveRoutes.ts`の静的ルートと`ui_config_setter.ts`の定義から生成）。「—」は受信先がない。",
           "- ログで伏せる: `process.log`で値を`***MASKED***`に置き換える（`log::SENSITIVE_ENDPOINT_MARKERS`）。stdoutのIPCそのものは伏せない。\n",
           f"## 要求（{len(requests)}件: {summary}）\n",
           "並びは中核が経路を足した順（`controller/routes.rs`）。\n",
           table(["エンドポイント", "種別", "初期化前", "UIの受信先", "備考"], requests),
           f"\n## 通知（中核からUIへ、{len(pushes)}件）\n",
           "要求への応答とは別に、中核が自分から送るメッセージ。`Core::notify(名前, 結果)`で送り、名前は`controller/mod.rs`の`RUN_MAPPING`で終点に変わる。"
           "表にない名前は送る時点で止まる（契約のCT-02、`tests/run_mapping.rs`）。\n",
           table(["名前", "エンドポイント", "UIの受信先"], pushes),
           f"\n## UIに受信先がないエンドポイント（{len(unrouted)}件）\n",
           "200で届いた場合にUIが`Invalid endpoint`としてコンソールに出すもの。ただし、400で届くエラーの通知（`/run/error_…`など）は`errorHandling_Backend`が処理し、"
           "`/run/initialization_complete`は`receiveRoutes`が個別に処理するので、このどちらかに当たるものは実害がない。\n",
           "".join(f"- {code(e)}\n" for e in unrouted) or "なし\n",
           f"\n## UIだけにあるルート（{len(ui_only)}件）\n",
           "UIに受信先が定義されているが、中核の要求と通知にはないもの。多くは`ui_config_setter.ts`の定義が機械的に作るルートで、使われない。\n",
           "".join(f"- {code(e)}\n" for e in ui_only) or "なし\n"]
    return "\n".join(out)


# --- error codes ----------------------------------------------------------------

def render_errors() -> str:
    handler_js = (UI / "_useBackendErrorHandling.ts").read_text(encoding="utf-8")
    handled = set(re.findall(r'case "([A-Z0-9_]+)"', handler_js)) | set(re.findall(r"^\s+([A-Z0-9_]+):\s*\"common_error", handler_js, re.M))

    rows = []
    for entry in core_catalog()["errors"]:
        rows.append([code(entry["code"]), cell(entry["category"]), cell(entry["message"]), cell(entry["severity"]),
                     "要" if entry["user_action_required"] else "", "あり" if entry["code"] in handled else ""])

    out = [HEADER, "# エラーコード一覧\n",
           "中核のコードの表（`native/core/src/errors/table.rs`）から、`tools/spec_core_catalog.json`を通して生成した。"
           "応答の形とUIでの見せ方は[横断的な振る舞い](../cross-cutting.md#エラーの扱い)にある。\n",
           "- 既定メッセージ: 中核が返す英語の`message`。UIは多くの場合`locales/`の文言に置き換えて表示する。",
           "- UIの個別処理: `_useBackendErrorHandling.ts`に専用の分岐（値の巻き戻しや翻訳した文言の表示）がある。"
           "空欄のコードは、音声やモデル取得など別の経路で処理されるか、汎用の通知になる。\n",
           f"## コード（{len(rows)}件）\n",
           table(["コード", "分類", "既定メッセージ", "重大度", "利用者の対処", "UIの個別処理"], rows)]
    return "\n".join(out)


# --- config keys -----------------------------------------------------------------

def app_version() -> str:
    return json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]


def schema_checks() -> dict[str, str]:
    """Key -> the check expression of its entry in `keys()` of config/schema.rs."""
    text = SCHEMA.read_text(encoding="utf-8")
    body = text[text.index("pub fn keys() -> Vec<Key>"):]
    body = body[body.index("vec![") + len("vec!["):]
    entries, depth, current, quote, comment = [], 0, [], False, False
    for index, char in enumerate(body):
        if comment:
            comment = char != "\n"
            continue
        if quote:
            current.append(char)
            if char == '"' and current[-2:-1] != ["\\"]:
                quote = False
            continue
        if body.startswith("//", index):
            comment = True
            continue
        if char == '"':
            quote = True
        elif char in "([{":
            depth += 1
        elif char in ")]}":
            if depth == 0:
                break
            depth -= 1
        elif char == "," and depth == 0:
            entries.append("".join(current))
            current = []
            continue
        current.append(char)
    checks = {}
    for entry in entries:
        entry = re.sub(r"\s+", " ", entry).strip()
        match = re.fullmatch(r'(?:key|runtime|immediate|readonly)\("([A-Z0-9_]+)"(?:, (.*))?\)', entry)
        if match:
            checks[match.group(1)] = match.group(2) or ""
    return checks


TYPES = {"Bool": "bool", "Int": "int", "Num": "number", "Str": "str", "Dict": "dict", "List": "list"}


def describe_check(expression: str) -> str:
    """The check of a key in words where its form is a common one, else the function it calls."""
    if not expression:
        return ""
    if expression == "b()":
        return "bool"
    if match := re.fullmatch(r"plain\(Ty::(\w+)\)", expression):
        return TYPES[match.group(1)]
    if match := re.fullmatch(r"(int|num)_in\((.+), (.+)\)", expression):
        return f"{'int' if match.group(1) == 'int' else 'number'}（{match.group(2)}〜{match.group(3)}）"
    if match := re.fullmatch(r'one_of\("(\w+)"\)', expression):
        return f"str（`{match.group(1)}`のどれか）"
    if match := re.fullmatch(r'in_populated\("(\w+)"\)', expression):
        return f"str か null（`{match.group(1)}`のどれか。一覧が空なら問わない）"
    called = re.search(r"(?<![.\w])([A-Za-z_][\w:]*)\(v[,)]", expression)
    own = f"検証 `{called.group(1)}`" if called else "独自の検証"
    if match := re.fullmatch(r"managed\(Ty::(\w+), (true|false), (.*)\)", expression):
        kind = TYPES[match.group(1)] + (" か null" if match.group(2) == "true" else "")
        rest = match.group(3)
        if re.fullmatch(r"[a-z_][\w:]*", rest):
            return f"{kind}、検証 `{rest}`"
        return f"{kind}、{own}"
    if match := re.fullmatch(r"validated\(([a-z_][\w:]*)\)", expression):
        return f"検証 `{match.group(1)}`"
    if expression.startswith("validated("):
        return own
    if match := re.fullmatch(r"([a-z_]\w*)\(.*\)", expression):
        return f"検証 `{match.group(1)}`"
    return own


def default_text(key: str, value: object) -> str:
    if key == "VERSION":
        value = app_version()
    return code(json.dumps(value, ensure_ascii=False, separators=(", ", ": ")))


SAVE = {"saved": "2秒後にまとめて", "immediate": "即時", "runtime": "保存しない", "readonly": "読み取り専用"}


def render_config() -> str:
    checks = schema_checks()
    persisted, runtime = [], []
    for entry in core_catalog()["config"]:
        key = entry["key"]
        if key not in checks:
            raise ValueError(f"{key} is not in keys() of {SCHEMA.relative_to(ROOT)}")
        row = [code(key), cell(describe_check(checks[key])), default_text(key, entry["default"]), SAVE[entry["kind"]]]
        (persisted if entry["kind"] in ("saved", "immediate") else runtime).append(row)

    out = [HEADER, "# 設定キー一覧\n",
           "中核のキーの表（`native/core/src/config/schema.rs`の`keys()`）と既定値（`defaults()`）から生成した。"
           "既定値は`tools/spec_core_catalog.json`を通し、型・検証は`keys()`の式から読む。"
           "保存の仕組み（2秒の遅延、置き換えによる書き込み、読み込み時の検証）は[データ形式と保存](../data-and-persistence.md)にある。\n",
           "- 型・検証: よく使う形（`int_in`、`one_of`など）は言葉にした。それ以外は、検証に使う関数の名前か「独自の検証」で、中身は`schema.rs`にある。",
           "- 既定値: 中核が`config.json`に書くJSON。Windowsのもの。PCで決まるものは仮の値で示す"
           "（`<app>`はアプリのフォルダー、`<data>`はモデルなどのデータのフォルダー、`<state>`は設定とログのフォルダー、`<token>`は最初の起動で作る値）。"
           "翻訳の計算機器はCPUだけの場合。\n",
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
