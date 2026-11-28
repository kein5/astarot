import assert from "node:assert/strict";
import { test } from "vitest";
import { localeAt, readLocale } from "../../logics/test/locales.ts";
import type { LocaleTree } from "../../logics/test/locales.ts";

// The VR tooltip is drawn at a fixed size and shown only when its body is at most 104 px high
// (VrTooltip.tsx): the title line (22 px), the padding and margin (25 px) and two help lines of 20 px
// make 87 px, and a third line makes 107 px, so the overlay is never asked to show it. A hint the
// panel shows with the tooltips turned off (a missing setup, a microphone that waits to open) must
// fit two lines, or VR shows only the mark on the button (#1314, V-1).
//
// The body's text column is 332 px wide (360 px less 14 px of padding each side) at 16 px. Japanese
// characters, full-width marks and arrows take 16 px. Latin characters take their width in Noto
// Sans at 16 px (the Linux font of the app's stack), rounded up to whole pixels; Yu Gothic UI on
// Windows is no wider. The line breaks follow the body's rules: Japanese breaks between any two
// characters, a Latin word does not break, and a space at the end of a line takes no room.
const WIDTH = 332;
const LATIN: Readonly<Record<number, string>> = {
    4: "'", 5: "!(),.:;J`ijl", 6: "-/I[\\]ft", 7: '"?r{}', 8: "_csz", 9: "*EFLSTaekvxy|",
    10: "$+0123456789<=>KPRVXYZ^bdghnopqu~", 11: "#ABC", 12: "&DGHU", 13: "NOQw", 14: "%", 15: "@MWm",
};
const LATIN_WIDTH = new Map(Object.entries(LATIN).flatMap(([w, chars]) => [...chars].map(ch => [ch, Number(w)] as const)));
const SPACE = 4.5;
const charWidth = (ch: string): number => ch === " " ? SPACE : LATIN_WIDTH.get(ch) ?? 16;
const width = (text: string): number => [...text].reduce((sum, ch) => sum + charWidth(ch), 0);

function estimatedLines(text: string, columns = WIDTH): number {
    // Units that cannot break: a run of Latin letters and digits with what sticks to it; each
    // Japanese character stands alone.
    const units = text.match(/[\u3000-\u30ff\u3400-\u9fff\uff00-\uffef\u2190-\u21ff]|[^\s\u3000-\u30ff\u3400-\u9fff\uff00-\uffef\u2190-\u21ff]+|\s+/g) ?? [];
    let lines = 1, line = 0;
    for (const unit of units) {
        const w = width(unit);
        if (/^\s+$/.test(unit)) { line += w; continue; }
        if (line + w > columns && line > 0) { lines += 1; line = /^\s/.test(unit) ? 0 : w; } else line += w;
    }
    return lines;
}

// Every help text a launcher or toolbar tooltip can show, as the panel names them.
const HELP_PATHS = [
    "vr_panel.mic_wait.windows", "vr_panel.mic_wait.linux", "vr_panel.locked_by_config_page",
    ...["busy_help", "enable", "disable", "holding_help", "click_recall", "log_open_help", "log_close_help",
        "close_view", "open_view", "choose_anchor", "recall_help", "lock_help", "unlock_help", "font_help", "opacity_help"]
        .map(key => `vr_panel.tooltip.${key}`),
];

const blockedReasons = (tree: LocaleTree): string[] => {
    const section = localeAt(tree, "vr_panel.switch_blocked");
    assert.ok(section && typeof section === "object", "vr_panel.switch_blocked");
    return Object.keys(section).filter(key => key !== "state").map(key => `vr_panel.switch_blocked.${key}`);
};

test("the estimate counts lines as the VR tooltip breaks them", () => {
    // Measured in the panel's page in Chromium: the Japanese wait text of #1300 took four lines,
    // a chat reading reason two.
    assert.equal(estimatedLines("マイクがまだ開いていません。ASTAROTにマイクを使わせるかを、Windowsがデスクトップで確認しているかもしれません。そこで許可すると、字幕が始まります。"), 4);
    assert.equal(estimatedLines("モデルが未取得です。PCの設定「チャット読み取り（OCR）」で取得してください。"), 2);
    assert.equal(estimatedLines("押すと開きます"), 1);
    assert.equal(estimatedLines("No chat reading models yet. Download them in PC settings → OCR."), 2);
});

test("every hint a VR tooltip shows fits two lines, so the overlay shows it", () => {
    for (const language of ["en", "ja"]) {
        const tree = readLocale(language);
        for (const path of [...HELP_PATHS, ...blockedReasons(tree)]) {
            const text = localeAt(tree, path);
            assert.equal(typeof text, "string", `${language}: ${path}`);
            assert.ok(estimatedLines(String(text)) <= 2, `${language}: ${path} takes ${estimatedLines(String(text))} lines: ${text}`);
        }
    }
});
