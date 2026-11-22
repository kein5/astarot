import assert from "node:assert/strict";
import { test } from "vitest";
import { addDropZone, extensionOf, handleDragDrop, nameOf, sortFiles, watchDrag, zoneAt } from "./fileDrop.ts";
import type { DragState, DropZone } from "./fileDrop.ts";
import type { DragDropEvent } from "@tauri-apps/api/webview";
import { unchecked } from "../test/hookHarness.ts";

// Page boxes for fake zones (getBoundingClientRect in CSS pixels).
const box = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height });
const zone = (rect: ReturnType<typeof box>, extra: Partial<DropZone> = {}): DropZone & { drops: string[][] } => {
    const drops: string[][] = [];
    // Test data: an element with only the box the zone reads.
    return { drops, element: unchecked<Element>({ getBoundingClientRect: () => rect }), drop: paths => drops.push(paths), disabled: () => false, ...extra };
};
// Test data: Tauri's drag-and-drop events with only the fields the handler reads (a plain position for PhysicalPosition).
const drag = (payload: object) => handleDragDrop(unchecked<DragDropEvent>(payload));

test("a file's kind is its last extension, in any letter case, from Windows or Linux paths", () => {
    assert.equal(extensionOf("C:\\Models\\Voice.PTH"), ".pth");
    assert.equal(extensionOf("/home/me/models/voice.added_IVF256.index"), ".index");
    assert.equal(extensionOf("C:\\Models.v2\\README"), "");
    assert.equal(extensionOf("/home/me/.config"), ".config");
    assert.equal(nameOf("C:\\Models\\Voice.pth"), "Voice.pth");
    assert.equal(nameOf("/home/me/voice.index"), "voice.index");
});

test("a zone takes only its kinds, keeps their order and reports the rest", () => {
    const paths = ["C:\\a\\notes.txt", "C:\\a\\voice.pth", "C:\\a\\voice.INDEX", "C:\\a\\more.pth"];
    assert.deepEqual(sortFiles(paths, [".pth", ".index"]), {
        accepted: ["C:\\a\\voice.pth", "C:\\a\\voice.INDEX", "C:\\a\\more.pth"],
        rejected: ["C:\\a\\notes.txt"],
    });
    assert.deepEqual(sortFiles(undefined, [".pth"]), { accepted: [], rejected: [] });
});

test("the zone under a point gets it; a folded, empty or disabled zone does not", () => {
    const open = zone(box(10, 100, 300, 60));
    const folded = zone(box(0, 0, 0, 0));
    const off = zone(box(10, 200, 300, 60), { disabled: () => true });
    const zones = [folded, open, off];
    assert.equal(zoneAt({ x: 50, y: 120 }, zones), open);
    assert.equal(zoneAt({ x: 310, y: 160 }, zones), open);
    assert.equal(zoneAt({ x: 50, y: 220 }, zones), null);
    assert.equal(zoneAt({ x: 5, y: 120 }, zones), null);
});

test("drag events wake every zone, mark the hovered one and hand the drop to the zone under it", () => {
    Reflect.set(globalThis, "window", { devicePixelRatio: 1.5 });
    const target = zone(box(100, 100, 200, 50));
    const other = zone(box(100, 300, 200, 50));
    const removeTarget = addDropZone(target), removeOther = addDropZone(other);
    const seen: Readonly<DragState>[] = [];
    const stop = watchDrag(state => seen.push(state));
    try {
        // Physical pixels: (180, 180) is (120, 120) on the page at 150%.
        drag({ type: "enter", paths: ["C:\\m\\voice.pth"], position: { x: 30, y: 30 } });
        assert.deepEqual([seen.at(-1)?.active, seen.at(-1)?.over], [true, null]);
        drag({ type: "over", position: { x: 180, y: 180 } });
        assert.equal(seen.at(-1)?.over, target);
        const count = seen.length;
        drag({ type: "over", position: { x: 190, y: 180 } });
        assert.equal(seen.length, count, "moving inside the same zone publishes nothing new");
        drag({ type: "drop", paths: ["C:\\m\\voice.pth"], position: { x: 180, y: 180 } });
        assert.deepEqual(target.drops, [["C:\\m\\voice.pth"]]);
        assert.deepEqual(other.drops, []);
        assert.equal(seen.at(-1)?.active, false);
        // A drop outside every zone goes nowhere; leaving resets.
        drag({ type: "enter", paths: ["C:\\m\\x.pth"], position: { x: 0, y: 0 } });
        drag({ type: "drop", paths: ["C:\\m\\x.pth"], position: { x: 0, y: 0 } });
        assert.deepEqual([target.drops.length, other.drops.length], [1, 0]);
        drag({ type: "enter", paths: [], position: { x: 180, y: 180 } });
        drag({ type: "leave" });
        assert.equal(seen.at(-1)?.active, false);
    } finally {
        stop();
        removeTarget();
        removeOther();
        Reflect.deleteProperty(globalThis, "window");
    }
});

test("a zone removed while hovered stops being the drop target", () => {
    Reflect.set(globalThis, "window", { devicePixelRatio: 1 });
    const target = zone(box(0, 0, 100, 100));
    const remove = addDropZone(target);
    const seen: Readonly<DragState>[] = [];
    const stop = watchDrag(state => seen.push(state));
    try {
        drag({ type: "enter", paths: ["/m/v.pth"], position: { x: 10, y: 10 } });
        assert.equal(seen.at(-1)?.over, target);
        remove();
        assert.equal(seen.at(-1)?.over, null);
        drag({ type: "drop", paths: ["/m/v.pth"], position: { x: 10, y: 10 } });
        assert.deepEqual(target.drops, []);
    } finally {
        stop();
        Reflect.deleteProperty(globalThis, "window");
    }
});
