import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const variables: Record<string, string> = Object.fromEntries([...read("../_index_css/variables.css").matchAll(/(--[\w-]+):\s*([^;]+);/g)]
    .map(([, key, value]) => [key, value.trim()]));
const color = (token: string): string => {
    const value = variables[token] ?? token;
    const alias = /^var\((--[\w-]+)\)$/.exec(value);
    return alias ? color(alias[1]) : value;
};
// The two-digit channels of a #rrggbb colour; a colour without them stops the test, as reading
// channels from null did.
const channels = (value: string) => {
    const pairs = value.slice(1).match(/../g);
    assert.ok(pairs, value);
    return pairs;
};
const luminance = (token: string) => {
    const rgb = channels(color(token)).map(channel => parseInt(channel, 16) / 255)
        .map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
};
const contrast = (fg: string, bg: string) => {
    const values = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
    return (values[0] + .05) / (values[1] + .05);
};
const token = (css: string, pattern: RegExp) => { const match = css.match(pattern); assert.ok(match, String(pattern)); return match[1]; };
const bg = /background(?:-color)?:\s*var\((--[\w-]+)\)/;
const fg = /color:\s*var\((--[\w-]+)\)/;
// MainPage is in vanilla-extract: `backgroundColor: vars.vox_canvas` is `var(--vox_canvas)`.
const canvas = `--${token(read("MainPage.css.ts"), /backgroundColor:\s*vars\.(\w+)/)}`;
// These styles are in vanilla-extract: `vars.x` is `var(--x)`, and a state's rule `"&:hover": {` reads as `&:hover {`.
const tokens = (css: string) => css.replace(/\bvars\.(\w+)/g, "var(--$1)").replace(/backgroundColor:|background:/g, "background:").replace(/"&:(hover|active)": \{/g, "&:$1 {");
const top = tokens(read("main_section/top_bar/right_side_components/_buttons/OpenQuickSettingButton.css.ts"));
// The quick settings' rows are the kit's Toggle (D-27): its surface at rest and under the pointer.
const toggle = tokens(read("../../kit/Toggle.css.ts"));
const toggleBase = toggle.slice(toggle.indexOf("base: {"), toggle.indexOf("variants: {"));
const close = tokens(read("../others/modal_controller/ModalController.css.ts").split("export const close_button = style({")[1]);
const off = token(top.split("is_disabled}`]: {")[1].split("}")[0], fg);
const messages = tokens(read("main_section/message_container/log_box/message_container/MessageContainer.css.ts").split("export const category = style({")[1]);
const pairs = [
    ["top-bar off resting", off, token(toggleBase, bg)],
    ["top-bar off hover", off, token(toggleBase.split('"&:hover:not(:disabled)": {')[1], bg)],
    ["quick-dialog close resting", token(close, fg), token(close, bg)],
    ["quick-dialog close hover", token(close, fg), token(close.split("&:hover {")[1], bg)],
    ["quick-dialog close pressed", token(close, fg), token(close.split("&:active {")[1], bg)],
    ["received category", token(messages.split("received_message}`]: {")[1], fg), canvas],
    ["OCR category", token(messages.split("ocr_category}`]: {")[1], fg), canvas],
];
for (const [name, foreground, background] of pairs) {
    test(`${name}: actual CSS pair meets 4.5:1 for small text`, context => {
        const ratio = contrast(foreground, background);
        context.annotate(`${color(foreground)} on ${color(background)}: ${ratio.toFixed(3)}:1 (opaque sRGB)`);
        assert.ok(ratio >= 4.5, `${name}: ${ratio}`);
    });
}
