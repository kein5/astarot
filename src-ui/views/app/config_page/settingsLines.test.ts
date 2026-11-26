import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { test } from "vitest";
import { styleOf } from "../../../logics/test/styleSource.ts";

// #1233: the settings pages draw their lines quieter than the rest of the app, as T3 Code's
// settings do, and group what a section heading heads on a rounded ground of its own.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const section = read("setting_section/SettingSection.css.ts");

test("the settings' quiet lines are set on the settings' content only, from the theme's own tokens", () => {
    const container = styleOf(section, "container");
    // The ground, the frame and the rule, mixed from the theme's tokens, so every theme keeps the steps.
    assert.match(section, /const GROUP = `color-mix\(in oklab, \$\{vars\.vox_surface\} 50%, \$\{vars\.vox_canvas\}\)`;/);
    assert.match(section, /const FRAME = `color-mix\(in oklab, \$\{vars\.dark_800_color\} 62%, \$\{vars\.vox_canvas\}\)`;/);
    assert.match(section, /const RULE = `color-mix\(in oklab, \$\{vars\.dark_800_color\} 50%, \$\{vars\.vox_canvas\}\)`;/);
    assert.match(container, /"--settings_group": GROUP,\s*"--settings_frame": FRAME,\s*"--settings_rule": RULE,/);
    // The app's border colour is the frame inside the settings' content, and nowhere else.
    assert.match(container, /\[vars\.vox_border\]: "var\(--settings_frame\)"/);
    // Field outlines keep the contrast DESIGN.md asks for: the field border is not changed here.
    assert.doesNotMatch(section, /vox_field_border/);
    // One layer for the content: the grounds lie under all of it, and a hint reaches over the next group.
    assert.match(container, /isolation: "isolate"/);
});

test("what a section heading heads sits on one rounded, framed ground drawn behind it", () => {
    // The section: the element whose first child is the heading, unless it holds only a fold or
    // the catalog's layout switch.
    assert.match(section, /:is\(div, section\):has\(> \[data-section-label\]:first-child\)`\s*\+ ":not\(:has\(> \[data-section-label\] \+ :is\(details, \[role=\\"radiogroup\\"\]\):last-child\)\)"/);
    // The ground: placed on the section's grid from the row after the heading to its end, under its parts.
    const ground = section.slice(section.indexOf("::before`, {"));
    assert.match(ground, /position: "absolute",\s*gridRowStart: 2,\s*gridRowEnd: "auto",\s*gridColumn: "auto",/);
    assert.match(ground, /zIndex: -1,\s*background: "var\(--settings_group\)",\s*border: `\$\{LINE\} solid var\(--settings_frame\)`,\s*borderRadius: GROUP_RADIUS,/);
    assert.match(section, /const GROUP_RADIUS = "1\.2rem";/);
    // The parts keep a fold's insets (Fold.css.ts), so fields and right edges line up with a fold's.
    assert.match(section, /const START = `calc\(\$\{INSET\} - \$\{LINE\}\)`;\s*const END = `calc\(\$\{INSET\} \* 1\.6 - \$\{LINE\}\)`;/);
    assert.match(read("setting_section/setting_box/_components/fold/Fold.css.ts"), /padding: `1\.6rem calc\(\$\{inset\} \* 1\.6 - \$\{line\}\) 1\.6rem calc\(\$\{inset\} - \$\{line\}\)`/);
    // The last row draws no line of its own on the group's frame.
    assert.match(section, /\[`\$\{section\} > \[data-hint-row\]:last-child`, `\$\{section\} > :last-child > \[data-hint-row\]:last-child`\]\.join\(", "\),\s*\{ borderBottomColor: "transparent" \}/);
    // The expanded rail of a narrow window still lies over the content.
    assert.match(styleOf(read("sidebar_section/SidebarSection.css.ts"), "container"), /position: "relative",[\s\S]*?zIndex: 1,/);
});

// Every .css.ts under a folder.
const sheets = (folder: URL): string[] => readdirSync(folder).flatMap(name => {
    const path = new URL(name, folder);
    if (statSync(path).isDirectory()) return sheets(new URL(`${name}/`, folder));
    return name.endsWith(".css.ts") ? [path.pathname] : [];
});

test("no line on the settings pages keeps the old, stronger colour; a row's rule falls back to the border colour elsewhere", () => {
    const files = [...sheets(new URL("setting_section/", import.meta.url)),
        ...["Card.css.ts", "Toggle.css.ts"].map(name => new URL(`../../kit/${name}`, import.meta.url).pathname)];
    const strong = files.flatMap(file => readFileSync(file, "utf8").split("\n")
        .filter(line => /\b(border|borderTop|borderBottom|borderInline(Start|End)?|outline)\b[^:]*:.*dark_800_color/.test(line))
        .map(line => `${file.split("/src-ui/")[1]}: ${line.trim()}`));
    assert.deepEqual(strong, []);
    // A part a dialog or the main screen also shows keeps its line there: the quiet rule has a fallback.
    for (const path of ["setting_section/setting_box/_templates/Templates.css.ts", "setting_section/setting_box/device/Device.css.ts",
        "setting_section/setting_box/advanced_settings/AdvancedSettings.css.ts"]) {
        assert.match(read(path), /var\(--settings_rule, \$\{vars\.vox_border\}\)/, path);
    }
    assert.match(read("setting_section/setting_box/advanced_settings/VoiceSettings.css.ts"), /var\(--settings_rule, var\(--vox_border, #34363b\)\)/);
});
