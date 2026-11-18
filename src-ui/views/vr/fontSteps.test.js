import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

// The VR panel draws into the headset in pixels of its own, on the VR steps DESIGN.md names
// (#568). The log's text is the size picked with A−/A＋ in the toolbar, so it is left out.
// Sizes relative to their parent (em, %) and 0 (hidden text) follow the parent.
const vr = fileURLToPath(new URL(".", import.meta.url));
const design = readFileSync(new URL("../../../DESIGN.md", import.meta.url), "utf8");
const front = design.slice(design.indexOf("typography:"), design.indexOf("rounded:"));
const steps = new Set([...front.matchAll(/vr-[\w-]+:\s*fontSize: "(\d+px)"/g)].map(([, size]) => size));
const allowed = new Set(["VrWindow.module.scss:clamp(14px, var(--vr_log_font_size, 17px), 28px)"]);

// font-size, and the size in a font shorthand (`font: 600 19px/1.2 ...`).
const sizes = source => [
    ...[...source.matchAll(/font-size:\s*([^;}]+)/g)].map(([, value]) => value.replace("!important", "").trim()),
    ...[...source.matchAll(/font:\s*([^;}]+)/g)].flatMap(([, value]) => value.match(/\b[\d.]+(?:px|rem)\b/)?.[0] ?? []),
];

test("DESIGN.md names the VR type steps", () => {
    assert.ok(steps.size >= 3 && steps.has("16px"), [...steps].join(" "));
});

test("the VR panel's font sizes are on DESIGN.md's VR steps", () => {
    const files = readdirSync(vr).filter(name => /\.s?css$/.test(name));
    assert.ok(files.length >= 7, files.join(" "));
    const off = [];
    for (const file of files) {
        for (const size of sizes(readFileSync(join(vr, file), "utf8"))) {
            if (allowed.has(`${file}:${size}`) || /^[\d.]+(em|%)$/.test(size) || size === "0") continue;
            if (!steps.has(size)) off.push(`${file}: ${size}`);
        }
    }
    assert.deepEqual(off, []);
});
