import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

// #462: blue marks the main action (DESIGN.md). Every download review's start button is one,
// so each button that says model_downloads.start carries className="primary".
const root = fileURLToPath(new URL("../../../../../../../", import.meta.url));
const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? sources(join(dir, entry.name)) : /\.(jsx|tsx)$/.test(entry.name) ? [join(dir, entry.name)] : []);

test("#462: every download review's start button is the primary button", () => {
    const starts: { file: string; primary: boolean }[] = [];
    for (const file of sources(root)) {
        const text = readFileSync(file, "utf8");
        for (const match of text.matchAll(/"model_downloads\.start"/g)) {
            const button = text.slice(text.lastIndexOf("<button", match.index), match.index);
            starts.push({ file: file.slice(root.length), primary: button.includes('className="primary"') });
        }
    }
    assert.ok(starts.length >= 3, "the voice, chat reading and legacy reviews");
    assert.deepEqual(starts.filter(start => !start.primary), []);
});
