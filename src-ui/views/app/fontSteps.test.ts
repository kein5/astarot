import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import { fontSizes, isStylesheet } from "../../logics/test/fontSizes.ts";

// The app window's text takes the steps DESIGN.md names (#568), in its stylesheets and in its
// vanilla-extract files (ADR-010). The VR windows have steps of their own (vr/fontSteps.test.ts).
// The caption overlay draws its captions at the size its user picks; its fixed text, and the tray
// companion's hexagram, take the app's steps in px, since those windows do not follow the UI size.
// Sizes relative to their parent (em, %) and 0 (hidden text) follow the parent.
const views = fileURLToPath(new URL("..", import.meta.url));
const design = readFileSync(new URL("../../../DESIGN.md", import.meta.url), "utf8");
const steps = new Set([...design.split("rounded:")[0].matchAll(/fontSize: "([\d.]+rem)"/g)].map(([, size]) => size));
// The windows drawn in px, which do not follow the UI size.
const PX_WINDOWS = ["caption_overlay", "companion_handle"];
// The log's base size, which the log font size setting replaces from JavaScript.
const allowed = new Set(["app/main_page/main_section/message_container/log_box/LogBox.module.scss:1rem"]);

const sources = (dir: string): string[] => readdirSync(dir).flatMap((name): string[] => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return PX_WINDOWS.concat("vr").includes(name) && dir === views ? [] : sources(path);
    return isStylesheet(name) ? [path] : [];
});

test("DESIGN.md names the type steps", () => {
    assert.ok(steps.has("1.4rem") && steps.has("2.4rem"), [...steps].join(" "));
});

test("the app window's font sizes are on DESIGN.md's steps", () => {
    const off = [], files = sources(views);
    assert.ok(files.length > 50 && !files.some(path => /^(vr|caption_overlay|companion_handle)[\\/]/.test(path.slice(views.length))), String(files.length));
    assert.ok(files.some(path => path.endsWith(".css.ts")), "the vanilla-extract files are read too");
    for (const path of files) {
        const file = path.slice(views.length).replaceAll("\\", "/");
        for (const size of fontSizes(readFileSync(path, "utf8"), file)) {
            if (!/^[\d.]+(rem|px)$/.test(size) || size === "0") continue;
            if (!steps.has(size) && !allowed.has(`${file}:${size}`)) off.push(`${file}: ${size}`);
        }
    }
    assert.deepEqual(off, []);
});

test("the caption overlay's fixed font sizes, and the hexagram's, are the app's steps in px", () => {
    // At the default UI size 1rem is 10px (root.css), so 1.4rem is 14px.
    const px = new Set([...steps].map(size => `${+(parseFloat(size) * 10).toFixed(2)}px`));
    for (const window of PX_WINDOWS) {
        const dir = join(views, window);
        const files = readdirSync(dir).filter(isStylesheet);
        const off = [];
        let fixed = 0;
        for (const file of files) {
            for (const size of fontSizes(readFileSync(join(dir, file), "utf8"), file)) {
                // The captions' own size (var(--caption_font_size, ...)), and sizes relative to it.
                if (!/^[\d.]+(rem|px)$/.test(size)) continue;
                fixed += 1;
                if (!px.has(size)) off.push(`${window}/${file}: ${size}`);
            }
        }
        assert.ok(files.length >= 1 && fixed >= 1, `${window}: ${files.join(" ")} ${fixed}`);
        assert.deepEqual(off, []);
    }
});
