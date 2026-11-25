import assert from "node:assert/strict";
import { test } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

// #436: one kind of control per job across the settings pages (DESIGN.md "Components").
const settingBox = fileURLToPath(new URL("./setting_section/setting_box/", import.meta.url));
const sources = (dir: string): [string, string][] => readdirSync(dir).flatMap((name): [string, string][] => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(jsx|tsx)$/.test(name) && !/\.test\./.test(name) ? [[path, readFileSync(path, "utf8")]] : [];
});

// K-02 (decided on 2026-11-25) turned #436's checkboxes into the kit's switch: a setting is turned
// on or off with a switch, and a checkbox is left only to confirm consent.
test("K-02: settings turn a setting on or off with the kit's switch; a checkbox only confirms consent", () => {
    const checkboxes: string[] = [];
    for (const [path, text] of sources(settingBox)) {
        assert.doesNotMatch(text, /role=["']switch["']/, `${path} draws a switch of its own`);
        assert.doesNotMatch(text, /SwitchBox|CheckboxContainer|common_components\/checkbox/, `${path} uses a retired settings control`);
        if (/type="checkbox"/.test(text)) checkboxes.push(relative(settingBox, path).split(sep).join("/"));
    }
    assert.deepEqual(checkboxes.sort(), [
        // Consent before a download, and to the license of a translation model.
        "advanced_settings/ModelDownloads.tsx",
        "advanced_settings/VcRuntimeSetup.tsx",
        "ocr/OcrModels.tsx",
        "translation/Translation.tsx",
        // The speech server forms' on/off checkboxes (HintCheck in SpeechServers.tsx, and
        // RealtimeASRSettings.tsx): an open pull request (#1154) changes those forms, so they follow it.
        "_components/hint/HintCheck.tsx",
        "transcription/RealtimeASRSettings.tsx",
    ].sort());
});
