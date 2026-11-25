import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { hooks, kitStandIns } from "./hookHarness.ts";
import type { TreeNode } from "./hookHarness.ts";

// The harness runs a render's effects as React does: the layout effects first, then the passive
// ones; for each kind the clean-ups first, then the effects, in the order the component calls
// them; and on unmount the layout effects' clean-ups first. Views rely on it, e.g. the VR language
// window's layout effect reads a change before a passive effect answers it.

test("a render runs its layout effects before its passive ones, each kind in order", () => {
    const runtime = hooks(), ran: string[] = [];
    const component = ({ step }: { step: number }) => {
        runtime.api.useEffect(() => { ran.push(`passive 1 (${step})`); return () => { ran.push(`passive 1 cleaned (${step})`); }; }, [step]);
        runtime.api.useLayoutEffect(() => { ran.push(`layout 1 (${step})`); return () => { ran.push(`layout 1 cleaned (${step})`); }; }, [step]);
        runtime.api.useEffect(() => { ran.push(`passive 2 (${step})`); }, []);
        runtime.api.useLayoutEffect(() => { ran.push(`layout 2 (${step})`); return () => { ran.push(`layout 2 cleaned (${step})`); }; }, [step]);
        return null;
    };
    runtime.render(component, { step: 1 });
    assert.deepEqual(ran, ["layout 1 (1)", "layout 2 (1)", "passive 1 (1)", "passive 2 (1)"]);
    ran.length = 0;
    // A change runs only the effects whose dependencies changed, each after its own clean-up.
    runtime.render(component, { step: 2 });
    assert.deepEqual(ran, ["layout 1 cleaned (1)", "layout 2 cleaned (1)", "layout 1 (2)", "layout 2 (2)",
        "passive 1 cleaned (1)", "passive 1 (2)"]);
    ran.length = 0;
    runtime.unmount();
    assert.deepEqual(ran, ["layout 1 cleaned (2)", "layout 2 cleaned (2)", "passive 1 cleaned (2)"]);
    // Cleaned up once: a second unmount has nothing left to clean.
    ran.length = 0;
    runtime.unmount();
    assert.deepEqual(ran, []);
});

// A screen's test reads the kit's Button through its stand-in (kitStandIns), so the stand-in draws
// what the kit's Button draws when a screen leaves a prop out: a <button type="button"> named
// data-slot="button", plain and regular.
test("the kit's stand-in keeps the kit's defaults", () => {
    const kit = (name: string) => readFileSync(new URL(`../../views/kit/${name}`, import.meta.url), "utf8");
    assert.match(kit("Button.css.ts"), /defaultVariants: \{ tone: "plain", size: "regular" \}/);
    assert.match(kit("Button.tsx"), /type = "button"/);
    assert.match(kit("Button.tsx"), /data-slot="button"/);
    const drawn = kitStandIns.Button({ className: "place", children: "words" });
    assert.equal(drawn.type, "button");
    assert.deepEqual(drawn.props, { type: "button", "data-slot": "button", "data-tone": "plain", "data-size": "regular",
        className: "place", children: "words" });
    const asked = kitStandIns.Button({ tone: "primary", size: "compact", type: "submit" });
    assert.deepEqual(asked.props, { type: "submit", "data-slot": "button", "data-tone": "primary", "data-size": "compact" });
    // The field: a text <input> named data-slot="input", aria-invalid only while the value is wrong.
    assert.match(kit("TextField.tsx"), /invalid = false, mono = false, className, type = "text"/);
    assert.match(kit("TextField.tsx"), /data-slot="input"\s*aria-invalid=\{invalid \|\| undefined\}/);
    const field = kitStandIns.TextField({ value: "words" });
    assert.equal(field.type, "input");
    assert.deepEqual(field.props, { type: "text", "data-slot": "input", "aria-invalid": undefined, "data-mono": false, value: "words" });
    assert.deepEqual(kitStandIns.TextField({ invalid: true, mono: true, type: "number" }).props,
        { type: "number", "data-slot": "input", "aria-invalid": true, "data-mono": true });
    // The switch: Radix's root, named data-slot="switch", off unless checked.
    assert.match(kit("Switch.tsx"), /<RadixSwitch\.Root data-slot="switch"/);
    const off = kitStandIns.Switch({ id: "mic" });
    assert.equal(off.type, "button");
    assert.deepEqual(off.props, { type: "button", role: "switch", "aria-checked": false, "data-state": "unchecked", "data-slot": "switch", id: "mic" });
    assert.deepEqual(kitStandIns.Switch({ checked: true }).props, { type: "button", role: "switch", "aria-checked": true, "data-state": "checked", "data-slot": "switch" });
    // The toggle: Radix's <button>, off unless pressed, the accent tone and the regular size by default.
    assert.match(kit("Toggle.css.ts"), /defaultVariants: \{ tone: "accent", size: "regular" \}/);
    assert.deepEqual(kitStandIns.Toggle({}).props, { type: "button", "aria-pressed": false, "data-state": "off", "data-slot": "toggle",
        "data-tone": "accent", "data-size": "regular" });
    assert.deepEqual(kitStandIns.Toggle({ pressed: true, tone: "warning" }).props, { type: "button", "aria-pressed": true, "data-state": "on",
        "data-slot": "toggle", "data-tone": "warning", "data-size": "regular" });
    assert.deepEqual(kitStandIns.ToggleGroup({}).props, { role: "group", "data-slot": "toggle-group" });
    assert.deepEqual(kitStandIns.ToggleGroupItem({ value: "a" }).props, { type: "button", "data-slot": "toggle-group-item", value: "a" });
    // The popover: the root draws its parts; the content keeps what it is given, without the kit's own props.
    assert.equal(kitStandIns.Popover({ children: "parts" }), "parts");
    assert.deepEqual(kitStandIns.PopoverContent({ portal: false, inset: "tight", id: "panel" }).props, { "data-slot": "popover-content", id: "panel" });
    // The progress bar: the system's <progress> named data-slot="progress", with what it is given and nothing more.
    assert.match(kit("Progress.tsx"), /<progress data-slot="progress" className=\{clsx\(progress, className\)\} \{\.\.\.rest\} \/>/);
    const bar = kitStandIns.Progress({ value: 3, max: 9, "aria-label": "words" });
    assert.equal(bar.type, "progress");
    assert.deepEqual(bar.props, { "data-slot": "progress", value: 3, max: 9, "aria-label": "words" });
    assert.deepEqual(kitStandIns.Progress({}).props, { "data-slot": "progress" });
    // The Item list: a <ul> of <li> rows, default and default-sized unless asked; a mark for a
    // state is hidden from screen readers.
    assert.match(kit("Item.css.ts"), /defaultVariants: \{ variant: "default", size: "default" \}/);
    assert.match(kit("Item.tsx"), /<ul data-slot="item-group"/);
    assert.match(kit("Item.tsx"), /<li data-slot="item" data-variant=\{variant\} data-size=\{size\}/);
    assert.match(kit("Item.tsx"), /data-slot="item-media" data-state=\{state\} aria-hidden=\{state \? "true" : undefined\}/);
    const group = kitStandIns.ItemGroup({ children: "rows" });
    assert.equal(group.type, "ul");
    assert.deepEqual(group.props, { "data-slot": "item-group", "data-variant": "default", "data-size": "default", children: "rows" });
    assert.deepEqual(kitStandIns.ItemGroup({ variant: "outline", size: "compact" }).props,
        { "data-slot": "item-group", "data-variant": "outline", "data-size": "compact" });
    const row = kitStandIns.Item({ "data-state": "own" });
    assert.equal(row.type, "li");
    assert.deepEqual(row.props, { "data-slot": "item", "data-variant": "default", "data-size": "default", "data-state": "own" });
    assert.deepEqual(kitStandIns.Item({ variant: "attention", size: "compact" }).props, { "data-slot": "item", "data-variant": "attention", "data-size": "compact" });
    assert.deepEqual(kitStandIns.ItemMedia({ state: "ready" }).props, { "data-slot": "item-media", "data-state": "ready", "aria-hidden": "true" });
    assert.deepEqual(kitStandIns.ItemMedia({ children: "icon" }).props, { "data-slot": "item-media", "data-state": undefined, "aria-hidden": undefined, children: "icon" });
    for (const [part, slot] of [["ItemContent", "item-content"], ["ItemTitle", "item-title"], ["ItemDescription", "item-description"], ["ItemActions", "item-actions"]] as const) {
        assert.match(kit("Item.tsx"), new RegExp(`<div data-slot="${slot}"`), part);
        const drawn = kitStandIns[part]({ className: "place" });
        assert.deepEqual([drawn.type, drawn.props], ["div", { "data-slot": slot, className: "place" }], part);
    }
    // The select: a native <select> named data-slot="native-select", aria-invalid only while the
    // value is wrong; its options and groups are plain <option> and <optgroup> that name themselves.
    assert.match(kit("Select.tsx"), /\{ invalid = false, className, children, \.\.\.rest \}/);
    assert.match(kit("Select.tsx"), /<select\s+data-slot="native-select"\s+aria-invalid=\{invalid \|\| undefined\}/);
    assert.match(kit("Select.tsx"), /<option data-slot="native-select-option" \{\.\.\.props\} \/>/);
    assert.match(kit("Select.tsx"), /<optgroup data-slot="native-select-optgroup" \{\.\.\.props\} \/>/);
    const select = kitStandIns.Select({ value: "b", children: "choices" });
    assert.equal(select.type, "select");
    assert.deepEqual(select.props, { "data-slot": "native-select", "aria-invalid": undefined, value: "b", children: "choices" });
    assert.deepEqual(kitStandIns.Select({ invalid: true }).props, { "data-slot": "native-select", "aria-invalid": true });
    const option = kitStandIns.SelectOption({ value: "b", children: "Banana" });
    assert.equal(option.type, "option");
    assert.deepEqual(option.props, { "data-slot": "native-select-option", value: "b", children: "Banana" });
    const optGroup = kitStandIns.SelectOptGroup({ label: "Fruit" });
    assert.equal(optGroup.type, "optgroup");
    assert.deepEqual(optGroup.props, { "data-slot": "native-select-optgroup", label: "Fruit" });
    // The card: a <div> named data-slot="card" unless it is an <li>, not the one in use unless told; its parts are <div>s.
    assert.match(kit("Card.css.ts"), /defaultVariants: \{ active: false \}/);
    assert.match(kit("Card.tsx"), /<div data-slot="card" /);
    assert.match(kit("Card.tsx"), /<li data-slot="card" /);
    const card = kitStandIns.Card({ children: "parts" });
    assert.equal(card.type, "div");
    assert.deepEqual(card.props, { "data-slot": "card", "data-active": false, children: "parts" });
    const item = kitStandIns.Card({ as: "li", active: true, role: "group" });
    assert.equal(item.type, "li");
    assert.deepEqual(item.props, { "data-slot": "card", "data-active": true, role: "group" });
    for (const [part, slot] of [["CardHeader", "card-header"], ["CardTitle", "card-title"], ["CardDescription", "card-description"],
        ["CardContent", "card-content"], ["CardFooter", "card-footer"]] as const) {
        assert.match(kit("Card.tsx"), new RegExp(`<div data-slot="${slot}"`), part);
        const drawnPart = kitStandIns[part]({ className: "place" });
        assert.deepEqual([drawnPart.type, drawnPart.props], ["div", { "data-slot": slot, className: "place" }], part);
    }
    // The badge: a <span> named data-slot="badge", a neutral outline with no mark unless it asks.
    assert.match(kit("Badge.css.ts"), /defaultVariants: \{ tone: "neutral", variant: "outline" \}/);
    assert.match(kit("Badge.tsx"), /<span data-slot="badge"/);
    const badge = kitStandIns.Badge({ children: "Built in" });
    assert.equal(badge.type, "span");
    assert.deepEqual(badge.props, { "data-slot": "badge", "data-tone": "neutral", "data-variant": "outline", "data-mark": undefined, children: "Built in" });
    assert.deepEqual(kitStandIns.Badge({ tone: "active", variant: "solid", mark: "check" }).props,
        { "data-slot": "badge", "data-tone": "active", "data-variant": "solid", "data-mark": "check" });
    // The confirmation inside a row: the root draws what it holds; the trigger is a Button in the
    // look it is given; the content a group; the way back plain and focused; the removal danger.
    const confirm = kit("InlineConfirm.tsx");
    assert.match(confirm, /return <InlineConfirmContext\.Provider value=\{value\}>\{children\}<\/InlineConfirmContext\.Provider>;/);
    assert.equal(kitStandIns.InlineConfirm({ children: "actions" }), "actions");
    assert.match(confirm, /return <Button ref=\{attach\} \{\.\.\.rest\} \/>;/);
    assert.deepEqual(kitStandIns.InlineConfirmTrigger({ tone: "danger", children: "Remove" }).props,
        { type: "button", "data-slot": "button", "data-tone": "danger", "data-size": "regular", children: "Remove" });
    assert.match(confirm, /<div role="group" data-slot="inline-confirm-content"/);
    const confirmGroup = kitStandIns.InlineConfirmContent({ "aria-label": "Remove a" });
    assert.deepEqual([confirmGroup.type, confirmGroup.props], ["div", { role: "group", "data-slot": "inline-confirm-content", "aria-label": "Remove a" }]);
    assert.match(confirm, /<p data-slot="inline-confirm-description"/);
    const sentence = kitStandIns.InlineConfirmDescription({ children: "words" });
    assert.deepEqual([sentence.type, sentence.props], ["p", { "data-slot": "inline-confirm-description", children: "words" }]);
    assert.match(confirm, /return <Button autoFocus onClick=/);
    assert.deepEqual(kitStandIns.InlineConfirmCancel({ children: "Back" }).props,
        { type: "button", autoFocus: true, "data-slot": "button", "data-tone": "plain", "data-size": "regular", children: "Back" });
    assert.match(confirm, /<Button tone="danger" \{\.\.\.props\} \/>/);
    assert.deepEqual(kitStandIns.InlineConfirmAction({ disabled: true, children: "Remove" }).props,
        { type: "button", "data-slot": "button", "data-tone": "danger", "data-size": "regular", disabled: true, children: "Remove" });
    // The textarea: a <textarea> named data-slot="textarea", aria-invalid only while the value is wrong, a form's field unless it fills.
    assert.match(kit("Textarea.tsx"), /invalid = false, mono = false, fill = false, inFrame = false, className/);
    assert.match(kit("Textarea.tsx"), /data-slot="textarea"\s*aria-invalid=\{invalid \|\| undefined\}/);
    const lines = kitStandIns.Textarea({ value: "words" });
    assert.equal(lines.type, "textarea");
    assert.deepEqual(lines.props, { "data-slot": "textarea", "aria-invalid": undefined, "data-mono": false, "data-fill": false, "data-in-frame": false,
        value: "words" });
    assert.deepEqual(kitStandIns.Textarea({ invalid: true, mono: true, fill: true, inFrame: true }).props,
        { "data-slot": "textarea", "aria-invalid": true, "data-mono": true, "data-fill": true, "data-in-frame": true });
    // The choice card: a label round a radio that stays a radio, the card's contents, then the name.
    assert.match(kit("ChoiceCard.tsx"), /<label data-slot="field-label"[\s\S]*\{\.\.\.input\} type="radio" \/>\s*\{children\}\s*<span data-slot="field-title"/);
    const choice: TreeNode = kitStandIns.ChoiceCard({ name: "theme", value: "forest", checked: true, title: "Forest", className: "place", children: "picture" });
    assert.deepEqual([choice.type, choice.props["data-slot"], choice.props.className], ["label", "field-label", "place"]);
    const [radio, picture, name] = choice.props.children;
    assert.deepEqual([radio.type, radio.props], ["input", { "data-slot": "radio-group-item", name: "theme", value: "forest", checked: true, type: "radio" }]);
    assert.equal(picture, "picture");
    assert.deepEqual([name.type, name.props], ["span", { "data-slot": "field-title", children: "Forest" }]);
});
