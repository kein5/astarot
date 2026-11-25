import assert from "node:assert/strict";
import { test } from "vitest";
import { draw, hooks, loadModule, findIn, nodesIn } from "../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../logics/test/hookHarness.ts";

// The kit's parts drawn with the code they run (kit.test.ts reads their sources and styles): what
// each gives the element it draws, and what it leaves to the caller. The style recipes stand in
// with the variants they are called with, so a test sees which look a part asks for.

const recipe = (name: string) => (variants: Record<string, unknown> = {}) =>
    [name, ...Object.entries(variants).map(([key, value]) => `${key}=${String(value)}`)].join(" ");
// A style module of the kit: each export is its class name, and the recipes say their variants.
const styleModule = (recipes: string[]) => new Proxy({}, {
    get: (_, key) => key === "__esModule" ? true : typeof key === "string" && recipes.includes(key) ? recipe(key) : key,
});

async function kit<M>(file: string, imports: Record<string, unknown> = {}) {
    const runtime = hooks();
    const module = await loadModule<M>(new URL(file, import.meta.url), runtime, imports);
    return { runtime, module };
}

test("a button is type=button unless it says otherwise, and asks for its tone and size", async () => {
    const { runtime, module } = await kit<typeof import("./Button.tsx")>("./Button.tsx", { "./Button.css.ts": styleModule(["button"]) });
    const plain = runtime.render(module.Button, { children: "Save", "aria-label": "Save the settings" });
    assert.equal(plain.type, "button");
    assert.deepEqual([plain.props.type, plain.props["data-slot"], plain.props.className, plain.props.children, plain.props["aria-label"]],
        ["button", "button", "button tone=undefined size=undefined", "Save", "Save the settings"]);
    const submit = runtime.render(module.Button, { type: "submit", tone: "primary", size: "compact", className: "own" });
    assert.deepEqual([submit.props.type, submit.props.className], ["submit", "button tone=primary size=compact own"]);
});

test("a switch is Radix's root with its thumb, named as shadcn/ui names them", async () => {
    const { runtime, module } = await kit<typeof import("./Switch.tsx")>("./Switch.tsx", {
        "@radix-ui/react-switch": { Root: "switch-root", Thumb: "switch-thumb" },
    });
    const drawn = runtime.render(module.Switch, { checked: true, id: "row", className: "own" });
    assert.deepEqual([drawn.type, drawn.props["data-slot"], drawn.props.className, drawn.props.checked, drawn.props.id],
        ["switch-root", "switch", "root own", true, "row"]);
    const thumb = findIn(drawn, node => node.type === "switch-thumb", "the thumb");
    assert.deepEqual([thumb.props["data-slot"], thumb.props.className], ["switch-thumb", "thumb"]);
});

test("a text field is text, marks a wrong value only when told, and asks for the mono look", async () => {
    const { runtime, module } = await kit<typeof import("./TextField.tsx")>("./TextField.tsx", { "./Field.css.ts": styleModule(["field"]) });
    const plain = runtime.render(module.TextField, { value: "127.0.0.1" });
    assert.equal(plain.type, "input");
    assert.deepEqual([plain.props.type, plain.props["data-slot"], plain.props["aria-invalid"], plain.props.className, plain.props.value],
        ["text", "input", undefined, "field kind=text mono=false", "127.0.0.1"]);
    const marked = runtime.render(module.TextField, { invalid: true, mono: true, type: "password", className: "own" });
    assert.deepEqual([marked.props.type, marked.props["aria-invalid"], marked.props.className],
        ["password", true, "field kind=text mono=true own"]);
});

test("a progress bar is the system's <progress>, with the amount it is given or none", async () => {
    const { runtime, module } = await kit<typeof import("./Progress.tsx")>("./Progress.tsx", { "./Progress.css.ts": styleModule([]) });
    const counted = runtime.render(module.Progress, { value: 3, max: 9, "aria-label": "Download progress", className: "own" });
    assert.equal(counted.type, "progress");
    assert.deepEqual([counted.props["data-slot"], counted.props.className, counted.props.value, counted.props.max, counted.props["aria-label"]],
        ["progress", "progress own", 3, 9, "Download progress"]);
    // Without a value the bar does not know how far it is: the element gets no value at all.
    const unknown = runtime.render(module.Progress, { "aria-label": "Download progress" });
    assert.deepEqual([unknown.props.className, "value" in unknown.props, "max" in unknown.props], ["progress", false, false]);
});

test("a select is the system's, in the field's look, with its own options and groups", async () => {
    const { runtime, module } = await kit<typeof import("./Select.tsx")>("./Select.tsx", { "./Field.css.ts": styleModule(["field"]) });
    const drawn = runtime.render(module.Select, { value: "a", children: "the options", className: "own" });
    assert.deepEqual([drawn.type, drawn.props["data-slot"], drawn.props.className], ["span", "native-select-wrapper", "selectWrap"]);
    const select = findIn(drawn, node => node.type === "select", "the select");
    assert.deepEqual([select.props["data-slot"], select.props["aria-invalid"], select.props.className, select.props.value, select.props.children],
        ["native-select", undefined, "field kind=select own", "a", "the options"]);
    const icon = findIn(drawn, node => node.type === "svg", "the chevron");
    assert.deepEqual([icon.props["data-slot"], icon.props["aria-hidden"]], ["native-select-icon", "true"]);
    const marked = findIn(runtime.render(module.Select, { invalid: true }), node => node.type === "select", "the select");
    assert.equal(marked.props["aria-invalid"], true);
    const option = runtime.render(module.SelectOption, { value: "en", children: "English" });
    assert.deepEqual([option.type, option.props["data-slot"], option.props.value, option.props.children],
        ["option", "native-select-option", "en", "English"]);
    const group = runtime.render(module.SelectOptGroup, { label: "Recent" });
    assert.deepEqual([group.type, group.props["data-slot"], group.props.label], ["optgroup", "native-select-optgroup", "Recent"]);
});

test("a settings group is named by its heading, an h3 unless it says otherwise", async () => {
    const { runtime, module } = await kit<typeof import("./Setting.tsx")>("./Setting.tsx", { "./Setting.css.ts": styleModule(["row"]) });
    const plain = runtime.render(module.SettingGroup, { title: "Audio", children: "rows" });
    const heading = findIn(plain, node => /^h\d$/.test(String(node.type)), "the heading");
    assert.deepEqual([heading.type, heading.props.children], ["h3", "Audio"]);
    assert.equal(plain.props["aria-labelledby"], heading.props.id);
    assert.ok(heading.props.id);
    assert.equal(nodesIn(plain).some(node => node.type === "p"), false, "no description, no paragraph");
    const described = runtime.render(module.SettingGroup, { title: "Audio", description: "What you hear", headingLevel: 2, children: "rows" });
    assert.equal(findIn(described, node => /^h\d$/.test(String(node.type)), "the heading").type, "h2");
    assert.equal(findIn(described, node => node.type === "p", "the description").props.children, "What you hear");
});

test("a settings row names its control by the label and describes it by the description", async () => {
    const { runtime, module } = await kit<typeof import("./Setting.tsx")>("./Setting.tsx", { "./Setting.css.ts": styleModule(["row"]) });
    const given: unknown[] = [];
    const control = (props: unknown) => { given.push(props); return "control"; };
    const plain = runtime.render(module.SettingRow, { label: "Port", children: control });
    const label = findIn(plain, node => node.type === "label", "the label");
    assert.deepEqual([plain.props.className, plain.props["data-changed"]], ["row layout=field", undefined]);
    assert.equal(nodesIn(plain).some(node => node.type === "p"), false, "no description, no paragraph");
    assert.deepEqual(given, [{ id: label.props.htmlFor, "aria-describedby": undefined }]);
    assert.ok(label.props.htmlFor);

    const described = runtime.render(module.SettingRow, { label: "Port", description: "1024 to 65535", layout: "inline", changed: true,
        children: control });
    const description: TreeNode = findIn(described, node => node.type === "p", "the description");
    const id = findIn(described, node => node.type === "label", "the label").props.htmlFor;
    assert.deepEqual([described.props.className, described.props["data-changed"]], ["row layout=inline", true]);
    assert.deepEqual([description.props.id, description.props.children], [`${id}-description`, "1024 to 65535"]);
    assert.deepEqual(given[1], { id, "aria-describedby": `${id}-description` });
});

test("a toggle is Radix's root with the kit's look; a group and its items are Radix's", async () => {
    const { runtime, module } = await kit<typeof import("./Toggle.tsx")>("./Toggle.tsx", {
        "@radix-ui/react-toggle": { Root: "toggle-root" },
        "@radix-ui/react-toggle-group": { Root: "toggle-group-root", Item: "toggle-group-item" },
        "./Toggle.css.ts": styleModule(["toggle"]),
    });
    const plain = runtime.render(module.Toggle, { pressed: true, children: "Mute", className: "own" });
    assert.deepEqual([plain.type, plain.props["data-slot"], plain.props.className, plain.props.pressed, plain.props.children],
        ["toggle-root", "toggle", "toggle tone=undefined size=undefined own", true, "Mute"]);
    const warning = runtime.render(module.Toggle, { tone: "warning", size: "compact" });
    assert.equal(warning.props.className, "toggle tone=warning size=compact");
    const group = runtime.render(module.ToggleGroup, { type: "single", value: "grid", className: "own", children: "items" });
    assert.deepEqual([group.type, group.props["data-slot"], group.props.className, group.props.type, group.props.value],
        ["toggle-group-root", "toggle-group", "group own", "single", "grid"]);
    const item = runtime.render(module.ToggleGroupItem, { value: "grid", children: "Grid" });
    assert.deepEqual([item.type, item.props["data-slot"], item.props.className, item.props.value], ["toggle-group-item", "toggle-group-item", "groupItem", "grid"]);
});

test("a popover's content is Radix's, 4px from its trigger, in a portal unless told otherwise", async () => {
    const { runtime, module } = await kit<typeof import("./Popover.tsx")>("./Popover.tsx", {
        "@radix-ui/react-popover": { Root: "popover-root", Trigger: "popover-trigger", Anchor: "popover-anchor", Portal: "popover-portal", Content: "popover-content" },
        "./Popover.css.ts": styleModule(["content"]),
    });
    const trigger = runtime.render(module.PopoverTrigger, { children: "Quick settings" });
    assert.deepEqual([trigger.type, trigger.props["data-slot"]], ["popover-trigger", "popover-trigger"]);
    const anchor = runtime.render(module.PopoverAnchor, {});
    assert.deepEqual([anchor.type, anchor.props["data-slot"]], ["popover-anchor", "popover-anchor"]);
    const root = runtime.render(module.Popover, { open: true, children: "parts" });
    assert.deepEqual([root.type, root.props.open], ["popover-root", true]);
    const portalled = runtime.render(module.PopoverContent, { children: "rows", className: "own" });
    assert.equal(portalled.type, "popover-portal");
    const panel = findIn(portalled, node => node.type === "popover-content", "the content");
    assert.deepEqual([panel.props["data-slot"], panel.props.className, panel.props.align, panel.props.sideOffset, panel.props.children],
        ["popover-content", "content inset=undefined own", "center", 4, "rows"]);
    const inline = runtime.render(module.PopoverContent, { portal: false, inset: "tight", align: "end", sideOffset: 0 });
    assert.deepEqual([inline.type, inline.props.className, inline.props.align, inline.props.sideOffset, inline.props.portal],
        ["popover-content", "content inset=tight", "end", 0, undefined]);
});

test("an item list is a <ul> of <li> rows that ask for their look, and say it as shadcn/ui's Item does", async () => {
    const { runtime, module } = await kit<typeof import("./Item.tsx")>("./Item.tsx", { "./Item.css.ts": styleModule(["group", "item"]) });
    const group = runtime.render(module.ItemGroup, { children: "rows", "aria-label": "Terms" });
    assert.deepEqual([group.type, group.props["data-slot"], group.props.className, group.props["aria-label"], group.props.children],
        ["ul", "item-group", "group variant=undefined size=undefined", "Terms", "rows"]);
    assert.equal(runtime.render(module.ItemGroup, { variant: "outline", size: "compact", className: "own" }).props.className,
        "group variant=outline size=compact own");
    const row = runtime.render(module.Item, { children: "row", "data-state": "own" });
    assert.deepEqual([row.type, row.props["data-slot"], row.props["data-variant"], row.props["data-size"], row.props.className, row.props["data-state"]],
        ["li", "item", "default", "default", "item variant=default size=default", "own"]);
    const card = runtime.render(module.Item, { variant: "attention", size: "compact", className: "own" });
    assert.deepEqual([card.props["data-variant"], card.props["data-size"], card.props.className],
        ["attention", "compact", "item variant=attention size=compact own"]);
    for (const [part, slot, className] of [["ItemContent", "item-content", "content"], ["ItemTitle", "item-title", "title"],
        ["ItemDescription", "item-description", "description"], ["ItemActions", "item-actions", "actions"]] as const) {
        const drawn = runtime.render(module[part], { children: "words", className: "own", role: "status" });
        assert.deepEqual([drawn.type, drawn.props["data-slot"], drawn.props.className, drawn.props.children, drawn.props.role],
            ["div", slot, `${className} own`, "words", "status"], part);
    }
});

test("an item's mark draws its state's shapes and is hidden from screen readers; without a state it holds its children", async () => {
    // The shapes' classes are a plain object of classes, each named as its key.
    const shapes = new Proxy({}, { get: (_, key) => key });
    const styles = new Proxy({}, { get: (_, key) => key === "__esModule" ? true : key === "markShape" ? shapes : key });
    const { runtime, module } = await kit<typeof import("./Item.tsx")>("./Item.tsx", { "./Item.css.ts": styles });
    const drawn = (state: import("./Item.tsx").ItemState) => {
        const media = runtime.render(module.ItemMedia, { state });
        assert.deepEqual([media.type, media.props["data-slot"], media.props["data-state"], media.props["aria-hidden"], media.props.className],
            ["div", "item-media", state, "true", "media"]);
        const mark = draw(findIn(media, node => typeof node.type === "function", "the mark"));
        assert.deepEqual([mark.type, mark.props.viewBox, mark.props.className], ["svg", "0 0 16 16", "mediaSvg"]);
        return nodesIn(mark).filter(node => node.type === "circle" || node.type === "path").map(node => `${String(node.type)} ${node.props.className}`);
    };
    // Ready: a lilac disc with a check; attention: an amber disc with "!"; checking: the spinning
    // arc; neutral: a quiet ring.
    assert.deepEqual(drawn("ready"), ["circle ready", "path glyph"]);
    assert.deepEqual(drawn("attention"), ["circle attention", "path glyph"]);
    assert.deepEqual(drawn("checking"), ["circle arc"]);
    assert.deepEqual(drawn("neutral"), ["circle ring"]);
    const icon = runtime.render(module.ItemMedia, { children: "icon" });
    assert.deepEqual([icon.props["data-state"], icon.props["aria-hidden"], icon.props.children], [undefined, undefined, "icon"]);
});

test("a card is a <div>, or an <li> in a list, asks for the active look when it is the one in use, and its parts keep their slots", async () => {
    const { runtime, module } = await kit<typeof import("./Card.tsx")>("./Card.tsx", { "./Card.css.ts": styleModule(["card"]) });
    const plain = runtime.render(module.Card, { children: "parts", role: "group", "aria-label": "Model" });
    assert.deepEqual([plain.type, plain.props["data-slot"], plain.props.className, plain.props.children, plain.props.role, plain.props["aria-label"]],
        ["div", "card", "card active=undefined", "parts", "group", "Model"]);
    assert.equal(runtime.render(module.Card, { as: "div" }).type, "div");
    // As an item of a list, and the one in use: the element gets neither prop as an attribute.
    const item = runtime.render(module.Card, { as: "li", active: true, className: "own", tabIndex: -1, id: "model", children: "parts" });
    assert.deepEqual([item.type, item.props["data-slot"], item.props.className, item.props.tabIndex, item.props.id, item.props.children],
        ["li", "card", "card active=true own", -1, "model", "parts"]);
    assert.deepEqual(["as", "active"].filter(key => key in item.props || key in plain.props), []);
    for (const [part, slot, look] of [["CardHeader", "card-header", "header"], ["CardTitle", "card-title", "title"],
        ["CardDescription", "card-description", "description"], ["CardContent", "card-content", "content"], ["CardFooter", "card-footer", "footer"]] as const) {
        const drawn = runtime.render(module[part], { className: "own", id: part, children: "words" });
        assert.deepEqual([drawn.type, drawn.props["data-slot"], drawn.props.className, drawn.props.id, drawn.props.children],
            ["div", slot, `${look} own`, part, "words"], part);
    }
});

test("a badge is a <span> with its words, asks for its look, and draws the warning's \"!\" hidden from assistive technology", async () => {
    const { runtime, module } = await kit<typeof import("./Badge.tsx")>("./Badge.tsx", { "./Badge.css.ts": styleModule(["badge"]) });
    const words = (node: TreeNode) => [node.props.children].flat().filter(child => child !== null);
    const plain = runtime.render(module.Badge, { children: "Built in", title: "the app's own" });
    assert.deepEqual([plain.type, plain.props["data-slot"], plain.props.className, words(plain), plain.props.title],
        ["span", "badge", "badge tone=undefined variant=undefined mark=undefined", ["Built in"], "the app's own"]);
    const state = runtime.render(module.Badge, { tone: "active", variant: "solid", mark: "check", className: "status", children: "In use" });
    assert.deepEqual([state.props.className, words(state)], ["badge tone=active variant=solid mark=check status", ["In use"]]);
    // The check and the ring are drawn by the badge's own look; only the "!" has an element.
    assert.equal(nodesIn(state).filter(node => node.type === "span").length, 1);
    const warning = runtime.render(module.Badge, { tone: "warning", mark: "alert", children: "May be too heavy" });
    const [mark, ...rest] = words(warning);
    assert.deepEqual([mark.type, mark.props.className, mark.props["aria-hidden"], mark.props.children, rest],
        ["span", "alertMark", "true", undefined, ["May be too heavy"]]);
});
