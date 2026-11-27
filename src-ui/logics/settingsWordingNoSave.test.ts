import assert from "node:assert/strict";
import { test } from "vitest";
import { branchAt, readLocale } from "./test/locales.ts";
import type { LocaleBranch } from "./test/locales.ts";

// Every setting saves by itself (#1111): what the app asks the user to do about a setting does not
// ask them to save it (#1266, C-2). A key or a secret is still saved on its own, and a failed save
// can still say so; those lists are not read here.
const ASKING = ["main_page.switch_blocked", "realtime_toggle", "voice_ui.errors", "speech_servers.errors", "common_warning"];
const SAVE = { en: /\bsave\b/i, ja: /保存して|保存し、|保存し直/ };
const strings = (branch: LocaleBranch, path: string): [string, string][] => Object.entries(branch).flatMap(([key, value]) =>
    typeof value === "string" ? [[`${path}.${key}`, value] as [string, string]] : value && typeof value === "object" ? strings(value as LocaleBranch, `${path}.${key}`) : []);

for (const language of ["en", "ja"] as const) test(`${language}: what the app asks of a setting does not ask to save it`, () => {
    const locale = readLocale(language);
    const asks = ASKING.flatMap(path => strings(branchAt(locale, path), path))
        // A save that could not be confirmed, or failed, is about the save itself.
        .filter(([key]) => !/save_unconfirmed|settings_invalid|config_save_failed/.test(key));
    assert.ok(asks.length > 50);
    assert.deepEqual(asks.filter(([, text]) => SAVE[language].test(text)).map(([key]) => key), []);
});
