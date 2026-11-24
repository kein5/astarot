// The shape of the release notes (docs/release-notes/<version>.md, and a beta's notes checked with
// --file under that folder): commas in Japanese sentences and line breaks. Decided on 2026-11-25
// in PR #1157 (item 3), for the release notes only. In other documents, front matter and code
// blocks inside numbered steps make a line-based check of paragraphs read them wrong.
//
// - Commas (docs/writing/japanese-guideline.md「読点」): a Japanese sentence with four or more 「、」
//   outside brackets, and a comma that only makes a pause after a short noun topic at the start of
//   a sentence (「Windowsでは、」). A comma after a condition or a purpose is allowed.
// - Line breaks (the guideline's「書式」and docs/release-notes/README.md): a paragraph is one line,
//   blocks are separated by one blank line, a heading has a blank line before and after it, and no
//   line ends in spaces (a hard break) or in 「：」.
import { BLANK } from "./prose.mjs";

const JA = "docs/writing/japanese-guideline.md";
const NOTES = "docs/release-notes/README.md";

export const COMMA_RULE = {
    id: "ja-release-notes-commas",
    message: `読点が4つ以上ある文です。並べるものは箇条書きにするか、文を分けます（${JA}「読点」「文の組み立て」）`,
};
export const PAUSE_RULE = {
    id: "ja-release-notes-pause-comma",
    message: `文の頭の短い主題のあとの、間を置くだけの読点です（${JA}「読点」）`,
};
export const BREAK_RULE = {
    id: "release-notes-breaks",
    message: `段落は1行に書き、ブロックの間は空行1つにします（${JA}「書式」、${NOTES}）`,
};

const KANA = /[぀-ヿ]/;
// Text in brackets lists names; its commas are not the sentence's own.
const BRACKETS = /（[^（）]*）|「[^「」]*」|\([^()]*\)/g;
// A topic of up to eight characters, then は, では or には and a comma. Longer topics (with a
// relative clause) may need the comma to be read right. A topic that ends in hiragana is a verb
// or a condition (「変換するには、」「終わるまでは、」「ときは、」), and 「場合は、」 closes a condition:
// a comma may follow those.
const PAUSE = /^[^、。「」（）()]{1,8}?(?<![\u3040-\u309f])(?<!場合)(?:では|には|は)、/;

export const isReleaseNotes = (file) => /^docs\/release-notes\//.test(file) && !/\/README\.md$/.test(file);

// The prose lines (from markdownProse) give the commas; the raw lines give the breaks.
export const releaseNotesFindings = (file, source, prose) => {
    const findings = [];
    const add = (rule, line, column, text) =>
        findings.push({ file, line, column, kind: rule.id, text, message: rule.message });

    for (const line of prose) {
        if (line.heading || /^\s*\|/.test(line.text) || !KANA.test(line.text)) continue;
        // Code, links and URLs are blanked by markdownProse; one stand-in each keeps topics short.
        const text = line.text.replace(new RegExp(`${BLANK}+`, "g"), "X").replace(/^\s*(?:[-*]|\d+\.)\s+/, "");
        for (const sentence of text.split(/(?<=[。！？])/)) {
            const trimmed = sentence.trim();
            if (!trimmed || !KANA.test(trimmed)) continue;
            const commas = (trimmed.replace(BRACKETS, "").match(/、/g) ?? []).length;
            if (commas >= 4) add(COMMA_RULE, line.line, 1, trimmed.slice(0, 40));
            const pause = trimmed.match(PAUSE);
            if (pause) add(PAUSE_RULE, line.line, 1, pause[0]);
        }
    }

    const lines = source.split(/\r?\n/);
    let fence = null;
    let front = lines[0]?.trim() === "---";
    const special = (raw) => /^\s*(?:#{1,6}\s|[-*]\s|\d+\.\s|\||<!--|---\s*$|```|~~~)/.test(raw);
    for (let index = 0; index < lines.length; index++) {
        const raw = lines[index];
        const number = index + 1;
        if (front) {
            if (index > 0 && raw.trim() === "---") front = false;
            continue;
        }
        const mark = raw.match(/^\s*(```+|~~~+)/);
        if (fence) {
            if (mark && mark[1][0] === fence[0] && mark[1].length >= fence.length) fence = null;
            continue;
        }
        if (mark) {
            fence = mark[1];
            continue;
        }
        if (raw !== raw.trimEnd()) add(BREAK_RULE, number, raw.trimEnd().length + 1, "行末の空白");
        if (raw.trimEnd().endsWith("：")) add(BREAK_RULE, number, raw.trimEnd().length, "行末の「：」");
        const previous = lines[index - 1];
        if (index > 0 && !raw.trim() && previous !== undefined && !previous.trim())
            add(BREAK_RULE, number, 1, "空行が2つ続く");
        if (/^#{1,6}\s/.test(raw)) {
            if (index > 0 && previous?.trim()) add(BREAK_RULE, number, 1, "見出しの前に空行がない");
            if (lines[index + 1]?.trim()) add(BREAK_RULE, number, 1, "見出しのあとに空行がない");
            continue;
        }
        // A paragraph line right after another paragraph line: the paragraph is broken.
        if (
            raw.trim() &&
            !special(raw) &&
            !/^\s/.test(raw) &&
            previous?.trim() &&
            !special(previous) &&
            !/^\s/.test(previous)
        )
            add(BREAK_RULE, number, 1, "段落の途中の改行");
    }
    return findings;
};
