import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

// The app window's text takes the steps DESIGN.md names (#568). The VR windows draw into the
// headset at fixed pixel sizes and the caption overlay at the size its user picks; both are
// left out here. Sizes relative to their parent (em, %) and 0 (hidden text) follow the parent.
const views = fileURLToPath(new URL("..", import.meta.url));
const design = readFileSync(new URL("../../../DESIGN.md", import.meta.url), "utf8");
const steps = new Set([...design.split("rounded:")[0].matchAll(/fontSize: "([\d.]+rem)"/g)].map(([, size]) => size));
// The log's base size, which the log font size setting replaces from JavaScript.
const allowed = new Set(["app/main_page/main_section/message_container/log_box/LogBox.module.scss:1rem"]);

const sources = dir => readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return ["vr", "caption_overlay"].includes(name) && dir === views ? [] : sources(path);
    return /\.(s?css)$/.test(name) ? [path] : [];
});

test("DESIGN.md names the type steps", () => {
    assert.ok(steps.has("1.4rem") && steps.has("2.4rem"), [...steps].join(" "));
});

test("the app window's font sizes are on DESIGN.md's steps", () => {
    const off = [], files = sources(views);
    assert.ok(files.length > 50 && !files.some(path => /^(vr|caption_overlay)[\\/]/.test(path.slice(views.length))), String(files.length));
    for (const path of files) {
        const file = path.slice(views.length).replaceAll("\\", "/");
        for (const [, value] of readFileSync(path, "utf8").matchAll(/font-size:\s*([^;}]+)/g)) {
            const size = value.replace("!important", "").trim();
            if (!/^[\d.]+(rem|px)$/.test(size) || size === "0") continue;
            if (!steps.has(size) && !allowed.has(`${file}:${size}`)) off.push(`${file}: ${size}`);
        }
    }
    assert.deepEqual(off, []);
});
