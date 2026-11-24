import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { contrast, fromOklch, hueApart, splitHex, toOklch } from "./color.ts";
import { DERIVED_TOKENS } from "./palette.ts";
import {
    CONTRAST_RULES, CUSTOM, DEFAULT_PRESET, DEFAULT_THEME, KEPT_HUE_TOKENS, PRESETS, THEME_TOKENS, accentNearStates,
    applyThemeTokens, deriveTokens, themeColors, themeSetting, themeTokens,
} from "./themes.ts";

// The themes (#965) keep DESIGN.md "Colors": every derived step is its theme colour with only the
// lightness changed, and the contrasts DESIGN.md asks for hold in every theme, the user's own too.
const variables = Object.fromEntries([...readFileSync(new URL("../../views/app/_index_css/variables.css", import.meta.url), "utf8")
    .matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, key, value]) => [key, value.trim().toLowerCase()]));
const rgb = (hex: string) => splitHex(hex).rgb;
const ratio = (tokens: Record<string, string>, a: string, b: string) => contrast(rgb(tokens[a]), rgb(tokens[b]));
// Warning and failed keep their colours in every theme and are checked against its grounds too.
const withFixed = (tokens: Record<string, string>): Record<string, string> => ({ ...tokens,
    "--vox_state_warning": variables["--vox_state_warning"], "--vox_state_failed": variables["--vox_state_failed"] });

test("the derived tokens and the kept hues are variables.css's, so the default theme is the stylesheet", () => {
    for (const [token, { value }] of Object.entries(DERIVED_TOKENS)) assert.equal(value, variables[token], token);
    for (const [token, value] of Object.entries(KEPT_HUE_TOKENS)) assert.equal(value, variables[token], token);
    // Every colour of variables.css is derived, kept, or listed here as one a theme leaves alone.
    const leftAlone = ["--sent_400_color", "--received_300_color", ...Object.keys(KEPT_HUE_TOKENS), "--error_bc_color", "--error_bc_active_color", "--warning_color",
        "--warning_bc_color", "--vox_state_warning", "--vox_state_failed", "--vox_warning_tint", "--vox_chatbox_preview", "--dark_50_color"];
    const colours = Object.keys(variables).filter(token => /^#[0-9a-f]{6,8}$/.test(variables[token]));
    for (const token of colours) assert.ok(token in DERIVED_TOKENS || leftAlone.includes(token), `${token} has a place in the themes`);
    assert.deepEqual(themeTokens(DEFAULT_THEME), null);
    assert.equal(PRESETS[0].id, DEFAULT_PRESET);
    assert.deepEqual(PRESETS[0].colors, { base: variables["--vox_canvas"], accent: variables["--primary_600_color"] });
});

test("every preset keeps DESIGN.md's contrasts, its hues and its order of lightness", () => {
    assert.equal(new Set(PRESETS.map(preset => preset.id)).size, PRESETS.length);
    for (const { id, colors } of PRESETS) {
        const tokens = withFixed(deriveTokens(colors));
        for (const rule of CONTRAST_RULES) for (const ground of rule.against) {
            assert.ok(ratio(tokens, rule.adjust, ground) >= rule.min, `${id}: ${rule.adjust} on ${ground} ${ratio(tokens, rule.adjust, ground).toFixed(2)}`);
        }
        for (const state of ["--vox_state_warning", "--vox_state_failed"]) for (const ground of ["--vox_canvas", "--vox_surface", "--vox_rail"]) {
            assert.ok(ratio(tokens, state, ground) >= 4.5, `${id}: ${state} on ${ground}`);
        }
        // Each step takes its theme colour's hue, and no more chroma than that colour has. A step
        // with almost no chroma has no hue to speak of.
        for (const [token, { source }] of Object.entries(DERIVED_TOKENS)) {
            const step = toOklch(rgb(tokens[token])), from = toOklch(colors[source]);
            assert.ok(step.chroma <= from.chroma + .002, `${id}: ${token} is more vivid than its colour`);
            if (step.chroma > .02) assert.ok(hueApart(step.hue, from.hue) <= 3, `${id}: ${token} hue ${step.hue.toFixed(1)}°, ${from.hue.toFixed(1)}°`);
        }
        // The greys get darker as their number grows, as in the default theme.
        const greys = Object.keys(DERIVED_TOKENS).filter(token => /^--dark_\d+_color$/.test(token))
            .sort((x, y) => Number(x.split("_")[1]) - Number(y.split("_")[1]));
        for (let i = 1; i < greys.length; i++) {
            assert.ok(toOklch(rgb(tokens[greys[i]])).lightness < toOklch(rgb(tokens[greys[i - 1]])).lightness, `${id}: ${greys[i]}`);
        }
        // Text on a fill is the theme's canvas, as Dark Plum is on Lilac.
        assert.equal(tokens["--vox_on_primary"], tokens["--vox_canvas"], `${id}: text on the accent`);
        // The presets are told apart from warning and failed.
        assert.deepEqual(accentNearStates(colors.accent), [], `${id}: its accent is not a state's colour`);
        // The speakers keep the caption overlay's hues; only their lightness moves (#1036).
        for (const token of ["--vox_speaker_a", "--vox_speaker_b", "--vox_speaker_c", "--vox_speaker_d"]) {
            assert.ok(hueApart(toOklch(rgb(tokens[token])).hue, toOklch(rgb(KEPT_HUE_TOKENS[token])).hue) <= 3, `${id}: ${token} keeps its hue`);
        }
    }
});

test("the user's own colours keep the contrasts too, whatever the two colours are", () => {
    const seeds = ["#000000", "#ffffff", "#ff0000", "#00ff00", "#0000ff", "#ffff00", "#00ffff", "#ff00ff", "#808080"];
    for (let hue = 0; hue < 360; hue += 45) for (const lightness of [.2, .5, .85]) seeds.push(fromOklch({ lightness, chroma: .2, hue }));
    for (const base of seeds) for (const accent of seeds) {
        const tokens = deriveTokens({ base, accent });
        for (const rule of CONTRAST_RULES) for (const ground of rule.against) {
            assert.ok(ratio(tokens, rule.adjust, ground) >= rule.min, `${base} ${accent}: ${rule.adjust} on ${ground}`);
        }
    }
});

test("the setting is read as saved; a preset this version does not know is the default", () => {
    const custom = { base: "#10272B", accent: "#3fc8c2" };
    assert.deepEqual(themeSetting({ preset: "midnight", custom }), { preset: "midnight", custom: { base: "#10272b", accent: "#3fc8c2" } });
    for (const bad of [null, "midnight", { preset: "midnight" }, { preset: 1, custom }, { preset: "custom", custom: { base: "#10272b" } },
        { preset: "custom", custom: { base: "#10272b", accent: "#3fc8c2ff" } }, { preset: "custom", custom: { base: "teal", accent: "#3fc8c2" } }]) {
        assert.equal(themeSetting(bad), null, JSON.stringify(bad));
    }
    assert.deepEqual(themeColors({ preset: "midnight", custom }), PRESETS.find(preset => preset.id === "midnight")?.colors);
    assert.deepEqual(themeColors({ preset: CUSTOM, custom }), custom);
    assert.deepEqual(themeColors({ preset: "a_newer_preset", custom }), PRESETS[0].colors);
    assert.deepEqual(themeColors(null), PRESETS[0].colors);
    assert.equal(themeTokens({ preset: "a_newer_preset", custom }), null, "drawn as the default, the stylesheet");
    // The user's own colours set to the brand's are the default too.
    assert.equal(themeTokens({ preset: CUSTOM, custom: PRESETS[0].colors }), null);
});

test("an accent close to warning or failed is said to be; one away from them is not", () => {
    assert.deepEqual(accentNearStates("#e0a040"), ["warning"]);
    assert.deepEqual(accentNearStates("#e05a50"), ["failed"]);
    assert.deepEqual(accentNearStates("#a47af5"), []);
    // A grey has no hue to be mistaken for.
    assert.deepEqual(accentNearStates("#808080"), []);
});

test("a theme's tokens are set on the page, and taken away for the default theme", () => {
    const properties = new Map<string, string>();
    const style = { setProperty: (name: string, value: string) => { properties.set(name, value); },
        removeProperty: (name: string) => { properties.delete(name); return ""; } };
    const midnight = themeTokens({ preset: "midnight", custom: DEFAULT_THEME.custom });
    assert.ok(midnight);
    applyThemeTokens(style, midnight);
    assert.equal(properties.size, THEME_TOKENS.length);
    assert.equal(properties.get("--vox_canvas"), midnight["--vox_canvas"]);
    applyThemeTokens(style, null);
    assert.equal(properties.size, 0);
});
