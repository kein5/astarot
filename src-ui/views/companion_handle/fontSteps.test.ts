import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import { fontSizes, isStylesheet } from "../../logics/test/fontSizes.ts";

// The tray companion's hexagram is a small window at the screen's edge, drawn in px that do not
// follow the UI size, on the hexagram steps DESIGN.md names (#568). Sizes relative to their parent
// (em, %) and 0 (hidden text) follow the parent.
const handle = fileURLToPath(new URL(".", import.meta.url));
const design = readFileSync(new URL("../../../DESIGN.md", import.meta.url), "utf8");
const front = design.slice(design.indexOf("typography:"), design.indexOf("rounded:"));
const steps = new Set([...front.matchAll(/hexagram-[\w-]+:\s*fontSize: "(\d+px)"/g)].map(([, size]) => size));

test("DESIGN.md names the hexagram's type steps", () => {
    assert.deepEqual([...steps].sort(), ["12px", "13px", "14px"]);
});

test("the hexagram's font sizes are on DESIGN.md's hexagram steps", () => {
    // Stylesheets and vanilla-extract files (ADR-010) alike (fontSizes).
    const files = readdirSync(handle).filter(isStylesheet);
    assert.ok(files.length >= 1, files.join(" "));
    const off = [];
    let fixed = 0;
    for (const file of files) {
        for (const size of fontSizes(readFileSync(join(handle, file), "utf8"), file)) {
            if (/^[\d.]+(em|%)$/.test(size) || size === "0") continue;
            fixed += 1;
            if (!steps.has(size)) off.push(`${file}: ${size}`);
        }
    }
    assert.ok(fixed >= 3, String(fixed));
    assert.deepEqual(off, []);
});
