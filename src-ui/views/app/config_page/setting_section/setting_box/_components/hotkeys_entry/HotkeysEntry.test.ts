import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, findIn, setRef } from "../../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../../logics/test/hookHarness.ts";
import type { Hotkeys } from "../../../../../../../logics/store.ts";
import type { HotkeysEntryProps } from "./HotkeysEntry.tsx";

interface KeyEvent {
    key: string;
    defaultPrevented: boolean;
    stopped: boolean;
    preventDefault(): void;
    stopPropagation(): void;
    [field: string]: unknown;
}

async function setup() {
    const runtime = hooks(), saves: Hotkeys[] = [];
    const Entry = () => null;
    const { HotkeysEntry } = await loadModule<typeof import("./HotkeysEntry.tsx")>(new URL("./HotkeysEntry.tsx", import.meta.url), runtime, {
        "../_atoms/_entry/_Entry": { _Entry: Entry },
    });
    const props: HotkeysEntryProps = { value: { open_quick_chat: ["Ctrl", "Q"] }, hotkey_id: "open_quick_chat", label: "クイックチャット",
        setHotkeys: async (value: Hotkeys) => { saves.push(value); return true; } };
    let current: TreeNode | null | undefined;
    const render = () => {
        const tree = runtime.render(HotkeysEntry, props, tree => {
            const entry = findIn(tree, node => node.type === Entry);
            current = entry;
            setRef(entry, { blur: () => entry.props.onBlur() });
        });
        return tree;
    };
    const field = () => { render(); assert.ok(current); return current.props; };
    const key = (name: string, extra: Record<string, unknown> = {}) => {
        const event: KeyEvent = { key: name, defaultPrevented: false, stopped: false,
            preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...extra };
        field().onKeyDown(event);
        field().onKeyUp(event);
        return event;
    };
    field();
    field().onFocus();
    return { render, field, key, saves, props };
}

for (const shiftKey of [false, true]) test(`${shiftKey ? "Shift+Tab" : "Tab"} moves focus without saving a binding`, async () => {
    const subject = await setup();
    if (shiftKey) subject.field().onKeyDown({ key: "Shift", shiftKey: true, preventDefault() {} });
    const event = subject.key("Tab", { shiftKey });
    assert.equal(event.defaultPrevented, false);
    subject.field().onBlur();
    subject.field().onKeyUp({ key: "Shift" });
    assert.deepEqual(subject.saves, []);
    assert.equal(subject.field().ui_variable, "Ctrl + Q");
    assert.equal(subject.field()["aria-label"], "クイックチャット");
});

test("Escape cancels an unfinished chord and restores the acknowledged binding without saving", async () => {
    const subject = await setup();
    subject.field().onKeyDown({ key: "w", ctrlKey: true, preventDefault() {} });
    assert.equal(subject.field().ui_variable, "Ctrl + W");
    const event = subject.key("Escape");
    assert.equal(event.defaultPrevented, true);
    assert.equal(event.stopped, true);
    subject.field().onKeyUp({ key: "w" });
    assert.deepEqual(subject.saves, []);
    assert.equal(subject.field().ui_variable, "Ctrl + Q");
    subject.key("n", { ctrlKey: true });
    assert.deepEqual(subject.saves, [{ open_quick_chat: ["Ctrl", "N"] }]);
});

test("blur cancels a partial chord; a fresh chord and the clear button still save", async () => {
    const subject = await setup();
    subject.field().onKeyDown({ key: "w", ctrlKey: true, preventDefault() {} });
    subject.field().onBlur();
    subject.field().onKeyUp({ key: "w" });
    assert.deepEqual(subject.saves, []);
    subject.field().onFocus();
    subject.key("w", { ctrlKey: true });
    assert.deepEqual(subject.saves, [{ open_quick_chat: ["Ctrl", "W"] }]);
    const clear = findIn(subject.render(), node => node.type === "button");
    assert.equal(clear.props["aria-label"], "quick_chat.clear_shortcut");
    clear.props.onClick();
    assert.deepEqual(subject.saves.at(-1), { open_quick_chat: null });
});

test("Ctrl+Space is recorded as a key name the shortcut parsers accept", async () => {
    const subject = await setup();
    subject.field().onKeyDown({ key: "Control", code: "ControlLeft", ctrlKey: true, preventDefault() {} });
    subject.key(" ", { code: "Space", ctrlKey: true });
    assert.equal(subject.saves.length, 0);
    subject.field().onKeyUp({ key: "Control", code: "ControlLeft" });
    assert.deepEqual(subject.saves, [{ open_quick_chat: ["Ctrl", "Space"] }]);
});

test("Shift+digit records the digit, even when Shift is released first", async () => {
    const subject = await setup();
    subject.field().onKeyDown({ key: "Control", code: "ControlLeft", ctrlKey: true, preventDefault() {} });
    subject.field().onKeyDown({ key: "Shift", code: "ShiftLeft", ctrlKey: true, shiftKey: true, preventDefault() {} });
    subject.field().onKeyDown({ key: "!", code: "Digit1", ctrlKey: true, shiftKey: true, preventDefault() {} });
    assert.equal(subject.field().ui_variable, "Ctrl + Shift + 1");
    subject.field().onKeyUp({ key: "Shift", code: "ShiftLeft" });
    subject.field().onKeyUp({ key: "Control", code: "ControlLeft" });
    subject.field().onKeyUp({ key: "1", code: "Digit1" });
    assert.deepEqual(subject.saves, [{ open_quick_chat: ["Ctrl", "Shift", "1"] }]);
});

// #563: "?" is no key name the global shortcut parser reads, so the chord was refused as one
// already in use. The key under it ("/") is recorded instead, as for a digit.
test("Shift with a symbol key records the key under it and saves when Shift is released first", async () => {
    const subject = await setup();
    subject.field().onKeyDown({ key: "Control", code: "ControlLeft", ctrlKey: true, preventDefault() {} });
    subject.field().onKeyDown({ key: "Shift", code: "ShiftLeft", ctrlKey: true, shiftKey: true, preventDefault() {} });
    subject.field().onKeyDown({ key: "?", code: "Slash", ctrlKey: true, shiftKey: true, preventDefault() {} });
    assert.equal(subject.field().ui_variable, "Ctrl + Shift + /");
    subject.field().onKeyUp({ key: "Shift", code: "ShiftLeft", ctrlKey: true });
    subject.field().onKeyUp({ key: "Control", code: "ControlLeft" });
    // Without Shift the same key reports "/".
    subject.field().onKeyUp({ key: "/", code: "Slash" });
    assert.deepEqual(subject.saves, [{ open_quick_chat: ["Ctrl", "Shift", "/"] }]);
});

test("every symbol key typed with Shift is recorded by a name the global shortcut parser reads", async () => {
    // The punctuation names global-hotkey's parse_key accepts (src-tauri's tauri-plugin-global-shortcut).
    const accepted = new Set(["`", "\\", "[", "]", ",", "=", "-", ".", "'", ";", "/"]);
    const shifted = { Backquote: "~", Minus: "_", Equal: "+", BracketLeft: "{", BracketRight: "}", Backslash: "|",
        Semicolon: ":", Quote: "\"", Comma: "<", Period: ">", Slash: "?" };
    for (const [code, key] of Object.entries(shifted)) {
        const subject = await setup();
        subject.key(key, { code, ctrlKey: true, shiftKey: true });
        const first = subject.saves[0];
        assert.ok(first);
        const saved = first.open_quick_chat;
        assert.ok(saved);
        assert.deepEqual(saved.slice(0, 2), ["Ctrl", "Shift"], code);
        assert.ok(accepted.has(saved[2]), `${code}: ${saved[2]}`);
    }
    // Unshifted symbols and other keys keep what the key gives.
    const plain = await setup();
    plain.key(";", { code: "Semicolon", ctrlKey: true });
    plain.field().onFocus();
    plain.key("F5", { code: "F5", shiftKey: true });
    assert.deepEqual(plain.saves, [{ open_quick_chat: ["Ctrl", ";"] }, { open_quick_chat: ["Shift", "F5"] }]);
});

for (const newerEdit of [false, true]) test(`rejected hotkey restores committed display without overwriting a newer edit: ${newerEdit}`, async () => {
    const s = await setup();
    // Set by the save below, before the test resolves it.
    let resolve: (taken: boolean) => void = () => { throw new TypeError("No save is waiting"); };
    s.props.setHotkeys = () => new Promise<boolean>(done => { resolve = done; });
    s.key("w", { ctrlKey: true });
    s.field(); s.field(); // Let blur's synchronization effect finish before rejection.
    if (newerEdit) {
        s.field().onFocus();
        s.field().onKeyDown({ key: "n", ctrlKey: true, preventDefault() {} });
    } else {
        s.props.value = { open_quick_chat: ["Ctrl", "E"] }; s.field();
    }
    resolve(false);
    await Promise.resolve(); await Promise.resolve();
    assert.equal(s.field().ui_variable, newerEdit ? "Ctrl + N" : "Ctrl + E");
});
