import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { hooks, loadModule, find } from "../../../logics/test/hookHarness.js";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
// The declarations a rule writes itself, before any nested rule.
const ownDeclarations = (source, selector) => {
    const at = source.indexOf(`${selector} {`);
    assert.ok(at >= 0, selector);
    const open = source.indexOf("{", at);
    return source.slice(open + 1, open + 1 + source.slice(open + 1).search(/[{}]/));
};

const mixins = read("../../common_css/mixins.scss");
const bubbles = [
    ["common_components/tooltip", read("./Tooltip.module.scss"), ".tooltipBox"],
    ["the settings' Hint", read("../../app/config_page/setting_section/setting_box/_components/hint/Hint.module.scss"), ".tip"],
];

// docs/design/components/shadcn-alignment.md, item 10: shadcn/ui's TooltipContent (rounded-md,
// px-3 py-1.5, text-xs) is the app's one tooltip look.
test("the tooltip look is shadcn/ui's TooltipContent, read by DESIGN.md's rules", () => {
    const look = ownDeclarations(mixins, "@mixin tooltip_content");
    assert.match(look, /padding: \.6rem 1\.2rem;/);
    assert.match(look, /border-radius: var\(--vox_radius, \.8rem\);/);
    assert.match(look, /font-size: 1\.2rem;/);
    // As wide as its words up to a reading measure, keeping the text's line breaks.
    assert.match(look, /width: max-content;\s*max-width: min\(36rem, 90cqi\);/);
    assert.match(look, /white-space: pre-line;/);
    // The colours are unchanged until D-22 (whether they are inverted) is decided.
    assert.match(look, /background-color: var\(--dark_700_color\);\s*color: var\(--dark_basic_text_color\);/);
});

test("the common tooltip and the settings' Hint draw the same bubble, and only it", () => {
    for (const [name, source, selector] of bubbles) {
        assert.match(source, /^@import "@scss_mixins";/, name);
        const own = ownDeclarations(source, selector);
        assert.match(own, /@include tooltip_content;/, name);
        // Nothing of the look is written over it.
        assert.doesNotMatch(own, /\b(padding|border-radius|background-color|font-size|font-weight|line-height|white-space)\s*:/, name);
    }
    // The resend button's words take the bubble's size and colour, not their own.
    const resend = "../../app/main_page/main_section/message_container/log_box/message_container/message_sub_menu_container/";
    assert.doesNotMatch(read(resend + "MessageSubMenuContainer.module.scss"), /\.tooltip_title/);
});

test("the tooltip's parts carry shadcn/ui's data-slot", async () => {
    const runtime = hooks();
    const { Tooltip } = await loadModule(new URL("./Tooltip.tsx", import.meta.url), runtime);
    const props = { title: "words", children: "button" };
    const trigger = runtime.render(Tooltip, props);
    assert.equal(trigger.props["data-slot"], "tooltip-trigger");
    assert.equal(find(trigger, node => node.props?.["data-slot"] === "tooltip-content"), null, "closed at first");
    trigger.props.onMouseEnter();
    const content = find(runtime.render(Tooltip, props), node => node.props?.["data-slot"] === "tooltip-content");
    assert.equal(content.props.children, "words");
    runtime.unmount();
    // The settings' Hint: its bubble is the content.
    assert.match(read("../../app/config_page/setting_section/setting_box/_components/hint/Hint.tsx"), /role="tooltip" aria-hidden="true" data-slot="tooltip-content"/);
});
