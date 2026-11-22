import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { hooks, loadModule, find, findIn, setRef, unchecked } from "../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../logics/test/hookHarness.ts";

// The kit's Dialog: shadcn/ui's Dialog parts on the native <dialog> (docs/design/components/).
const read = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");
type DialogModule = typeof import("./Dialog.tsx");

// A <dialog> as far as the Dialog uses it.
const fakeDialog = () => {
    const calls: string[] = [];
    const element = {
        open: false,
        showModal() { element.open = true; calls.push("showModal"); },
        close() { element.open = false; calls.push("close"); },
    };
    return { element, calls };
};

async function dialog() {
    const runtime = hooks(), changes: boolean[] = [];
    const { Dialog } = await loadModule<DialogModule>(new URL("./Dialog.tsx", import.meta.url), runtime);
    const { element, calls } = fakeDialog();
    const render = (open: boolean) => runtime.render(Dialog,
        { open, onOpenChange: (next: boolean) => changes.push(next), children: "words" },
        // The test attaches the fake where React would: through the element's ref.
        tree => { setRef(findIn(tree, node => node.type === "dialog"), element); });
    const content = (tree: TreeNode) => findIn(tree, node => node.type === "dialog");
    return { runtime, render, content, element, calls, changes };
}

const event = () => {
    const seen = { prevented: false };
    return { seen, value: unchecked<Event>({ preventDefault() { seen.prevented = true; } }) };
};

test("the dialog opens as a modal while open, and closes when open turns false", async () => {
    const { runtime, render, element, calls } = await dialog();
    render(false);
    assert.deepEqual(calls, []);
    render(true);
    assert.equal(element.open, true);
    assert.deepEqual(calls, ["showModal"], "a modal: focus stays in it, Esc closes it, ::backdrop dims the window");
    render(true);
    assert.deepEqual(calls, ["showModal"], "shown once");
    render(false);
    assert.deepEqual(calls, ["showModal", "close"]);
    runtime.unmount();
});

test("Esc and the dialog's own closing ask the owner of open, as shadcn/ui's onOpenChange", async () => {
    const { runtime, render, content, changes } = await dialog();
    const esc = event();
    content(render(true)).props.onCancel(esc.value);
    assert.equal(esc.seen.prevented, true, "the owner closes it, through open");
    assert.deepEqual(changes, [false]);
    // A form with method="dialog" closes it without asking: the owner is told.
    content(render(true)).props.onClose(event().value);
    assert.deepEqual(changes, [false, false]);
    // Closed through open: nothing more to tell.
    content(render(false)).props.onClose(event().value);
    assert.deepEqual(changes, [false, false]);
    runtime.unmount();
});

test("the dialog is named and described by its title and description", async () => {
    const { runtime, render, content } = await dialog();
    const tree = render(true);
    const dialogNode = content(tree);
    assert.equal(dialogNode.props["data-slot"], "dialog-content");
    // The ids reach the parts through context, as Radix links them.
    const provider = find(tree, node => node.props?.value?.title !== undefined);
    assert.ok(provider);
    const ids = provider.props.value;
    assert.equal(dialogNode.props["aria-labelledby"], ids.title);
    assert.equal(dialogNode.props["aria-describedby"], ids.description);
    runtime.unmount();
    const parts = hooks();
    const { DialogTitle, DialogDescription, DialogHeader, DialogFooter } = await loadModule<DialogModule>(
        new URL("./Dialog.tsx", import.meta.url), parts, { react: { ...parts.api, useContext: () => ids } });
    const title = parts.render(DialogTitle, { children: "Title" });
    assert.deepEqual([title.type, title.props.id, title.props["data-slot"]], ["h2", ids.title, "dialog-title"]);
    const description = parts.render(DialogDescription, { children: "Description" });
    assert.deepEqual([description.type, description.props.id, description.props["data-slot"]], ["p", ids.description, "dialog-description"]);
    assert.equal(parts.render(DialogHeader, {}).props["data-slot"], "dialog-header");
    assert.equal(parts.render(DialogFooter, {}).props["data-slot"], "dialog-footer");
});

test("the dialog has shadcn/ui's width, room and gap, and the app's corners, ground and border", () => {
    const css = read("Dialog.css.ts");
    // w-full max-w-[calc(100%-2rem)] sm:max-w-lg, p-6, grid gap-4 (only while open).
    assert.match(css, /width: "min\(51\.2rem, calc\(100vw - 3\.2rem\)\)",\s*maxWidth: "calc\(100vw - 3\.2rem\)",/);
    assert.match(css, /padding: "2\.4rem",/);
    assert.match(css, /"&\[open\]": \{ display: "grid", gap: "1\.6rem", alignContent: "start" \}/);
    // DESIGN.md's rounded.dialog, the dialog ground, no shadow (D-04, D-02, D-05).
    assert.match(css, /borderRadius: "1\.2rem",\s*background: vars\.dark_875_color,/);
    assert.doesNotMatch(css, /boxShadow/);
    // bg-black/50, the one colour not taken from a token (::backdrop does not get the dialog's
    // custom properties in older engines).
    assert.match(css, /"&::backdrop": \{ background: "rgb\(0 0 0 \/ \.5\)" \}/);
    assert.equal((css.match(/rgb\(/g) ?? []).length, 1);
    // DialogTitle is DESIGN.md's title role; DialogDescription is text-sm in the description colour.
    assert.match(css, /export const title = style\(\{[^}]*fontSize: "1\.8rem",\s*fontWeight: 600,/);
    assert.match(css, /export const description = style\(\{[^}]*fontSize: "1\.4rem",\s*lineHeight: 1\.6,\s*color: vars\.vox_description_text,/);
});
