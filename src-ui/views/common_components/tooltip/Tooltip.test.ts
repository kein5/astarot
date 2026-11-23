import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { hooks, loadModule, find } from "../../../logics/test/hookHarness.ts";
import * as placement from "./tooltipPlacement.ts";
import type { TooltipProps } from "./Tooltip.tsx";
import { styleOf } from "../../../logics/test/styleSource.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
// The declarations a rule writes itself, before any nested rule.
const ownDeclarations = (source: string, selector: string) => {
    const at = source.indexOf(`${selector} {`);
    assert.ok(at >= 0, selector);
    const open = source.indexOf("{", at);
    return source.slice(open + 1, open + 1 + source.slice(open + 1).search(/[{}]/));
};

const mixins = read("../../common_css/mixins.scss");
// The same look for vanilla-extract styles (#957): the tooltipContent object of mixins.ts.
const mixinsTs = read("../../common_css/mixins.ts");
const bubbles = [
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
    // mixins.ts gives the same declarations to the styles moved to vanilla-extract.
    const ts = mixinsTs.slice(mixinsTs.indexOf("export const tooltipContent"));
    assert.match(ts, /width: "max-content",\s*maxWidth: "min\(36rem, 90cqi\)",\s*padding: "\.6rem 1\.2rem",\s*borderRadius: "var\(--vox_radius, \.8rem\)",/);
    assert.match(ts, /backgroundColor: "var\(--dark_700_color\)",\s*color: "var\(--dark_basic_text_color\)",\s*fontSize: "1\.2rem",/);
    assert.match(ts, /whiteSpace: "pre-line",/);
});

test("the common tooltip and the settings' Hint draw the same bubble, and only it", () => {
    for (const [name, source, selector] of bubbles) {
        assert.match(source, /^@import "@scss_mixins";/, name);
        const own = ownDeclarations(source, selector);
        assert.match(own, /@include tooltip_content;/, name);
        // Nothing of the look is written over it.
        assert.doesNotMatch(own, /\b(padding|border-radius|background-color|font-size|font-weight|line-height|white-space)\s*:/, name);
    }
    // The common tooltip, in vanilla-extract: its bubble spreads the same look and writes none over it.
    const box = styleOf(read("./Tooltip.css.ts"), "tooltipBox");
    assert.match(box, /\.\.\.tooltipContent,/);
    assert.doesNotMatch(box, /\b(padding|borderRadius|backgroundColor|fontSize|fontWeight|lineHeight|whiteSpace)\s*:/);
    // The resend button's words take the bubble's size and colour, not their own.
    const resend = "../../app/main_page/main_section/message_container/log_box/message_container/message_sub_menu_container/";
    assert.doesNotMatch(read(resend + "MessageSubMenuContainer.css.ts"), /tooltip_title/);
});

// The tooltip drawn without a page: its bubble stays in the tree where the test can read it.
async function tooltip(props: TooltipProps) {
    const runtime = hooks();
    const { Tooltip } = await loadModule<typeof import("./Tooltip.tsx")>(new URL("./Tooltip.tsx", import.meta.url), runtime, {
        "react-dom": { createPortal: (node: unknown) => node }, "./tooltipPlacement.ts": placement,
    });
    const draw = () => runtime.render(Tooltip, props);
    const content = () => find(draw(), node => node.props?.["data-slot"] === "tooltip-content");
    return { runtime, draw, content };
}

test("the tooltip's parts carry shadcn/ui's data-slot", async () => {
    const { runtime, draw, content } = await tooltip({ title: "words", children: "button" });
    const trigger = draw();
    assert.equal(trigger.props["data-slot"], "tooltip-trigger");
    assert.equal(content(), null, "closed at first");
    trigger.props.onMouseEnter();
    const bubble = content();
    assert.ok(bubble);
    assert.equal(bubble.props.children, "words");
    runtime.unmount();
    // The settings' Hint: its bubble is the content.
    assert.match(read("../../app/config_page/setting_section/setting_box/_components/hint/Hint.tsx"), /role="tooltip" aria-hidden="true" data-slot="tooltip-content"/);
});

test("the tooltip opens on the pointer and on keyboard focus, and a press or an acting key puts it away", async () => {
    const { draw, content } = await tooltip({ title: "words", children: "button" });
    // Keyboard focus opens it; losing the focus closes it.
    draw().props.onFocus({ target: {} });
    const bubble = content();
    assert.ok(bubble);
    // The bubble is a picture of words the control carries already: it is never read by itself.
    assert.equal(bubble.props.role, "tooltip");
    assert.equal(bubble.props["aria-hidden"], "true");
    draw().props.onBlur();
    assert.equal(content(), null);
    // The pointer opens it; a press closes it, so it does not cover what the control opens.
    draw().props.onMouseEnter();
    assert.ok(content());
    draw().props.onPointerDown();
    assert.equal(content(), null);
    // Escape, Enter and Space close it for the keyboard; other keys leave it.
    for (const [key, stays] of [["Tab", true], ["Escape", false], ["Enter", false], [" ", false]] satisfies [string, boolean][]) {
        draw().props.onFocus({ target: {} });
        draw().props.onKeyDown({ key });
        assert.equal(content() !== null, stays, key);
        draw().props.onBlur();
    }
});

test("without words the tooltip draws its control alone; a bare wrapper makes no box", async () => {
    const none = await tooltip({ title: undefined, children: "button" });
    assert.equal(none.draw().props["data-slot"], undefined, "no trigger, no handlers");
    assert.equal(none.draw().props.children, "button");
    const bare = await tooltip({ title: "words", children: "button", bare: true });
    assert.match(bare.draw().props.className, /\bbare\b/);
    assert.match(styleOf(read("./Tooltip.css.ts"), "bare"), /display: "contents",/);
    // The bubble is placed in the window, so nothing that scrolls or clips its control cuts it.
    assert.match(styleOf(read("./Tooltip.css.ts"), "tooltipBox"), /position: "fixed",/);
});

const box = (left: number, top: number, width: number, height: number) => ({ left, top, width, height });
const window1200 = { width: 1200, height: 800 };

test("the bubble opens on the wanted side, moves to another when it does not fit, and stays in the window", () => {
    const bubble = { width: 200, height: 40 };
    // Above a control in the middle: centred on it, a gap away.
    assert.deepEqual(placement.placeTooltip(box(500, 300, 100, 30), bubble, window1200, "top", 8, 8), { side: "top", left: 450, top: 252 });
    // A control in the top bar has no room above: the bubble goes below.
    assert.deepEqual(placement.placeTooltip(box(500, 10, 100, 30), bubble, window1200, "top", 8, 8), { side: "bottom", left: 450, top: 48 });
    // Beside a switch of the rail, level with its middle.
    assert.deepEqual(placement.placeTooltip(box(10, 100, 220, 40), bubble, window1200, "right", 8, 8), { side: "right", left: 238, top: 100 });
    // The window's corner (the close button): below, and held inside the right edge.
    assert.deepEqual(placement.placeTooltip(box(1160, 0, 40, 30), bubble, window1200, "bottom", 8, 8), { side: "bottom", left: 992, top: 38 });
    // No room beside a control that spans the window: the bubble goes below it.
    assert.equal(placement.placeTooltip(box(0, 100, 1200, 40), bubble, window1200, "right", 8, 8).side, "bottom");
    // A bubble wider than the window keeps its left edge in sight.
    assert.equal(placement.placeTooltip(box(100, 300, 50, 30), { width: 400, height: 40 }, { width: 300, height: 800 }, "top", 8, 8).left, 8);
});

// A control as the words are looked for in it: elements with a text, a size and a parent.
interface Part { text?: string; size?: [number, number]; parts?: Part[] }
function control(part: Part, parent: placement.WordsHolder | null = null): placement.WordsHolder {
    const [width, height] = part.size ?? [80, 20];
    const children: placement.WordsHolder[] = [];
    const node: placement.WordsHolder = {
        get textContent() { return part.text ?? children.map(child => child.textContent).join(""); },
        get childElementCount() { return children.length; },
        parentElement: parent,
        getBoundingClientRect: () => ({ width, height }),
        querySelectorAll: () => children.flatMap(child => [child, ...child.querySelectorAll("*")]),
    };
    children.push(...(part.parts ?? []).map(child => control(child, node)));
    return node;
}

test("a tooltip does not repeat words its control shows, and comes back where they are hidden", () => {
    // The quick settings button in a wide bar: its label is on screen.
    const wide = control({ parts: [{ parts: [{ text: "Quick settings" }, { text: "All off" }] }] });
    assert.equal(placement.wordsInSight(wide, "Quick settings"), true);
    assert.equal(placement.wordsInSight(wide, "Quick  settings "), true, "spaces do not make other words");
    assert.equal(placement.wordsInSight(wide, "Show where your voice goes"), false, "other words are a tooltip");
    // A narrow bar clips the label's holder to a dot for screen readers: the tooltip is back.
    const narrow = control({ parts: [{ size: [1, 1], parts: [{ text: "Quick settings" }, { text: "All off" }] }] });
    assert.equal(placement.wordsInSight(narrow, "Quick settings"), false);
    // An icon-only control and an empty tooltip have nothing to repeat.
    assert.equal(placement.wordsInSight(control({ parts: [{ size: [20, 20] }] }), "Open settings"), false);
    assert.equal(placement.wordsInSight(wide, ""), false);
    // The control's own text counts when it holds no elements.
    assert.equal(placement.wordsInSight(control({ text: "Close" }), "Close"), true);
});
