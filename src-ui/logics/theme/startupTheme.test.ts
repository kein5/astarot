import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule } from "../test/hookHarness.ts";
import { applyStartupTheme, STARTUP_THEME_GLOBAL, startupTheme } from "./startupTheme.ts";
import { deriveTokens, DEFAULT_THEME } from "./themes.ts";

// The theme a window shows from its first paint (#1259): the shell sets the global before the
// page loads (src-tauri/src/startup_theme.rs), and the page puts it in place before its first
// render.

const MIDNIGHT = { preset: "midnight", custom: { base: "#14203a", accent: "#6ea8fe" } };
const given = (value: unknown) => ({ [STARTUP_THEME_GLOBAL]: value });
// A root's style: what is set over the stylesheet.
const rootStyle = () => {
    const set = new Map<string, string>();
    return { set, style: { setProperty: (name: string, value: string) => { set.set(name, value); }, removeProperty: (name: string) => { set.delete(name); return ""; } } };
};

test("the page reads the theme the shell gave it, null for none, and nothing where there is no shell", () => {
    assert.deepEqual(startupTheme(given(MIDNIGHT)), MIDNIGHT);
    assert.equal(startupTheme(given(null)), null);
    // Something that is not a theme is the default theme.
    assert.equal(startupTheme(given("midnight")), null);
    assert.equal(startupTheme(given({ preset: "midnight" })), null);
    // A browser: no shell, no global.
    assert.equal(startupTheme({}), undefined);
});

test("a chosen theme is put on the root before the first render, and the default theme sets nothing", () => {
    const chosen = rootStyle();
    assert.deepEqual(applyStartupTheme(chosen.style, given(MIDNIGHT)), MIDNIGHT);
    assert.deepEqual(Object.fromEntries(chosen.set), Object.fromEntries(Object.entries(deriveTokens(MIDNIGHT.custom))));
    for (const scope of [given(DEFAULT_THEME), given(null), {}]) {
        const plain = rootStyle();
        applyStartupTheme(plain.style, scope);
        assert.equal(plain.set.size, 0, "a page on the default theme starts as it always did");
    }
});

// The windows whose theme is the Appearance setting: the shell's theme is put in place and is the
// setting's value until the setting comes, still pending, so the controller's first run keeps it.
test("the main, settings and VR windows start with the shell's theme as the setting's value", async () => {
    for (const [shell, seeded] of [[MIDNIGHT, true], [null, false], [undefined, false]] as const) {
        const sets: unknown[] = [], atom = { name: "Theme" };
        let value: unknown = { state: "pending", data: DEFAULT_THEME };
        const { startWithSavedTheme } = await loadModule<typeof import("./startWithSavedTheme.ts")>(new URL("./startWithSavedTheme.ts", import.meta.url), hooks(), {
            jotai: { getDefaultStore: () => ({ set: (target: unknown, update: (previous: unknown) => unknown) => {
                sets.push(target);
                value = update(value);
            } }) },
            "@store": { dynamicStoreRegistry: { Atom_Theme: atom } },
            "../configs/config_page_setter/ui_config_setter": {},
            "./startupTheme.ts": { applyStartupTheme: () => shell },
        });
        assert.equal(startWithSavedTheme(), shell);
        assert.deepEqual(sets, seeded ? [atom] : [], String(shell));
        assert.deepEqual(value, { state: "pending", data: seeded ? MIDNIGHT : DEFAULT_THEME });
    }
});
