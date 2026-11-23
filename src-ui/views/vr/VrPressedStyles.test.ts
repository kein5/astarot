import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";
import { styleOf } from "../../logics/test/styleSource.ts";

// An enabled VR control turns Lilac the moment it is pressed, and pressing moves nothing: its
// pressed rule sets the fill, the words' colour and no transition, and only those. A control that
// cannot be used keeps its look. Each rule is read in its .css.ts, from the pressed selector on.
const ENABLED = ':not(:disabled):not([aria-disabled="true"])';
// A placeholder of a template literal as the source writes it (`${name}`).
const placeholder = (name: string) => "$" + `{${name}}`;

const declarationsFrom = (source: string, anchor: string) => {
    const at = source.indexOf(anchor);
    assert.ok(at >= 0, `Missing pressed rule: ${anchor}`);
    const open = source.indexOf("{", at + anchor.length - 1);
    return source.slice(open + 1, source.indexOf("}", open));
};

for (const [file, check] of [
    // The buttons and the rows that are buttons, in one rule for both.
    ["VrSettingsWindow.css.ts", (source: string) => {
        assert.match(source, /const pressable = [^\n]*\[clickable, button\]\.map/);
        return declarationsFrom(source, `globalStyle(pressable('&:active${ENABLED}'), {`);
    }],
    ["VrWindow.css.ts", (source: string) => declarationsFrom(styleOf(source, "close_button"), `'&:active${ENABLED}': {`)],
    ["VrLanguageWindow.css.ts", (source: string) => {
        assert.ok(source.includes(`const enabled = '${ENABLED}';`));
        const window = placeholder("language_window"), enabled = placeholder("enabled");
        return declarationsFrom(source, `globalStyle(\`${window} button:active${enabled}, ${window} summary:active${enabled}\`, {`);
    }],
] satisfies [string, (source: string) => string][]) {
    test(`${file} gives enabled VR controls immediate, layout-preserving pressed colour`, async () => {
        const body = check(await readFile(new URL(file, import.meta.url), "utf8"));
        assert.match(body, /backgroundColor: vars\.primary_600_color,/);
        assert.match(body, /transition: "none",/);
        // Text on the Lilac fill is Dark Plum (DESIGN.md); colour does not move the layout.
        assert.match(body, /(^|\s)color: vars\.vox_on_primary,/);
        const properties = [...body.matchAll(/(\w+):/g)].map(([, property]) => property);
        assert.deepEqual(properties.sort(), ["backgroundColor", "color", "transition"]);
    });
}

test("launcher and toolbar buttons use the shared pressed style", async () => {
    for (const file of ["VrLauncher.tsx", "VrToolbar.tsx"]) {
        const source = await readFile(new URL(file, import.meta.url), "utf8");
        assert.match(source, /import \* as shared from "\.\/VrSettingsWindow\.css\.ts"/);
        assert.match(source, /shared\.button/);
    }
});
