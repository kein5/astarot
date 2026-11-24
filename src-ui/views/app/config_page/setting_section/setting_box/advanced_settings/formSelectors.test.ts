import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { leavesKit } from "./formSelectors.ts";

// The settings forms draw their native controls with rules on the form's container; a kit part in
// a form keeps the kit's look, because those rules leave it out.
test("a form's rules for native controls leave out the kit's parts", () => {
    assert.equal(leavesKit("button"), 'button:not([data-slot="button"])');
    assert.equal(leavesKit("button.primary:hover:enabled"), 'button:not([data-slot="button"]).primary:hover:enabled');
    assert.equal(leavesKit("input"), 'input:not([data-slot="input"])');
    assert.equal(leavesKit('input[type="range"]::-webkit-slider-thumb'), 'input:not([data-slot="input"])[type="range"]::-webkit-slider-thumb');
    assert.equal(leavesKit("input::placeholder"), 'input:not([data-slot="input"])::placeholder');
    assert.equal(leavesKit("select"), 'select:not([data-slot="native-select"])');
    assert.equal(leavesKit("select::picker(select)"), 'select:not([data-slot="native-select"])::picker(select)');
    assert.equal(leavesKit("select option"), 'select:not([data-slot="native-select"]) option');
    // The kit's select draws its own options (Field.css.ts), so the form's rules for its open list leave them out.
    assert.equal(leavesKit("option"), 'option:not([data-slot="native-select-option"])');
    assert.equal(leavesKit("option:checked"), 'option:not([data-slot="native-select-option"]):checked');
    assert.equal(leavesKit("option:focus-visible"), 'option:not([data-slot="native-select-option"]):focus-visible');
    assert.equal(leavesKit("option::checkmark"), 'option:not([data-slot="native-select-option"])::checkmark');
    const kit = '[data-slot="button"], [data-slot="input"], [data-slot="native-select"], [data-slot="native-select-option"], [data-slot="native-select-optgroup"]';
    assert.equal(leavesKit(":focus-visible"), `:focus-visible:not(${kit})`);
    assert.equal(leavesKit(":disabled"), `:disabled:not(${kit})`);
});

test("other selectors, and words that only start like a control, are kept as they are", () => {
    for (const selector of ["textarea", "label", "dialog button", "optgroup", "options", "option-list", "summary", "selected", "input-group",
        "buttons", '[role="alert"]', ":focus-visible:hover"]) {
        assert.equal(leavesKit(selector), selector);
    }
    // A control's own state keeps the control's guard only.
    assert.equal(leavesKit("button:disabled"), 'button:not([data-slot="button"]):disabled');
});

test("every rule of the forms goes through it", () => {
    const css = readFileSync(new URL("./VoiceSettings.css.ts", import.meta.url), "utf8");
    assert.match(css, /import \{ leavesKit \} from "\.\/formSelectors\.ts";/);
    assert.match(css, /const inForm = \(\.\.\.selectors: string\[\]\) => selectors\.map\(selector => `\$\{container\} \$\{leavesKit\(selector\)\}`\)\.join\(", "\);/);
});
