import assert from "node:assert/strict";
import { test } from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// #436: one kind of control per job across the settings pages (DESIGN.md "Components").
const settingBox = fileURLToPath(new URL("./setting_section/setting_box/", import.meta.url));
const sources = (dir) => readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(jsx|tsx)$/.test(name) && !/\.test\./.test(name) ? [[path, readFileSync(path, "utf8")]] : [];
});

test("#436: settings turn a setting on or off with a checkbox, never a switch", () => {
    for (const [path, text] of sources(settingBox)) {
        assert.doesNotMatch(text, /role=["']switch["']/, `${path} draws a switch`);
        assert.doesNotMatch(text, /SwitchBox/, `${path} uses the retired settings switch`);
    }
});
