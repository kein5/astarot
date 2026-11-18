import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, eventTarget } from "../../../../../logics/test/hookHarness.js";

async function settings() {
    const runtime = hooks(), closed = [];
    const { LanguageSettings } = await loadModule(new URL("./LanguageSettings.jsx", import.meta.url), runtime, {
        "@store": { useStore_IsOpenedTranslatorSelector: () => ({ updateIsOpenedTranslatorSelector: value => closed.push(value) }) },
        "@logics_main": { useMainFunction: () => ({}) },
        "./preset_tab_selector/PresetTabSelector": { PresetTabSelector: "presets" },
        "./language_selector_open_button/LanguageSelectorOpenButton": { LanguageSelectorOpenButton: "language" },
        "./language_swap_button/LanguageSwapButton": { LanguageSwapButton: "swap" },
        "./translator_selector_open_button/TranslatorSelectorOpenButton": { TranslatorSelectorOpenButton: "translator" },
        "./add_remove_target_language_buttons/AddRemoveTargetLanguageButtons": { AddRemoveTargetLanguageButtons: "add-remove" },
    });
    const container = runtime.render(LanguageSettings);
    return { leave: event => container.props.onMouseLeave(event), closed, runtime };
}

// The language settings, one element inside them, and the page they are on.
const page = eventTarget();
const button = {};
const inside = { ownerDocument: page, contains: node => node === inside || node === button };
// The rail's scroll container: 240px wide at x=0, of which 232px are content and 8px scrollbar.
const rail = { clientLeft: 0, clientWidth: 232, getBoundingClientRect: () => ({ left: 0 }), contains: node => node === inside };
const toScrollbar = { currentTarget: inside, relatedTarget: rail, clientX: 236 };

test("the translator list stays open when the pointer goes to the rail's scrollbar", async () => {
    const s = await settings();
    s.leave(toScrollbar);
    assert.deepEqual(s.closed, []);
    s.runtime.unmount();
});

test("the translator list closes when the pointer leaves the language settings anywhere else", async () => {
    const s = await settings();
    s.leave({ currentTarget: inside, relatedTarget: rail, clientX: 120 });
    s.leave({ currentTarget: inside, relatedTarget: { getBoundingClientRect: () => ({ left: 0 }), contains: () => false }, clientX: 300 });
    s.leave({ currentTarget: inside, relatedTarget: null, clientX: 0 });
    assert.deepEqual(s.closed, [false, false, false]);
});

// #563: from the scrollbar the pointer could go on to the conversation without another
// mouseleave, and the list stayed open.
test("after the scrollbar, the list closes once the pointer is over anything outside the language settings", async () => {
    const s = await settings();
    s.leave(toScrollbar);
    page.dispatch("mouseover", { target: { name: "conversation" } });
    assert.deepEqual(s.closed, [false]);
    // The watch ended with it: nothing more is listened to.
    page.dispatch("mouseover", { target: { name: "conversation" } });
    assert.deepEqual(s.closed, [false]);
    assert.equal(page.added.length, page.removed.length);
});

test("back from the scrollbar into the language settings, the list stays open and the watch ends", async () => {
    const s = await settings();
    s.leave(toScrollbar);
    page.dispatch("mouseover", { target: button });
    assert.deepEqual(s.closed, []);
    page.dispatch("mouseover", { target: { name: "conversation" } });
    assert.deepEqual(s.closed, [], "the mouseleave of this part handles the next exit");
    assert.equal(page.added.length, page.removed.length);
});

test("closing the language settings while the pointer is on the scrollbar stops the watch", async () => {
    const s = await settings();
    s.leave(toScrollbar);
    s.runtime.unmount();
    page.dispatch("mouseover", { target: { name: "conversation" } });
    assert.deepEqual(s.closed, []);
    assert.equal(page.added.length, page.removed.length);
});
