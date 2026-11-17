import assert from "node:assert/strict";
import { test } from "node:test";
import { hooks, loadModule, find, eventTarget, stubGlobals } from "../../logics/test/hookHarness.js";
import { flush } from "../../logics/test/bridgeHarness.js";
import * as status from "../../logics/companion/status.ts";

const ready = { ready: true, mic: { on: false, pending: false }, translation: { on: true, pending: false }, language: "ja",
    menu: { start: "s", stop: "s", panel: "p", main: "m", quit: "q" } };

async function setup(context, initial = ready) {
    const runtime = hooks(), requests = [], removals = [], callbacks = {}, languages = [];
    let current = initial, hides = 0;
    const window = eventTarget();
    // Unmount before the stubbed window goes: the panel's cleanup removes its key listener.
    context.after(() => runtime.unmount());
    stubGlobals(context, { window });
    const i18n = { language: "en", changeLanguage: async language => { languages.push(language); i18n.language = language; } };
    const bridge = {
        status: async () => current,
        request: async action => { requests.push(action); },
        hide: async () => { hides++; },
        onChanged: async callback => { callbacks.changed = callback; return () => removals.push("changed"); },
        onOpened: async callback => { callbacks.opened = callback; return () => removals.push("opened"); },
    };
    const { CompanionPanel } = await loadModule(new URL("./CompanionPanel.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t: key => key, i18n }) },
        "../../logics/companion/bridge.ts": { companionBridge: bridge },
        "../../logics/companion/status.ts": status,
    });
    const render = () => runtime.render(CompanionPanel, { bridge });
    render(); await flush(); render();
    return { render, requests, removals, callbacks, languages, window,
        set: next => { current = next; }, get hides() { return hides; },
        row: label => find(render(), node => node.props?.label === label)?.props,
        stateText: () => find(render(), node => node.props?.role === "status").props.children[1] };
}

test("the panel shows the switches as the main window reports them, in its language", async context => {
    const s = await setup(context);
    assert.deepEqual(s.languages, ["ja"]);
    assert.equal(s.stateText(), "companion.state_idle");
    assert.equal(s.row("companion.mic").value.on, false);
    assert.equal(s.row("companion.translation").value.on, true);
    assert.equal(s.row("companion.mic").disabled, false);
});

test("a switch asks the main window and changes only when the new state comes back", async context => {
    const s = await setup(context);
    s.row("companion.mic").onClick();
    await flush();
    assert.deepEqual(s.requests, ["toggle_mic"]);
    assert.equal(s.row("companion.mic").value.on, false);
    s.set({ ...ready, mic: { on: true, pending: false } });
    await s.callbacks.changed();
    assert.equal(s.row("companion.mic").value.on, true);
    assert.equal(s.stateText(), "companion.state_listening");
});

test("until the backend is ready the switches cannot be used", async context => {
    const s = await setup(context, { ...ready, ready: false });
    assert.equal(s.stateText(), "companion.state_starting");
    assert.equal(s.row("companion.mic").disabled, true);
    assert.equal(s.row("companion.translation").disabled, true);
});

test("Escape and the close button hide the panel; the main window can be opened from it", async context => {
    const s = await setup(context);
    s.window.dispatch("keydown", { key: "Escape" });
    const footer = find(s.render(), node => node.type === "footer");
    const [open, close] = footer.props.children;
    open.props.onClick();
    close.props.onClick();
    await flush();
    assert.equal(s.hides, 2);
    assert.deepEqual(s.requests, ["open_main"]);
});
