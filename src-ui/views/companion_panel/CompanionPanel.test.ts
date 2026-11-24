import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { hooks, loadModule, find, eventTarget, stubGlobals, unchecked, findIn } from "../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../logics/test/hookHarness.ts";
import { flush } from "../../logics/test/bridgeHarness.ts";
import * as status from "../../logics/companion/status.ts";
import type { CompanionStatus } from "../../logics/companion/status.ts";
import type { CompanionBridge } from "../../logics/companion/bridge.ts";
import * as themes from "../../logics/theme/themes.ts";
import type { ThemeSetting } from "../../logics/theme/themes.ts";

const ready: {
    ready: boolean;
    mic: { on: boolean; pending: boolean; blocked?: boolean };
    translation: { on: boolean; pending: boolean };
    language: string;
    theme?: ThemeSetting | null;
    menu: { start: string; stop: string; panel: string; main: string; quit: string };
} = { ready: true, mic: { on: false, pending: false }, translation: { on: true, pending: false }, language: "ja", theme: null,
    menu: { start: "s", stop: "s", panel: "p", main: "m", quit: "q" } };

type Status = typeof ready;

async function setup(context: TestContext, initial: Status = ready) {
    const runtime = hooks(), properties = new Map<string, string>(), requests: string[] = [], removals: string[] = [], languages: string[] = [];
    const callbacks: { changed?: () => void; opened?: () => void } = {};
    let current = initial, hides = 0;
    const window = eventTarget();
    // Unmount before the stubbed window goes: the panel's cleanup removes its key listener.
    context.onTestFinished(() => runtime.unmount());
    stubGlobals(context, { window, document: { documentElement: { style: {
        setProperty: (key: string, value: string) => properties.set(key, value),
        removeProperty: (key: string) => properties.delete(key),
    } } } });
    const i18n = { language: "en", changeLanguage: async (language: string) => { languages.push(language); i18n.language = language; } };
    // Test data: the status carries only the switches the panel shows, and the bridge only what the
    // panel calls.
    const bridge = unchecked<CompanionBridge>({
        status: async () => unchecked<CompanionStatus>(current),
        request: async (action: string) => { requests.push(action); },
        hide: async () => { hides++; },
        onChanged: async (callback: () => void) => { callbacks.changed = callback; return () => removals.push("changed"); },
        onOpened: async (callback: () => void) => { callbacks.opened = callback; return () => removals.push("opened"); },
    });
    const { CompanionPanel } = await loadModule<typeof import("./CompanionPanel.tsx")>(new URL("./CompanionPanel.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t: (key: string) => key, i18n }) },
        "../../logics/companion/bridge.ts": { companionBridge: bridge },
        "../../logics/companion/status.ts": status,
        "../../logics/theme/themes.ts": themes,
    });
    const render = () => runtime.render(CompanionPanel, { bridge });
    render(); await flush(); render();
    return { render, properties, requests, removals, callbacks, languages, window,
        set: (next: Status) => { current = next; }, get hides() { return hides; },
        row: (label: string) => find(render(), node => node.props?.label === label)?.props,
        stateText: () => findIn(render(), node => node.props?.role === "status").props.children[1] };
}

test("the panel shows the switches as the main window reports them, in its language", async context => {
    const s = await setup(context);
    assert.deepEqual(s.languages, ["ja"]);
    assert.equal(s.stateText(), "companion.state_idle");
    assert.equal(s.row("companion.mic").value.on, false);
    assert.equal(s.row("companion.translation").value.on, true);
    assert.equal(s.row("companion.mic").disabled, false);
});

test("a switch whose main switch is greyed out says it needs setup and still asks, so the main window says why (#562)", async context => {
    const s = await setup(context, { ...ready, mic: { on: false, pending: false, blocked: true } } as Status);
    const row = find(s.render(), node => node.props?.label === "companion.mic");
    assert.ok(row && typeof row.type === "function");
    // The row draws no hooks: its button as the panel shows it.
    const button = unchecked<(props: object) => TreeNode>(row.type)(row.props);
    assert.deepEqual([button.props["aria-disabled"], button.props["data-blocked"], button.props.disabled], [true, true, false]);
    assert.equal(findIn(button, node => node.props?.className === "switchValue").props.children, "companion.unavailable");
    button.props.onClick();
    await flush();
    assert.deepEqual(s.requests, ["toggle_mic"]);
    // Not greyed out: no mark.
    const translation = find(s.render(), node => node.props?.label === "companion.translation");
    assert.ok(translation && typeof translation.type === "function");
    assert.equal(unchecked<(props: object) => TreeNode>(translation.type)(translation.props).props["aria-disabled"], undefined);
});

test("a switch asks the main window and changes only when the new state comes back", async context => {
    const s = await setup(context);
    s.row("companion.mic").onClick();
    await flush();
    assert.deepEqual(s.requests, ["toggle_mic"]);
    assert.equal(s.row("companion.mic").value.on, false);
    s.set({ ...ready, mic: { on: true, pending: false } });
    const changed = s.callbacks.changed;
    assert.ok(changed);
    await changed();
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
    const footer = findIn(s.render(), node => node.type === "footer");
    const [open, close] = footer.props.children;
    open.props.onClick();
    close.props.onClick();
    await flush();
    assert.equal(s.hides, 2);
    assert.deepEqual(s.requests, ["open_main"]);
});

test("the panel follows preset and custom themes and clears overrides on the default theme", async context => {
    const s = await setup(context, { ...ready, theme: { preset: "rose", custom: { base: "#261633", accent: "#a47af5" } } });
    const rose = themes.deriveTokens(themes.PRESETS.find(preset => preset.id === "rose")?.colors ?? themes.PRESETS[0].colors);
    assert.equal(s.properties.get("--vox_canvas"), rose["--vox_canvas"]);
    assert.equal(s.properties.get("--primary_600_color"), rose["--primary_600_color"]);
    // Live update to custom colours.
    s.set({ ...ready, theme: { preset: "custom", custom: { base: "#15261c", accent: "#62c98c" } } });
    assert.ok(s.callbacks.changed);
    await s.callbacks.changed();
    s.render();
    assert.equal(s.properties.get("--vox_canvas"), themes.deriveTokens({ base: "#15261c", accent: "#62c98c" })["--vox_canvas"]);
    // Back to Dark Plum: stylesheet defaults apply again.
    s.set({ ...ready, theme: { preset: "dark_plum", custom: { base: "#15261c", accent: "#62c98c" } } });
    await s.callbacks.changed();
    s.render();
    assert.equal(s.properties.size, 0);
});
