import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

// The app's tokens follow the ASTAROT palette in DESIGN.md (#452). DESIGN.md's front matter is the
// source of the colours; variables.css carries them to the app. These tests keep the two in step
// and hold the contrast rules DESIGN.md states under "Colors".
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const variables = Object.fromEntries([...read("../app/_index_css/variables.css").matchAll(/(--[\w-]+):\s*([^;]+);/g)]
    .map(([, key, value]) => [key, value.trim()]));
const color = token => {
    const value = variables[token] ?? token;
    const alias = /^var\((--[\w-]+)\)$/.exec(value);
    return (alias ? color(alias[1]) : value).toLowerCase();
};
const linear = token => color(token).slice(1, 7).match(/../g).map(channel => parseInt(channel, 16) / 255)
    .map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
const luminance = token => {
    const rgb = linear(token);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
};
// OKLCH as CSS Color 4 converts it, for DESIGN.md's derivation rule.
const oklch = token => {
    const [r, g, b] = linear(token);
    const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b);
    const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b);
    const s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
    const a = 1.9779984951 * l - 2.4285922050 * m + .4505937099 * s;
    const bb = .0259040371 * l + .7827717662 * m - .8086757660 * s;
    return {
        lightness: .2104542553 * l + .7936177850 * m - .0040720468 * s,
        chroma: Math.hypot(a, bb),
        hue: (Math.atan2(bb, a) * 180 / Math.PI + 360) % 360,
    };
};
const hueApart = (x, y) => {
    const turn = Math.abs(x - y) % 360;
    return Math.min(turn, 360 - turn);
};
const contrast = (a, b) => {
    const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (values[0] + .05) / (values[1] + .05);
};

const design = read("../../../DESIGN.md");
const front = design.slice(design.indexOf("colors:"), design.indexOf("typography:"));
const designColor = name => {
    const match = new RegExp(`\\n\\s+${name}:\\s*"(#[0-9a-fA-F]{6})"`).exec(front);
    assert.ok(match, `DESIGN.md has no colour ${name}`);
    return match[1].toLowerCase();
};

test("every DESIGN.md colour is the value of its token", () => {
    const roles = {
        "primary": "--primary_600_color",
        "primary-hover": "--primary_550_color",
        "focus": "--vox_focus",
        "canvas": "--vox_canvas",
        "rail": "--vox_rail",
        "surface": "--vox_surface",
        "border": "--vox_border",
        "field-border": "--vox_field_border",
        "text": "--dark_basic_text_color",
        "secondary-text": "--vox_secondary_text",
        "description-text": "--vox_description_text",
        "state-active": "--vox_state_active",
        "state-warning": "--vox_state_warning",
        "state-failed": "--vox_state_failed",
        "readout-rule": "--vox_readout_rule",
    };
    for (const [role, token] of Object.entries(roles)) assert.equal(color(token), designColor(role), `${role} → ${token}`);
});

test("the three brand colours are where DESIGN.md puts them", () => {
    assert.equal(color("--vox_canvas"), "#261633", "Dark Plum is the canvas");
    assert.equal(color("--primary_600_color"), "#a47af5", "Lilac is the primary fill");
    assert.equal(color("--dark_basic_text_color"), "#fafafc", "Off-White is the text");
    assert.equal(color("--vox_on_primary"), "#261633", "text on Lilac is Dark Plum");
});

test("every grey and Lilac step is its brand colour with only the lightness changed", () => {
    // DESIGN.md "Colors": the OKLCH hue stays within 3° of Dark Plum (dark_*) or Lilac (primary_*),
    // and the chroma does not exceed theirs. The brand's own values DESIGN.md takes as they are,
    // and plain white, which has no hue, are not derived.
    const asIs = new Set(["text", "secondary-text", "description-text"].map(designColor));
    asIs.add("#ffffff");
    const sources = { dark: oklch("#261633"), primary: oklch("#a47af5") };
    const steps = Object.keys(variables).filter(token => /^--(dark|primary)_\d+_color$/.test(token));
    assert.ok(steps.length > 40, "variables.css has its grey and Lilac steps");
    for (const token of steps) {
        if (asIs.has(color(token))) continue;
        const source = sources[token.slice(2).split("_")[0]];
        const { chroma, hue } = oklch(token);
        assert.ok(hueApart(hue, source.hue) <= 3, `${token} ${color(token)}: hue ${hue.toFixed(1)}°, ${source.hue.toFixed(1)}° ± 3°`);
        assert.ok(chroma <= source.chroma, `${token} ${color(token)}: chroma ${chroma.toFixed(4)} > ${source.chroma.toFixed(4)}`);
    }
});

test("the grey steps get darker as their number grows", () => {
    const greys = Object.keys(variables).filter(token => /^--dark_\d+_color$/.test(token))
        .sort((x, y) => Number(x.split("_")[1]) - Number(y.split("_")[1]));
    for (let i = 1; i < greys.length; i++) {
        assert.ok(oklch(greys[i]).lightness < oklch(greys[i - 1]).lightness, `${greys[i]} is lighter than ${greys[i - 1]}`);
    }
});

test("text, secondary text, description text and the states reach 4.5:1 on the canvas, the surface and the rail", () => {
    for (const fg of ["--dark_basic_text_color", "--vox_secondary_text", "--vox_description_text",
        "--vox_state_active", "--vox_state_warning", "--vox_state_failed"]) {
        for (const bg of ["--vox_canvas", "--vox_surface", "--vox_rail"]) {
            assert.ok(contrast(fg, bg) >= 4.5, `${fg} on ${bg}: ${contrast(fg, bg).toFixed(2)}`);
        }
    }
    assert.ok(contrast("--primary_600_color", "--vox_surface") >= 4.5, "Lilac on the surface");
});

test("every Lilac fill carries Dark Plum text at 4.5:1, and the deep violets carry light text", () => {
    for (const step of [450, 500, 550, 600, 650, 700]) {
        const fill = `--primary_${step}_color`;
        assert.ok(contrast("--vox_on_primary", fill) >= 4.5, `${fill}: ${contrast("--vox_on_primary", fill).toFixed(2)}`);
    }
    for (const step of [750, 800, 900]) {
        const fill = `--primary_${step}_color`;
        assert.ok(contrast("--dark_basic_text_color", fill) >= 4.5, `${fill}: ${contrast("--dark_basic_text_color", fill).toFixed(2)}`);
    }
    // Selection keeps light text, so it sits on a deep violet.
    assert.match(read("../app/_index_css/root.css"), /::selection \{ color: var\(--dark_100_color\); background: var\(--primary_800_color\); \}/);
});

test("a field's border reaches 3.5:1 on the surface and 3:1 on every ground, and the focus ring is visible on every ground", () => {
    // DESIGN.md: 3.5:1 against the surface, the field's own fill, and 3:1 against the grounds fields
    // sit on: the canvas, the rail, the dialogs and the language list (dark_875), the switch's track
    // and Quick Chat's box (dark_850, dark_925).
    const border = "--vox_field_border";
    assert.ok(contrast(border, "--vox_surface") >= 3.5, `field border on the surface: ${contrast(border, "--vox_surface").toFixed(2)}`);
    for (const bg of ["--vox_canvas", "--vox_rail", "--dark_875_color", "--dark_850_color", "--dark_925_color"]) {
        assert.ok(contrast(border, bg) >= 3, `field border on ${bg}: ${contrast(border, bg).toFixed(2)}`);
    }
    for (const bg of ["--vox_canvas", "--vox_surface", "--vox_rail"]) assert.ok(contrast("--vox_focus", bg) >= 3, bg);
});

test("fields and outlined controls draw their edge with the field border", () => {
    const views = "../";
    for (const path of [
        "kit/Field.css.ts", "kit/Switch.css.ts",
        "app/config_page/setting_section/setting_box/_components/_atoms/_dropdown_menu/_DropdownMenu.module.scss",
        "app/config_page/setting_section/setting_box/_components/file_drop_zone/FileDropZone.module.scss",
        "app/config_page/setting_section/setting_box/advanced_settings/VoiceSettings.module.scss",
        "app/main_page/main_section/language_selector/LanguageSelector.module.scss",
        "quick_chat/QuickChat.module.scss",
    ]) assert.match(read(views + path), /vox_field_border/, path);
    // The outline buttons have no fill, so the border is their only edge.
    const buttons = read(views + "kit/Button.css.ts");
    for (const tone of ["quiet", "danger"]) {
        assert.match(buttons.slice(buttons.indexOf(`${tone}: {`)), /^[^}]*borderColor: vars\.vox_field_border/, tone);
    }
});

test("no navy value of the old palette is left in the tokens", () => {
    const old = ["#111b2c", "#0d1625", "#18253b", "#344662", "#2865dc", "#5b92ff", "#80acff", "#a9ccff", "#edf3ff"];
    const values = new Set(Object.values(variables).map(value => value.toLowerCase()));
    assert.deepEqual(old.filter(value => values.has(value)), []);
});
