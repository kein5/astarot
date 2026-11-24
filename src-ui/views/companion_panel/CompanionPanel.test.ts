import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { hooks, kitStandIns, loadModule, find, eventTarget, stubGlobals, unchecked, findIn } from "../../logics/test/hookHarness.ts";
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
    // The row draws no hooks: its label and switch as the panel shows them.
    const drawn = unchecked<(props: object) => TreeNode>(row.type)(row.props);
    const button = findIn(drawn, node => node.type === kitStandIns.Switch);
    assert.deepEqual([button.props["aria-disabled"], drawn.props["data-blocked"], button.props.disabled], [true, true, false]);
    assert.equal(findIn(drawn, node => node.props?.className === "switchValue").props.children, "companion.unavailable");
    button.props.onClick();
    await flush();
    assert.deepEqual(s.requests, ["toggle_mic"]);
    // Not greyed out: no mark.
    const translation = find(s.render(), node => node.props?.label === "companion.translation");
    assert.ok(translation && typeof translation.type === "function");
    const shown = unchecked<(props: object) => TreeNode>(translation.type)(translation.props);
    assert.equal(findIn(shown, node => node.type === kitStandIns.Switch).props["aria-disabled"], undefined);
    assert.equal(shown.props["data-blocked"], false);
});

test("each row is the label of the kit's switch, named by the row's words; the footer's buttons are the kit's", async context => {
    const s = await setup(context, { ...ready, translation: { on: true, pending: true } });
    const draw = (label: string) => {
        const row = find(s.render(), node => node.props?.label === label);
        assert.ok(row && typeof row.type === "function");
        return unchecked<(props: object) => TreeNode>(row.type)(row.props);
    };
    const mic = draw("companion.mic"), micSwitch = findIn(mic, node => node.type === kitStandIns.Switch).props;
    // The panel focuses its first switch when it opens: its ref is on the kit's switch.
    const micRow = find(s.render(), node => node.props?.label === "companion.mic");
    assert.ok(micRow?.props.buttonRef);
    assert.equal(micSwitch.ref, micRow.props.buttonRef);
    // Pressing anywhere on the row presses the switch: the row is its label.
    assert.equal(mic.type, "label");
    assert.equal(mic.props.htmlFor, micSwitch.id);
    const words = (row: TreeNode) => [row.props.children].flat().filter(child => child?.type === "span").map(child => child.props.id);
    assert.equal(micSwitch["aria-labelledby"], words(mic).join(" "), "what it switches and its state, as the row's button was named");
    assert.deepEqual([mic.props.children].flat().filter(child => child?.type === "span").map(child => child.props["aria-hidden"]), ["true", "true"],
        "read only as the switch's name");
    assert.deepEqual([micSwitch.checked, micSwitch["aria-busy"], micSwitch.disabled], [false, false, false]);
    assert.deepEqual([mic.props["data-checked"], mic.props["data-busy"], mic.props["data-disabled"]], [false, false, false]);
    // A switch that waits for the main window: busy and not pressable, its row dimmed.
    const translation = draw("companion.translation"), translationSwitch = findIn(translation, node => node.type === kitStandIns.Switch).props;
    assert.ok(micSwitch.id && translationSwitch.id);
    assert.notEqual(translationSwitch.id, micSwitch.id);
    // The state words beside each switch.
    const stateWords = (row: TreeNode) => findIn(row, node => node.props?.className === "switchValue").props.children;
    assert.deepEqual([stateWords(mic), stateWords(translation)], ["companion.off", "companion.on"]);
    assert.deepEqual([translationSwitch.checked, translationSwitch["aria-busy"], translationSwitch.disabled], [true, true, true]);
    assert.deepEqual([translation.props["data-checked"], translation.props["data-busy"], translation.props["data-disabled"]], [true, true, true]);
    const [open, close] = findIn(s.render(), node => node.type === "footer").props.children;
    assert.deepEqual([open.type, open.props.size, open.props.tone, open.props.children, close.type, close.props.size, close.props.tone, close.props.children],
        [kitStandIns.Button, "compact", undefined, "companion.open_main", kitStandIns.Button, "compact", undefined, "companion.close"]);
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
