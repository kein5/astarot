import assert from "node:assert/strict";
import { test, vi } from "vitest";
import type { TestContext } from "vitest";
import { findIn, hooks, loadModule, nodesIn, setRef, stubGlobals, treeNode, unchecked } from "../../../../../../../logics/test/hookHarness.ts";

// The drop zone for files from the desktop (FileDropZone.tsx), drawn with the real drag-and-drop
// logic (fileDrop.ts, loaded afresh for each test so its zones and watchers start empty). The
// window's drag events are given to it as Tauri would give them, and the zone has a box on the
// page at (0, 0)–(100, 50).

const t = (key: string, variables?: object) => variables ? `${key} ${JSON.stringify(variables)}` : key;
const box = { left: 0, right: 100, top: 0, bottom: 50, width: 100, height: 50 };
const inside = { x: 10, y: 10 }, outside = { x: 500, y: 500 };

async function dropZone(context: TestContext, props: Record<string, unknown> = {}) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    stubGlobals(context, { window: { devicePixelRatio: 1 } });
    const runtime = hooks(), dropped: string[][] = [];
    context.onTestFinished(() => runtime.unmount());
    const fileDrop = await loadModule<typeof import("../../../../../../../logics/common/fileDrop.ts")>(new URL("../../../../../../../logics/common/fileDrop.ts", import.meta.url), runtime, {
        "@tauri-apps/api/core": { isTauri: () => false },
        "@tauri-apps/api/webview": { getCurrentWebview: () => { throw new Error("not in the app"); } },
    });
    const { FileDropZone } = await loadModule<typeof import("./FileDropZone.tsx")>(new URL("./FileDropZone.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t }) },
        "../../../../../../../logics/common/fileDrop": fileDrop,
    });
    let current = { accept: [".pth", ".index"], onFiles: (paths: string[]) => { dropped.push(paths); }, hint: "Drop your model", ...props };
    // Draws the zone, putting its element where React would before the effects run.
    const draw = (next: Record<string, unknown> = {}) => {
        current = { ...current, ...next };
        return runtime.render(FileDropZone, current, tree => {
            const node = treeNode(tree);
            if (node) setRef(node, { getBoundingClientRect: () => box });
        });
    };
    // The window's drag events, as the shared listener passes them on.
    const drag = (type: string, position = inside, paths?: string[]) => {
        // Test data: the fields of Tauri's event that the logic reads.
        fileDrop.handleDragDrop(unchecked(type === "leave" ? { type: "leave" } : type === "over" ? { type: "over", position } : { type, position, paths: paths ?? [] }));
        return draw();
    };
    return { runtime, dropped, draw, drag };
}

// The words a part of the tree shows.
const textOf = (value: unknown): string => {
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (Array.isArray(value)) return value.map(textOf).join("");
    const node = treeNode(value);
    return node ? textOf(node.props.children) : "";
};
// What the zone shows: its state, its title, its note and what it announces.
const shownWithKey = (tree: unknown) => {
    const node = treeNode(tree);
    assert.ok(node);
    const spans = nodesIn(node).filter(item => item.type === "span");
    const words = spans.find(item => nodesIn(item).filter(inner => inner.type === "span").length > 1);
    assert.ok(words);
    const [title, note] = [words.props.children].flat().filter(child => treeNode(child) !== null);
    const status = findIn(node, item => item.props?.role === "status");
    return { state: node.props["data-file-drop"], title: textOf(title), note: note ? textOf(note) : null, announced: textOf(status),
        // The title's key: a new line rolls in when the state or its words change.
        key: String(treeNode(title)?.key) };
};
// What the zone shows, without the title's key.
const shown = (tree: unknown) => {
    const { key: _key, ...rest } = shownWithKey(tree);
    return rest;
};
const KINDS = `{"kinds":".pth / .index"}`;

test("at rest the zone names the kinds it takes and its hint, and announces nothing", async context => {
    const z = await dropZone(context);
    const tree = z.draw();
    assert.deepEqual(shown(tree), { state: "idle", title: `file_drop.title ${KINDS}`, note: "Drop your model", announced: "" });
    const icon = findIn(tree, node => node.type === "span" && node.props["aria-hidden"] === "true");
    assert.equal(nodesIn(icon).filter(node => node.type === "svg").length, 2);
    assert.equal(shownWithKey(tree).key, `idle:file_drop.title ${KINDS}`);
    const plain = await dropZone(context, { hint: undefined });
    assert.equal(shown(plain.draw()).note, null);
});

test("dragged files wake every zone, lift the one under the pointer, and say whether they are of a kind it takes", async context => {
    const z = await dropZone(context);
    z.draw();
    assert.deepEqual(shown(z.drag("enter", outside, ["/m/voice.pth"])), { state: "awake", title: `file_drop.drop_here ${KINDS}`, note: "Drop your model", announced: "" });
    assert.deepEqual(shown(z.drag("over", inside)), { state: "over", title: "file_drop.release", note: "Drop your model", announced: "" });
    assert.equal(shownWithKey(z.draw()).key, "over:file_drop.release");
    assert.equal(shown(z.drag("over", outside)).state, "awake");
    assert.equal(shown(z.drag("leave")).state, "idle");
    assert.deepEqual(shown(z.drag("enter", inside, ["/m/readme.txt"])), { state: "wrong", title: `file_drop.wrong_kind ${KINDS}`, note: "Drop your model", announced: "" });
    assert.equal(shown(z.drag("enter", inside, ["/m/readme.txt", "/m/VOICE.PTH"])).state, "over", "one file of a kind taken is enough");
});

test("a drop passes on the paths of the kinds taken, says which files it took, and goes back to rest after four seconds", async context => {
    const z = await dropZone(context);
    z.draw();
    z.drag("enter", inside, ["/m/voice.pth", "C:\\m\\voice.index"]);
    let tree = z.drag("drop", inside, ["/m/voice.pth", "C:\\m\\voice.index"]);
    assert.deepEqual(z.dropped, [["/m/voice.pth", "C:\\m\\voice.index"]]);
    tree = z.draw();
    assert.deepEqual(shown(tree), { state: "done", title: `file_drop.done {"names":"voice.pth, voice.index"}`, note: `file_drop.save_hint ${KINDS}`,
        announced: `file_drop.done {"names":"voice.pth, voice.index"}` });
    vi.advanceTimersByTime(3999);
    assert.equal(shown(z.draw()).state, "done");
    vi.advanceTimersByTime(1);
    assert.deepEqual(shown(z.draw()), { state: "idle", title: `file_drop.title ${KINDS}`, note: "Drop your model", announced: "" });
    // Some files of another kind: they are left out, and the note says so.
    z.drag("drop", inside, ["/m/voice.pth", "/m/readme.txt"]);
    assert.deepEqual(shown(z.draw()), { state: "done", title: `file_drop.done {"names":"voice.pth"}`, note: `file_drop.done_skipped ${KINDS}`,
        announced: `file_drop.done {"names":"voice.pth"}` });
    assert.deepEqual(z.dropped.at(-1), ["/m/voice.pth"]);
    // A second drop starts the four seconds again.
    vi.advanceTimersByTime(3000);
    z.drag("drop", inside, ["/m/other.index"]);
    vi.advanceTimersByTime(3000);
    assert.equal(shown(z.draw()).state, "done");
    vi.advanceTimersByTime(1000);
    assert.equal(shown(z.draw()).state, "idle");
    assert.ok(tree);
});

test("a drop of no file of the kinds taken passes nothing on and says which kinds it takes", async context => {
    const z = await dropZone(context);
    z.draw();
    z.drag("drop", inside, ["/m/readme.txt"]);
    assert.deepEqual(z.dropped, []);
    assert.deepEqual(shown(z.draw()), { state: "rejected", title: `file_drop.wrong_kind ${KINDS}`, note: "Drop your model", announced: `file_drop.wrong_kind ${KINDS}` });
    // A drop beside the zone is not its drop.
    const other = await dropZone(context);
    other.draw();
    other.drag("drop", outside, ["/m/voice.pth"]);
    assert.deepEqual([other.dropped, shown(other.draw()).state], [[], "idle"]);
});

test("a disabled zone says what it takes but neither lifts nor takes a drop", async context => {
    const z = await dropZone(context, { disabled: true });
    z.draw();
    assert.deepEqual(shown(z.drag("enter", inside, ["/m/voice.pth"])), { state: "disabled", title: `file_drop.title ${KINDS}`, note: "Drop your model", announced: "" });
    z.drag("drop", inside, ["/m/voice.pth"]);
    assert.deepEqual(z.dropped, []);
    // Enabled again, it takes the next drop with the props it has then.
    const later: string[][] = [];
    z.draw({ disabled: false, accept: [".gguf"], onFiles: (paths: string[]) => { later.push(paths); } });
    z.drag("drop", inside, ["/m/voice.pth", "/m/speech.gguf"]);
    assert.deepEqual([z.dropped, later], [[], [["/m/speech.gguf"]]]);
});

test("a zone that is closed takes no more drops and stops its timer", async context => {
    const z = await dropZone(context);
    z.draw();
    z.drag("drop", inside, ["/m/voice.pth"]);
    assert.equal(vi.getTimerCount(), 1);
    z.runtime.unmount();
    assert.equal(vi.getTimerCount(), 0);
    z.drag("drop", inside, ["/m/voice.index"]);
    assert.deepEqual(z.dropped, [["/m/voice.pth"]]);
});

test("a zone that is closed stops watching the drag and leaves the shared list of zones", async context => {
    const runtime = hooks(), done: string[] = [];
    context.onTestFinished(() => runtime.unmount());
    const real = await loadModule<typeof import("../../../../../../../logics/common/fileDrop.ts")>(new URL("../../../../../../../logics/common/fileDrop.ts", import.meta.url), runtime, {
        "@tauri-apps/api/core": { isTauri: () => false }, "@tauri-apps/api/webview": {},
    });
    // The shared drag logic with its registrations recorded: what the zone undoes when it closes.
    const fileDrop = { ...real, addDropZone: () => () => { done.push("removed"); }, watchDrag: () => () => { done.push("stopped watching"); } };
    const { FileDropZone } = await loadModule<typeof import("./FileDropZone.tsx")>(new URL("./FileDropZone.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t }) },
        "../../../../../../../logics/common/fileDrop": fileDrop,
    });
    runtime.render(FileDropZone, { accept: [".pth"], onFiles() {} });
    assert.deepEqual(done, []);
    runtime.unmount();
    assert.deepEqual([...done].sort(), ["removed", "stopped watching"]);
});
