import assert from "node:assert/strict";
import { test } from "vitest";
import type { Ref } from "react";
import { draw, hooks, loadModule, findIn, nodesIn, setRef, unchecked } from "../../logics/test/hookHarness.ts";
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
    const square = runtime.render(module.Button, { size: "icon-xs", "aria-label": "Open the translator list" });
    assert.deepEqual([square.props.type, square.props.className, square.props["aria-label"]],
        ["button", "button tone=undefined size=icon-xs", "Open the translator list"]);
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

test("a textarea is the text field's look in several lines, a form's field unless it fills its screen", async () => {
    const { runtime, module } = await kit<typeof import("./Textarea.tsx")>("./Textarea.tsx", { "./Field.css.ts": styleModule(["field"]) });
    const plain = runtime.render(module.Textarea, { value: "Speak slowly", rows: 3 });
    assert.equal(plain.type, "textarea");
    assert.deepEqual([plain.props["data-slot"], plain.props["aria-invalid"], plain.props.className, plain.props.value, plain.props.rows],
        ["textarea", undefined, "field kind=textarea mono=false fill=false inFrame=false", "Speak slowly", 3]);
    const marked = runtime.render(module.Textarea, { invalid: true, mono: true, fill: true, className: "own" });
    assert.deepEqual([marked.props["aria-invalid"], marked.props.className], [true, "field kind=textarea mono=true fill=true inFrame=false own"]);
    assert.equal("fill" in marked.props || "invalid" in marked.props || "mono" in marked.props, false, "the element gets no prop of the kit's own");
    // Inside its screen's frame (the main window's composer).
    const framed = runtime.render(module.Textarea, { inFrame: true, fill: true });
    assert.deepEqual([framed.props.className, "inFrame" in framed.props], ["field kind=textarea mono=false fill=true inFrame=true", false]);
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

// The popover as the kit draws it: Radix's parts by name, the kit's motion (motion.ts) with its
// presence as it is and its animations recorded, and the root's open state as the content reads it.
async function popover(open: { current: boolean | null }) {
    const runtime = hooks(), played: string[] = [];
    const radix = { Root: "popover-root", Trigger: "popover-trigger", Anchor: "popover-anchor", Portal: "popover-portal", Content: "popover-content" };
    const motion = await loadModule<typeof import("./motion.ts")>(new URL("./motion.ts", import.meta.url), runtime, { "motion/mini": { animate: () => ({}) } });
    const exits: (() => void)[] = [];
    const stand = {
        ...motion,
        appear: (element: { name: string }, surface: string, side: string) => {
            played.push(`appear ${element.name} ${surface} ${side}`);
            return { finish: () => {}, stop: () => {}, finished: Promise.resolve() };
        },
        disappear: (element: { name: string }, surface: string, side: string) => {
            played.push(`disappear ${element.name} ${surface} ${side}`);
            return { finish: () => {}, stop: () => { played.push(`stop ${element.name}`); },
                finished: new Promise<void>(resolve => { exits.push(resolve); }) };
        },
    };
    const module = await loadModule<typeof import("./Popover.tsx")>(new URL("./Popover.tsx", import.meta.url), runtime, {
        "@radix-ui/react-popover": radix,
        "./Popover.css.ts": styleModule(["content"]),
        "./motion.ts": stand,
        react: { ...runtime.api, useContext: () => open.current },
    });
    return { runtime, module, played, exits };
}

// A panel as Radix draws it: where it placed it (data-side), and a name for the test.
const panelElement = (name: string, side: string | null = null) => ({ name, getAttribute: (attribute: string) => attribute === "data-side" ? side : null });

test("a popover's content is Radix's, 4px from its trigger, in a portal unless told otherwise", async () => {
    const { runtime, module } = await popover({ current: true });
    const trigger = runtime.render(module.PopoverTrigger, { children: "Quick settings" });
    assert.deepEqual([trigger.type, trigger.props["data-slot"]], ["popover-trigger", "popover-trigger"]);
    const anchor = runtime.render(module.PopoverAnchor, {});
    assert.deepEqual([anchor.type, anchor.props["data-slot"]], ["popover-anchor", "popover-anchor"]);
    const portalled = runtime.render(module.PopoverContent, { children: "rows", className: "own" });
    assert.ok(portalled, "drawn while open");
    assert.equal(portalled.type, "popover-portal");
    const panel = findIn(portalled, node => node.type === "popover-content", "the content");
    assert.deepEqual([panel.props["data-slot"], panel.props.className, panel.props.align, panel.props.sideOffset, panel.props.children],
        ["popover-content", "content inset=undefined own", "center", 4, "rows"]);
    const inline = findIn(runtime.render(module.PopoverContent, { portal: false, inset: "tight", align: "end", sideOffset: 0 }),
        node => node.type === "popover-content", "the content without its portal");
    assert.deepEqual([inline.type, inline.props.className, inline.props.align, inline.props.sideOffset, inline.props.portal],
        ["popover-content", "content inset=tight", "end", 0, undefined]);
});

test("the popover's root is open as its owner says, or as it was last asked", async () => {
    const { runtime, module } = await popover({ current: null });
    const asked: boolean[] = [];
    const radixRoot = (tree: TreeNode) => findIn(tree, node => node.type === "popover-root", "Radix's root");
    // Its owner's: Radix is told the same, and the owner hears each request.
    const owned = runtime.render(module.Popover, { open: true, onOpenChange: (next: boolean) => asked.push(next), children: "parts" });
    assert.equal(owned.props.value, true, "the content reads it");
    assert.deepEqual([radixRoot(owned).props.open, radixRoot(owned).props.children], [true, "parts"]);
    radixRoot(owned).props.onOpenChange(false);
    assert.deepEqual(asked, [false]);
    assert.equal(radixRoot(runtime.render(module.Popover, { open: true, onOpenChange: () => {}, children: "parts" })).props.open, true,
        "the owner decides");
    runtime.remount();
    // Its own: as it was opened with, then as it was last asked.
    const own = runtime.render(module.Popover, { defaultOpen: true, children: "parts" });
    assert.deepEqual([own.props.value, radixRoot(own).props.open], [true, true]);
    radixRoot(own).props.onOpenChange(false);
    const closed = runtime.render(module.Popover, { defaultOpen: true, children: "parts" });
    assert.deepEqual([closed.props.value, radixRoot(closed).props.open], [false, false]);
    runtime.remount();
    assert.equal(runtime.render(module.Popover, { children: "parts" }).props.value, false, "closed unless asked");
    // The owner's newest handler hears the request.
    runtime.remount();
    const heard: string[] = [];
    runtime.render(module.Popover, { open: false, onOpenChange: () => heard.push("first"), children: "parts" });
    const later = runtime.render(module.Popover, { open: false, onOpenChange: () => heard.push("second"), children: "parts" });
    radixRoot(later).props.onOpenChange(true);
    assert.deepEqual(heard, ["second"]);
});

test("a popover's content moves from the side Radix placed it on, or the side it asked for", async () => {
    for (const [placed, asked, expected] of [["top", undefined, "top"], ["right", undefined, "right"], ["bottom", "left", "bottom"],
        ["left", undefined, "left"], [null, "right", "right"], ["center", undefined, "bottom"]] as const) {
        const { runtime, module, played } = await popover({ current: true });
        runtime.render(module.PopoverContent, { portal: false, side: asked }, tree => {
            setRef(findIn(tree, node => node.type === "popover-content"), panelElement("panel", placed));
        });
        assert.deepEqual(played, [`appear panel popover ${expected}`], `placed ${String(placed)}, asked ${String(asked)}`);
        runtime.unmount();
    }
});

test("a popover's content that Radix never drew leaves at once", async () => {
    const open = { current: true as boolean | null };
    const { runtime, module, played } = await popover(open);
    runtime.render(module.PopoverContent, { portal: false });
    open.current = false;
    const leaving = runtime.render(module.PopoverContent, { portal: false });
    assert.ok(leaving, "drawn while its leaving starts");
    assert.equal(runtime.render(module.PopoverContent, { portal: false }), null);
    assert.deepEqual(played, [], "nothing to move");
    runtime.unmount();
});

test("a popover's exit started again (its side changed as it left) ends with the new one, not the one before", async () => {
    const open = { current: true as boolean | null };
    const { runtime, module, played, exits } = await popover(open);
    const panel = panelElement("panel");
    const drawPanel = (side: "top" | "left") => runtime.render(module.PopoverContent, { portal: false, side }, tree => {
        if (tree) setRef(findIn(tree, node => node.type === "popover-content"), panel);
    });
    drawPanel("top");
    open.current = false;
    drawPanel("top");
    drawPanel("left");
    assert.deepEqual(played, ["appear panel popover top", "disappear panel popover top", "stop panel", "disappear panel popover left"]);
    exits[0]();
    await Promise.resolve();
    assert.ok(drawPanel("left"), "the first exit, stopped, ends nothing");
    exits[1]();
    await Promise.resolve();
    assert.equal(drawPanel("left"), null);
    runtime.unmount();
});

// #1378: the content comes from its button and goes back toward it. It stays drawn while it
// leaves, and Radix keeps it (forceMount) until then: Radix gives the focus back once it is gone.
test("a popover's content comes in when drawn, stays drawn while it leaves, and is drawn anew when opened again as it leaves", async () => {
    const open = { current: true as boolean | null };
    const { runtime, module, played, exits } = await popover(open);
    const content = (tree: TreeNode | null) => findIn(tree, node => node.type === "popover-content", "the content");
    const drawPanel = (props: Record<string, unknown> = {}, element: unknown = null) => runtime.render(module.PopoverContent, { portal: false, ...props },
        tree => { if (element && tree) setRef(content(tree), element); });
    const first = panelElement("first", "left");
    const drawn = drawPanel({}, first);
    assert.deepEqual([content(drawn).props.forceMount, content(drawn).props["data-leaving"], content(drawn).key], [true, undefined, "0"]);
    assert.deepEqual(played, ["appear first popover left"], "from the side Radix placed it on");
    drawPanel({}, first);
    assert.deepEqual(played, ["appear first popover left"], "drawn again, it does not come in again");
    // Closed: still drawn, taking no presses, while it fades toward its button.
    open.current = false;
    const leaving = drawPanel({}, first);
    assert.deepEqual([content(leaving).props.forceMount, content(leaving).props["data-leaving"]], [true, ""]);
    assert.deepEqual(played.slice(1), ["disappear first popover left"]);
    exits[0]();
    await Promise.resolve();
    assert.equal(drawPanel(), null, "gone once it has left");
    // Opened again, and closed and opened again before it left: drawn anew, under a new key.
    open.current = true;
    const second = panelElement("second");
    drawPanel({}, second);
    open.current = false;
    drawPanel({}, second);
    open.current = true;
    const again = drawPanel({}, panelElement("third"));
    assert.deepEqual([content(again).key, content(again).props["data-leaving"]], ["1", undefined]);
    assert.deepEqual(played.slice(2), ["appear second popover bottom", "disappear second popover bottom", "appear third popover bottom", "stop second"]);
    exits[1]();
    await Promise.resolve();
    assert.ok(drawPanel(), "the exit that was cut short does not take the new one away");
    runtime.unmount();
});

test("a popover's content under a Radix root of the caller's own is shown and hidden by Radix, and gives the caller its ref", async () => {
    const { runtime, module, played } = await popover({ current: null });
    const seen: unknown[] = [];
    const objectRef: { current: HTMLDivElement | null } = { current: null };
    const element = unchecked<HTMLDivElement>(panelElement("own"));
    const portalled = runtime.render(module.PopoverContent, { ref: (node: unknown) => { seen.push(node); }, side: "top" }, tree => {
        setRef(findIn(tree, node => node.type === "popover-content"), element);
    });
    assert.equal(findIn(portalled, node => node.type === "popover-portal").props.forceMount, undefined);
    assert.equal(findIn(portalled, node => node.type === "popover-content").props.forceMount, undefined);
    assert.deepEqual(seen, [element]);
    assert.deepEqual(played, ["appear own popover top"], "from the side it asked for until Radix says where it placed it");
    runtime.render(module.PopoverContent, { ref: objectRef, side: "top" }, tree => {
        setRef(findIn(tree, node => node.type === "popover-content"), element);
    });
    assert.equal(objectRef.current, element);
    runtime.unmount();
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

// The confirmation inside a row (H-07). The parts that use the root's context are drawn with a
// context of the test's own; the kit's Button stands in by name.
type ConfirmModule = typeof import("./InlineConfirm.tsx");
async function confirmParts(context: unknown = null) {
    const runtime = hooks();
    const module = await loadModule<ConfirmModule>(new URL("./InlineConfirm.tsx", import.meta.url), runtime, {
        react: { ...runtime.api, useContext: () => context }, "./Button.tsx": { Button: "kit-button" },
    });
    return { runtime, module };
}

test("the confirmation inside a row is a named group: its sentence, the way back plain and focused, the removal danger", async () => {
    const calls: unknown[] = [];
    const { runtime, module } = await confirmParts({ trigger: (node: unknown) => calls.push(["trigger", node]), back: () => calls.push("back") });
    const group = runtime.render(module.InlineConfirmContent, { "aria-label": "Remove Home server", children: "parts", className: "own" });
    assert.deepEqual([group.type, group.props.role, group.props["data-slot"], group.props["aria-label"], group.props.className, group.props.children],
        ["div", "group", "inline-confirm-content", "Remove Home server", "content own", "parts"]);
    const sentence = runtime.render(module.InlineConfirmDescription, { children: "Only the registration is removed." });
    assert.deepEqual([sentence.type, sentence.props["data-slot"], sentence.props.className], ["p", "inline-confirm-description", "description"]);
    // The way back: the kit's plain Button, which takes the focus when the confirmation opens. It
    // tells the root before the row closes the confirmation.
    const back = runtime.render(module.InlineConfirmCancel, { children: "Back", onClick: () => calls.push("closed") });
    assert.deepEqual([back.type, back.props.autoFocus, back.props.tone, back.props.children], ["kit-button", true, undefined, "Back"]);
    back.props.onClick({});
    assert.deepEqual(calls, ["back", "closed"]);
    // The removal: the kit's danger Button, with the row's condition and request.
    const action = runtime.render(module.InlineConfirmAction, { children: "Remove", disabled: true, onClick: () => calls.push("removed") });
    assert.deepEqual([action.type, action.props.tone, action.props.disabled, action.props.autoFocus], ["kit-button", "danger", true, undefined]);
    action.props.onClick();
    assert.deepEqual(calls.at(-1), "removed");
    // The trigger: the kit's Button in the row's look; the root and the row's own ref both get it.
    const own: { current: unknown } = { current: null };
    // A ref object as a row keeps one; the test reads what it is given.
    const trigger = runtime.render(module.InlineConfirmTrigger, { tone: "danger", children: "Remove", ref: unchecked<Ref<HTMLButtonElement>>(own) });
    assert.deepEqual([trigger.type, trigger.props.tone, trigger.props.children], ["kit-button", "danger", "Remove"]);
    trigger.props.ref("the button");
    assert.deepEqual([calls.at(-1), own.current], [["trigger", "the button"], "the button"]);
    const seen: unknown[] = [];
    runtime.render(module.InlineConfirmTrigger, { ref: (node: unknown) => { seen.push(node); } }).props.ref("another");
    assert.deepEqual(seen, ["another"]);
});

test("after the way back the focus returns to the trigger once it is drawn again, and only then", async () => {
    const { runtime, module } = await confirmParts();
    const focused: string[] = [];
    const button = (name: string, isConnected = true) => ({ isConnected, focus: () => focused.push(name) });
    const draw = () => runtime.render(module.InlineConfirm, { children: "the row's actions" });
    const root = draw();
    assert.equal(root.props.children, "the row's actions", "it draws only what it holds");
    const { trigger, back } = root.props.value;
    trigger(button("Remove"));
    draw();
    assert.deepEqual(focused, [], "nothing moves while the row is only drawn");
    // The confirmation opens: the trigger leaves the page. The way back is taken, and the row's
    // actions are drawn again with a new trigger: it gets the focus, once.
    trigger(null);
    back();
    draw();
    assert.deepEqual(focused, [], "no trigger on the page yet");
    trigger(button("Remove again", false));
    draw();
    assert.deepEqual(focused, [], "a trigger not on the page yet waits");
    trigger(button("Remove again"));
    draw();
    draw();
    assert.deepEqual(focused, ["Remove again"]);
    // After the removal the focus is left where it is: the row goes away.
    trigger(null);
    trigger(button("Remove a third time"));
    draw();
    assert.deepEqual(focused, ["Remove again"]);
    runtime.unmount();
});

test("a choice card is a label round a native radio, what it shows and its name, named as shadcn/ui's choice card", async () => {
    const { runtime, module } = await kit<typeof import("./ChoiceCard.tsx")>("./ChoiceCard.tsx", {
        "./ChoiceCard.css.ts": styleModule([]),
    });
    const onChange = () => {};
    const drawn = runtime.render(module.ChoiceCard, { name: "theme", value: "forest", checked: true, onChange, title: "Forest",
        className: "place", children: "picture" });
    assert.deepEqual([drawn.type, drawn.props["data-slot"], drawn.props.className], ["label", "field-label", "card place"]);
    const [radio, picture, name] = drawn.props.children;
    assert.equal(radio.type, "input");
    assert.deepEqual([radio.props.type, radio.props["data-slot"], radio.props.className, radio.props.name, radio.props.value,
        radio.props.checked, radio.props.onChange], ["radio", "radio-group-item", "radio", "theme", "forest", true, onChange]);
    // What the card shows comes between the radio and the name; the card adds nothing to it.
    assert.equal(picture, "picture");
    assert.deepEqual([name.type, name.props["data-slot"], name.props.className], ["span", "field-title", "title"]);
    const [words, mark] = name.props.children;
    assert.equal(words, "Forest");
    // The check after the name (an SVG, which the harness draws as nothing) is drawn on every card
    // and shown by the style only on the one in use, so it follows the radio itself; it is a
    // picture, not read out.
    assert.deepEqual([typeof mark.type, mark.props["data-slot"], mark.props.className, mark.props["aria-hidden"]],
        ["function", "radio-group-indicator", "check", "true"]);
    // A radio stays a radio, whatever the caller passes.
    const unchecked = runtime.render(module.ChoiceCard, { title: "Custom", type: "checkbox", disabled: true });
    const input = findIn(unchecked, node => node.type === "input", "the radio");
    assert.deepEqual([input.props.type, input.props.checked, input.props.disabled], ["radio", undefined, true]);
});
