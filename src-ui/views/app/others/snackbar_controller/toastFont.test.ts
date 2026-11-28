import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

// #1314 (M-10): the notices drew with the chosen font alone ("Yu Gothic UI" by default). On a PC
// without it, their Latin text fell back to the browser's default serif font while the rest of the
// window used Noto Sans. The notices take the window's own stack (root.css).
test("the notices use the same font stack as the rest of the window", () => {
    const root = readFileSync(new URL("../../_index_css/root.css", import.meta.url), "utf8");
    const stack = /font-family:\s*var\(--font_family\),\s*([^;]+);/.exec(root);
    assert.ok(stack, "root.css names the chosen font with its fallbacks");
    const fallbacks = stack[1].trim();
    const toast = readFileSync(new URL("./ReactToastifyOverrideClass.css.ts", import.meta.url), "utf8");
    const value = /"--toastify-font-family":\s*`([^`]+)`/.exec(toast);
    assert.ok(value, "the notices' font is a template with the chosen font first");
    assert.equal(value[1], `\${vars.font_family}, ${fallbacks}`);
});
