import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

const locale = language => readFileSync(new URL(`../../../locales/${language}.yml`, import.meta.url), "utf8");

// #437: the UI speaks to the user about their own PC ("お使いのPC", "your PC"), or leaves
// the PC out where it adds nothing. "This PC" reads as the developer's machine.
// #437: English headings and labels are in sentence case: only the first word, names and
// acronyms start with a capital. A label with two or more other capitalized words is Title Case.
const NAMES = new Set(`VRChat VRC ASTAROT OSC OSCQuery OBS Browser Source TTS RVC ASR OCR VR UI API URL IP IPv4 LAN
    GPU CPU CUDA Windows Linux PipeWire Whisper DeepL Google Cloud Papago Plamo Gemini OpenAI OpenAI-compatible Groq
    OpenRouter LM Studio Ollama LLM CTranslate2 WebSocket VAD Enter Esc Shift Speech Text Voice Chat Quick Local
    Japanese English Chinese Latin Hiragana Qwen3-TTS AI ID GiB Push-To-Talk`.split(/\s+/));
test("#437: English labels and headings are in sentence case", () => {
    const labels = locale("en").split("\n")
        .map(line => /^\s*(label|section_label\w*|title\w*): "([^"]{1,60})"$/.exec(line))
        .filter(Boolean).map(match => match[2]);
    const titleCase = labels.filter(value => {
        const words = value.match(/[A-Za-z][\w'-]*/g) ?? [];
        return words.slice(1).filter(word => /^[A-Z]/.test(word) && !NAMES.has(word) && word !== word.toUpperCase()).length >= 2;
    });
    assert.deepEqual(titleCase, []);
});

test("#437: user-facing strings do not say this PC", () => {
    for (const [language, phrase] of [["ja", /この\s*(PC|パソコン|コンピューター)/], ["en", /\bthis (PC|computer|machine)\b/i]]) {
        const lines = locale(language).split("\n").filter(line => phrase.test(line));
        assert.deepEqual(lines, [], language);
    }
});

// #461: the user meets "ASTAROTの処理部分" / "the ASTAROT engine", not the developers' word.
// The credits say what each developer worked on, so they may keep it.
test("#461: user-facing strings do not say backend", () => {
    for (const [language, word] of [["ja", /バックエンド/], ["en", /\bback-?end\b/i]]) {
        const lines = locale(language).split("\n").filter(line => !line.trim().startsWith("#") && !/^\s*dev_\w+:/.test(line))
            // Keys may name the backend; only the text after the key counts.
            .filter(line => word.test(line.split('"').slice(1).join('"')));
        assert.deepEqual(lines, [], language);
    }
});

test("#472: Japanese strings write メモリ, not メモリー", () => {
    assert.deepEqual(locale("ja").split("\n").filter(line => line.includes("メモリー")), []);
});

// #477: the app is called ASTAROT. Only the line that explains the old name may say VRCT-VOX.
test("#477: user-facing strings use ASTAROT, not the old name", () => {
    for (const language of ["ja", "en"]) {
        const lines = locale(language).split("\n").filter(line => line.includes("VRCT-VOX") && !/^\s*fork_notice:/.test(line));
        assert.deepEqual(lines, [], language);
    }
});

// #476: Japanese says オン／オフ, and puts no space between Japanese and a Latin word.
test("#476: Japanese strings say オン／オフ, not ON／OFF", () => {
    assert.deepEqual(locale("ja").split("\n").filter(line => /(^|[^A-Za-z])(ON|OFF)([^A-Za-z]|$)/.test(line.split('"').slice(1).join('"'))), []);
});

test("#476: Japanese strings put no space between Japanese and a Latin word", () => {
    const jp = "[\\u3040-\\u30ff\\u4e00-\\u9fff]";
    const units = new Set(["ms", "Hz", "GB", "GiB", "MB"]);
    const spaced = new RegExp(`([A-Za-z][\\w.-]*) (?=${jp})|${jp} ([A-Za-z][\\w.-]*)`, "g");
    const lines = locale("ja").split("\n").filter(line => !line.trim().startsWith("#") && line.includes('"')).filter(line => {
        const value = line.split('"').slice(1).join('"');
        // A URL or an English sentence keeps its spaces.
        if (/https?:\/\/|[A-Za-z]+\. /.test(value)) return false;
        return [...value.matchAll(spaced)].some(match => !units.has(match[1] ?? match[2]));
    });
    assert.deepEqual(lines, []);
});
