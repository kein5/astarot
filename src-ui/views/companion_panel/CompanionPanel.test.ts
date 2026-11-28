import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { readFileSync } from "node:fs";
import { hooks, kitStandIns, loadModule, find, eventTarget, stubGlobals, unchecked, findIn, nodesIn } from "../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../logics/test/hookHarness.ts";
import { flush } from "../../logics/test/bridgeHarness.ts";
import * as status from "../../logics/companion/status.ts";
import type { CompanionStatus } from "../../logics/companion/status.ts";
import type { CompanionBridge } from "../../logics/companion/bridge.ts";
import * as themes from "../../logics/theme/themes.ts";
import type { ThemeSetting } from "../../logics/theme/themes.ts";

// The rows are named as the main screen's switches are (#1235).
const MIC = "main_page.transcription_send", TRANSLATION = "main_page.translation";

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

async function setup(context: TestContext, initial: Status = ready, startup?: ThemeSetting | null) {
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
        // The theme the shell gave the page (#1259); none in a browser.
        "../../logics/theme/startupTheme.ts": { startupTheme: () => startup },
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
    assert.equal(s.row(MIC).value.on, false);
    assert.equal(s.row(TRANSLATION).value.on, true);
    assert.equal(s.row(MIC).disabled, false);
});

test("a switch whose main switch is greyed out says it needs setup and still asks, so the main window says why (#562)", async context => {
    const s = await setup(context, { ...ready, mic: { on: false, pending: false, blocked: true } } as Status);
    const row = find(s.render(), node => node.props?.label === MIC);
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
    const translation = find(s.render(), node => node.props?.label === TRANSLATION);
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
    const mic = draw(MIC), micSwitch = findIn(mic, node => node.type === kitStandIns.Switch).props;
    // The panel focuses its first switch when it opens, the main screen's first (translation): its
    // ref is on the kit's switch, and on no other.
    const firstRow = find(s.render(), node => node.props?.label === TRANSLATION);
    assert.ok(firstRow?.props.buttonRef);
    assert.equal(findIn(draw(TRANSLATION), node => node.type === kitStandIns.Switch).props.ref, firstRow.props.buttonRef);
    assert.equal(micSwitch.ref, undefined);
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
    const translation = draw(TRANSLATION), translationSwitch = findIn(translation, node => node.type === kitStandIns.Switch).props;
    assert.ok(micSwitch.id && translationSwitch.id);
    assert.notEqual(translationSwitch.id, micSwitch.id);
    // The state words beside each switch.
    const stateWords = (row: TreeNode) => findIn(row, node => node.props?.className === "switchValue").props.children;
    assert.deepEqual([stateWords(mic), stateWords(translation)], ["companion.off", "companion.on"]);
    assert.deepEqual([translationSwitch.checked, translationSwitch["aria-busy"], translationSwitch.disabled], [true, true, true]);
    assert.deepEqual([translation.props["data-checked"], translation.props["data-busy"], translation.props["data-disabled"]], [true, true, true]);
    // The main window, the settings window (#1236), and closing the panel.
    const buttons: TreeNode[] = findIn(s.render(), node => node.type === "footer").props.children;
    assert.deepEqual(buttons.map(button => [button.type, button.props.size, button.props.tone, button.props.children]), [
        [kitStandIns.Button, "compact", undefined, "companion.open_main"],
        [kitStandIns.Button, "compact", undefined, "companion.open_settings"],
        [kitStandIns.Button, "compact", undefined, "companion.close"]]);
});

test("a switch asks the main window and changes only when the new state comes back", async context => {
    const s = await setup(context);
    s.row(MIC).onClick();
    await flush();
    assert.deepEqual(s.requests, ["toggle_mic"]);
    assert.equal(s.row(MIC).value.on, false);
    s.set({ ...ready, mic: { on: true, pending: false } });
    const changed = s.callbacks.changed;
    assert.ok(changed);
    await changed();
    assert.equal(s.row(MIC).value.on, true);
    assert.equal(s.stateText(), "companion.state_listening");
});

test("until the backend is ready the switches cannot be used", async context => {
    const s = await setup(context, { ...ready, ready: false });
    assert.equal(s.stateText(), "companion.state_starting");
    assert.equal(s.row(MIC).disabled, true);
    assert.equal(s.row(TRANSLATION).disabled, true);
});

test("Escape and the close button hide the panel; the main window and the settings can be opened from it", async context => {
    const s = await setup(context);
    s.window.dispatch("keydown", { key: "Escape" });
    const footer = findIn(s.render(), node => node.type === "footer");
    const [open, settings, close] = footer.props.children;
    open.props.onClick();
    settings.props.onClick();
    close.props.onClick();
    await flush();
    assert.equal(s.hides, 2);
    // The shell hides the panel itself as it opens a window (companion_request).
    assert.deepEqual(s.requests, ["open_main", "open_settings"]);
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

// #1259: the panel starts in the theme the shell gave it, and keeps it until the main window's
// report carries the theme, which it then follows.
test("the panel keeps the shell's theme until the main window reports one", async context => {
    const midnight = { preset: "midnight", custom: { base: "#14203a", accent: "#6ea8fe" } };
    const s = await setup(context, { ...ready, theme: null }, midnight);
    const tokens = themes.deriveTokens(midnight.custom);
    assert.equal(s.properties.get("--vox_canvas"), tokens["--vox_canvas"]);
    s.set({ ...ready, theme: { preset: "rose", custom: midnight.custom } });
    assert.ok(s.callbacks.changed);
    await s.callbacks.changed();
    s.render();
    const rose = themes.deriveTokens(themes.PRESETS.find(preset => preset.id === "rose")?.colors ?? themes.PRESETS[0].colors);
    assert.equal(s.properties.get("--vox_canvas"), rose["--vox_canvas"]);
});

test("a panel the shell gave the default theme sets nothing until the main window reports one", async context => {
    const s = await setup(context, { ...ready, theme: null }, null);
    assert.equal(s.properties.size, 0);
});

// #1235: the panel mirrors the main screen's feature switches: the same six, in the order the main
// screen lists them, under its names, each asking for its own switch. The main screen's list is
// read from its source, so a switch added there shows up here as missing.
test("the panel lists the main screen's switches in its order and names, and each asks for its own", async context => {
    const source = readFileSync(new URL("../app/main_page/sidebar_section/main_function_switch/MainFunctionSwitch.tsx", import.meta.url), "utf8");
    const listed = [...source.slice(source.indexOf("const switch_items")).matchAll(/switch_id: "([a-z_]+)"/g)].map(match => match[1]);
    assert.deepEqual(status.MAIN_SCREEN_ORDER.map(feature => status.SWITCH_IDS[feature]), listed);
    assert.deepEqual([...status.MAIN_SCREEN_ORDER].sort(), [...status.FEATURES].sort());
    const s = await setup(context, { ...ready, listening: { on: true, pending: false }, tts: { on: false, pending: false, blocked: true } } as Status);
    const rows = nodesIn(s.render()).filter(node => typeof node.props?.label === "string" && typeof node.props?.onClick === "function");
    assert.deepEqual(rows.map(row => row.props.label), listed.map(id => `main_page.${id}`));
    assert.deepEqual(rows.map(row => [row.props.value?.on === true, row.props.value?.blocked === true]),
        [[true, false], [false, false], [true, false], [false, false], [false, true], [false, false]]);
    for (const row of rows) row.props.onClick();
    await flush();
    assert.deepEqual(s.requests, ["toggle_translation", "toggle_mic", "toggle_listening", "toggle_ocr", "toggle_tts", "toggle_rvc"]);
});
