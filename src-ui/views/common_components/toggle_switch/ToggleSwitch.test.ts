import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { styleOf } from "../../../logics/test/styleSource.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("status text cannot narrow a toggle: the switch and its track keep their width", () => {
    assert.match(styleOf(read("./ToggleSwitch.css.ts"), "toggle_switch_container"), /flexShrink: 0,/);
    const mixins = read("../../common_css/mixins.ts");
    assert.match(mixins.slice(mixins.indexOf("export const toggleControl")), /\[self\]: \{[^}]*flexShrink: 0,/);
});

test("main function switches keep a gap between their label and the toggle", () => {
    const main = read("../../app/main_page/sidebar_section/main_function_switch/MainFunctionSwitch.css.ts");
    assert.match(styleOf(main, "switch_container"), /gap: "\.8rem",/);
});
