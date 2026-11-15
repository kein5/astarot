"""Turn the findings-<lang>.json files of layout_audit.py into the Markdown tables of findings.md.

    python docs/design/main-layout-audit/audit/summarize.py build/layout-audit > docs/design/main-layout-audit/findings.md
"""
import collections
import json
import re
import sys
from pathlib import Path

# Kinds that point at a defect on their own. "partly-outside-scroll-area" (an element reached only by
# scrolling) is summarised through the sidebar's numbers instead, and "scroll" through its own table.
DEFECTS = ("content-spills", "overlap", "clipped", "outside-viewport", "text-cut", "hidden-overflow")


def main(out):
    out = Path(out)
    runs = {lang: json.loads((out / f"findings-{lang}.json").read_text(encoding="utf-8")) for lang in ("ja", "en")}
    print("# メイン画面レイアウト監査：機械検出の集計\n")
    print("`audit/summarize.py` が `audit/layout_audit.py` の出力から生成した表です。手で編集しません。")
    print("サイズは CSS px（`@150` は UI サイズ 150%）。メッセージ本文は記録していません。\n")

    print("## サイズごとの寸法（日本語、会話あり、相手の言語 3 つ）\n")
    print("| サイズ | ログ欄 幅×高さ | 入力欄 幅×高さ | サイドバー 表示高さ / 中身の高さ |")
    print("|---|---|---|---|")
    for r in runs["ja"]["results"]:
        if r["state"] != "in-use":
            continue
        m = r["metrics"]
        side = m["sidebar"]
        print(f"| {r['size']} | {'×'.join(map(str, m['log']))} | {'×'.join(map(str, m['input']))} | "
              f"{side['visible']} / {side['content']}{'（スクロールが必要）' if side['content'] > side['visible'] + 1 else ''} |")

    for lang, data in runs.items():
        groups = collections.defaultdict(lambda: collections.defaultdict(set))
        scrolls = collections.defaultdict(lambda: collections.defaultdict(set))
        for r in data["results"]:
            for f in r["findings"]:
                component = f["component"].split(" < ")[0]
                if f["kind"] in DEFECTS:
                    groups[(f["kind"], component, f.get("label", f.get("overflow", "")))][r["state"]].add(r["size"])
                elif f["kind"] == "scroll" and not component.startswith("SidebarSection"):
                    css_class = f["el"].split(".")[1] if "." in f["el"] else f["el"]
                    scrolls[(component, re.sub(r"^_?(.*?)_[a-z0-9]{5}_\d+$", r"\1", css_class))][r["state"]].add(r["size"])
        print(f"\n## 検出（{lang}）\n")
        print("| 種類 | コンポーネント | 要素 | 状態: サイズ |")
        print("|---|---|---|---|")
        for (kind, component, label), states in sorted(groups.items()):
            where = "<br>".join(f"{state}: {', '.join(sorted(sizes))}" for state, sizes in sorted(states.items()))
            print(f"| {kind} | {component} | {label.replace('|', '/')} | {where} |")
        print(f"\n### サイドバー以外でスクロールが出た領域（{lang}）\n")
        print("| コンポーネント | 要素 | 状態: サイズ |")
        print("|---|---|---|")
        for (component, el), states in sorted(scrolls.items()):
            where = "<br>".join(f"{state}: {', '.join(sorted(sizes))}" for state, sizes in sorted(states.items()))
            print(f"| {component} | {el} | {where} |")
        if data["errors"]:
            print(f"\n### 操作できなかった状態（{lang}）\n")
            print("幅 800 px 以下ではサイドバーがアイコンの列になり、言語設定と翻訳エンジンのボタンを表示しないため、開けません（仕様どおり）。\n")
            for e in data["errors"]:
                print(f"- {e['state']} @ {e['size']}: {e['error']}")

    print("\n## 種類の意味\n")
    print("- content-spills: ボタンなどの中身が自分の枠からはみ出している（overflow: visible のため、隣と重なって見える）")
    print("- overlap: 操作できる要素どうしが重なり、どちらもクリックできる位置に見えている（オーバーレイで完全に覆われたものは除外）")
    print("- clipped / outside-viewport: 祖先の overflow: hidden またはビューポートで切れ、スクロールでも届かない")
    print("- text-cut: テキストが自分の枠に収まらず省略・切り捨てされている")
    print("- hidden-overflow: overflow: hidden の領域で、中身が枠より大きい")


if __name__ == "__main__":
    main(sys.argv[1])
