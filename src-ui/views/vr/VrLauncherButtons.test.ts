import assert from "node:assert/strict";
import { test, vi } from "vitest";
import type { TestContext } from "vitest";
import { draw, drawWith, find, findIn, hooks, loadModule, stubGlobals } from "../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../logics/test/hookHarness.ts";
import * as switchBlocks from "../../logics/main/switchBlocks.ts";
import { readFileSync } from "node:fs";
import { LAUNCHER_BUTTON, LAUNCHER_PADDING, launcherContentWidth } from "./launcherSizes.ts";

// The VR launcher: four function switches, then the buttons that open the log and the temporary
// windows. Every button carries its tooltip (VrTooltipButton, a stand-in that keeps its props).
// VrLauncher.test.ts covers the log button's long press and the switches' blocks; this file covers
// what each button says and does in each state, and the intro.

type Status = { state: string; data: unknown };
type Block = { reason: string; action: string };
interface Options {
    windows?: { log: boolean; popup: "language" | "settings" | "io_flow" | "windows" | null };
    intro?: string;
    outOfView?: unknown;
    configOpen?: boolean;
    statuses?: Record<string, Status>;
    blocks?: Record<string, Block>;
    // Mic input's microphone waits to open (#1300), on this system (#1314).
    micWaiting?: boolean;
    system?: "windows" | "linux";
    // The text to speech switch and the stop, as the main window shows them (#1314).
    voice?: { tts: { on: boolean; pending: boolean }; stop: { offered: boolean; phase: "idle" | "stopping" | "stopped" } };
}

const NO_VOICE = { tts: { on: false, pending: false }, stop: { offered: false, phase: "idle" as const } };

// The launchers a test draws, unmounted together before the globals go back: their clean-up stops
// listening on them.
const drawnByTest = new WeakMap<TestContext, { unmount: () => void }[]>();

async function launcher(context: TestContext, { windows = { log: false, popup: null }, intro = "idle", outOfView = false, configOpen = false,
    statuses = {}, blocks = {}, micWaiting = false, system = "windows", voice = NO_VOICE }: Options = {}) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const runtime = hooks();
    let drawn = drawnByTest.get(context);
    if (!drawn) {
        const list: { unmount: () => void }[] = [];
        drawn = list;
        drawnByTest.set(context, list);
        context.onTestFinished(() => { for (const each of list) each.unmount(); });
    }
    drawn.push(runtime);
    const added: [string, string, unknown, unknown][] = [], removed: [string, string, unknown, unknown][] = [];
    const target = (name: string) => ({
        addEventListener: (type: string, fn: unknown, capture?: unknown) => { added.push([name, type, fn, capture]); },
        removeEventListener: (type: string, fn: unknown, capture?: unknown) => { removed.push([name, type, fn, capture]); },
    });
    stubGlobals(context, { document: target("document"), window: target("window") });
    const calls: unknown[][] = [];
    const record = (name: string) => (...args: unknown[]) => { calls.push([name, ...args]); };
    const status = (name: string) => statuses[name] ?? { state: "ok", data: false };
    const { VrLauncher } = await loadModule<typeof import("./VrLauncher.tsx")>(new URL("./VrLauncher.tsx", import.meta.url), runtime, {
        "@logics_common": {
            useIsOpenedConfigPage: () => ({ currentIsOpenedConfigPage: { data: configOpen } }),
            useVrPanelLogOutOfView: () => ({ currentVrPanelLogOutOfView: { data: outOfView } }),
            useVrPanelLauncherIntro: () => ({ currentVrPanelLauncherIntro: { data: intro } }),
        },
        "@logics_main": { useMainFunction: () => ({
            toggleTranslation: record("translation"), currentTranslationStatus: status("translation"),
            toggleTranscriptionSend: record("transcription_send"), currentTranscriptionSendStatus: status("transcription_send"),
            toggleTranscriptionReceive: record("transcription_receive"), currentTranscriptionReceiveStatus: status("transcription_receive"),
            toggleOcrCapture: record("ocr"), currentOcrCaptureStatus: status("ocr"),
        }) },
        "@store": { useStore_SwitchBlocks: () => ({ currentSwitchBlocks: { data: blocks } }),
            useStore_MicCaptureWaiting: () => ({ currentMicCaptureWaiting: { data: micWaiting } }),
            useStore_VrVoiceControls: () => ({ currentVrVoiceControls: { data: voice } }) },
        "../../logics/common/vrPanelSend": { sendToMain: async (...args: unknown[]) => { calls.push(["sendToMain", ...args]); } },
        "./VrLauncherIcons": { StopSvg: "stop-svg", WindowsSvg: "windows-svg" },
        "../../logics/main/switchBlocks": switchBlocks,
        "../../logics/transcription/micCaptureWait": { micWaitSystem: () => system },
        "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython: record("send") }) },
        "@images/brand/icon-small.svg": "icon.svg",
        "@images/brand/logo.svg": "logo.svg",
        "./VrTooltip": { VrTooltipButton: "tip-button" },
    });
    const tree = runtime.render(VrLauncher, { windows, toggleLog: record("toggleLog"), openLog: record("openLog"), togglePopup: record("togglePopup") });
    const group = (label: string): TreeNode[] => findIn(tree, node => node.props["aria-label"] === label, label).props.children;
    // The window buttons hold state of their own: each is drawn alone, from a fresh start.
    const windowButtons = group("vr_panel.tooltip.windows_group");
    return { runtime, tree, calls, added, removed,
        functions: group("vr_panel.tooltip.functions_group").map(node => draw(node)),
        stop: draw(findIn(tree, node => node.props["aria-label"] === "vr_panel.tooltip.stop_group", "stop").props.children),
        windowNodes: windowButtons,
        windowButton: (index: number) => { runtime.remount(); return drawWith(runtime, windowButtons[index]); },
        // The same window button drawn again, keeping its state.
        again: (index: number) => drawWith(runtime, windowButtons[index]),
    };
}

const classesOf = (node: TreeNode) => String(node.props.className ?? "").split(" ").filter(Boolean);
const tipOf = (button: TreeNode) => ({ label: button.props["aria-label"], pressed: button.props["aria-pressed"], disabled: button.props["aria-disabled"],
    busy: button.props["aria-busy"], title: button.props.tipTitle, state: button.props.tipState, help: button.props.tipHelp, force: button.props.tipForce });
// The mark on a switch (what it waits for), as its path, or null.
const markOf = (button: TreeNode) => {
    const mark = find(button, node => node.type === "span");
    if (!mark) return null;
    assert.equal(mark.props["aria-hidden"], "true");
    return findIn(mark, node => node.type === "path").props.d;
};

test("the intro shows ASTAROT's mark and logo while it plays, and the launcher waits before it", async context => {
    const playing = await launcher(context, { intro: "playing" });
    assert.deepEqual(playing.tree.props.style, { "--intro-logo": 'url("logo.svg")' });
    const icon = findIn(playing.tree, node => node.type === "img");
    assert.deepEqual([icon.props.src, icon.props.alt, icon.props["aria-hidden"]], ["icon.svg", "", "true"]);
    const logo = findIn(playing.tree, node => classesOf(node).includes("intro_logo"));
    assert.equal(logo.props["aria-hidden"], "true");
    const container = (tree: TreeNode): TreeNode => tree.props.children[1];
    assert.deepEqual(classesOf(container(playing.tree)).slice(1), ["is_intro_playing"]);
    for (const intro of ["pending", "idle"]) {
        const view = await launcher(context, { intro });
        assert.equal(find(view.tree, node => node.type === "img"), null, intro);
        assert.equal(find(view.tree, node => classesOf(node).includes("intro_logo")), null, intro);
        assert.deepEqual(classesOf(container(view.tree)).slice(1), intro === "pending" ? ["is_intro_pending"] : []);
    }
});

// #1248: the launcher's buttons fit its band. Wider content is pushed together, so neighbours
// overlap and the last button is cut at the band's edge (the eighth button, the inputs and
// outputs window's, had been added to a band sized for seven).
test("the launcher's buttons fit inside its band, which is the launcher region's width", async context => {
    const view = await launcher(context);
    // Five switches and the stop with no divider between them, then the log and the windows' button (#1314).
    const groups = [view.functions.length, 1, view.windowNodes.length];
    assert.deepEqual(groups, [5, 1, 2]);
    const layout = JSON.parse(readFileSync(new URL("./vr_layout.json", import.meta.url), "utf8"));
    const band: number = layout.regions.launcher[2];
    const rust = readFileSync(new URL("../../../native/vr-overlay/src/layout.rs", import.meta.url), "utf8");
    assert.match(rust, new RegExp(`pub const LAUNCHER_WIDTH_PX: u32 = ${band};`));
    assert.ok(launcherContentWidth(groups, 1) <= band, `${launcherContentWidth(groups, 1)} px of buttons in a ${band} px band`);
    // One more button would not fit: the band has no room to hide a mistake in.
    assert.ok(launcherContentWidth([5, 1, 3], 1) > band);
    assert.ok(launcherContentWidth([4, 5]) > band);
    // The buttons fit the band's height with its padding.
    assert.ok(LAUNCHER_BUTTON.height + 2 * LAUNCHER_PADDING <= layout.regions.launcher[3]);
});

test("each switch is named for its function, with a tooltip that says what pressing does", async context => {
    const view = await launcher(context, { statuses: { transcription_send: { state: "ok", data: true } } });
    assert.deepEqual(view.functions.map(tipOf), [
        { label: "main_page.translation", pressed: false, disabled: undefined, busy: undefined, title: "vr_panel.tooltip.translate", state: "vr_panel.tooltip.state_off",
            help: "vr_panel.tooltip.enable", force: false },
        { label: "main_page.transcription_send", pressed: true, disabled: undefined, busy: undefined, title: "vr_panel.tooltip.microphone", state: "vr_panel.tooltip.state_on",
            help: "vr_panel.tooltip.disable", force: false },
        { label: "main_page.transcription_receive", pressed: false, disabled: undefined, busy: undefined, title: "vr_panel.tooltip.listen", state: "vr_panel.tooltip.state_off",
            help: "vr_panel.tooltip.enable", force: false },
        { label: "main_page.ocr", pressed: false, disabled: undefined, busy: undefined, title: "vr_panel.tooltip.chat_detect", state: "vr_panel.tooltip.state_off",
            help: "vr_panel.tooltip.enable", force: false },
        { label: "main_page.tts", pressed: false, disabled: undefined, busy: undefined, title: "vr_panel.tooltip.tts", state: "vr_panel.tooltip.state_off",
            help: "vr_panel.tooltip.enable", force: false },
    ]);
    assert.deepEqual(view.functions.map(button => classesOf(button).includes("is_on")), [false, true, false, false, false]);
    assert.deepEqual(view.functions.map(markOf), [null, null, null, null, null]);
    assert.ok(view.functions.every(button => findIn(button, node => typeof node.type === "function").props["aria-hidden"] === "true"));
    assert.equal(new Set(view.functions.map(button => findIn(button, node => typeof node.type === "function").type)).size, 5, "each has its own icon");
    for (const button of view.functions) button.props.onClick();
    // Text to speech asks the main window to press its own switch (#1314).
    assert.deepEqual(view.calls, [["translation"], ["transcription_send"], ["transcription_receive"], ["ocr"], ["sendToMain", "vr-panel-voice", "toggle_tts"]]);
    // Only true is on.
    const odd = await launcher(context, { statuses: { translation: { state: "ok", data: "true" } } });
    assert.deepEqual([odd.functions[0].props.tipState, odd.functions[0].props["aria-pressed"]], ["vr_panel.tooltip.state_off", false]);
});

test("a switch that is changing says so, is marked, and cannot be pressed again", async context => {
    const view = await launcher(context, { statuses: { translation: { state: "pending", data: true } } });
    const [translation, microphone] = view.functions;
    assert.deepEqual(tipOf(translation), { label: "main_page.translation", pressed: true, disabled: true, busy: true, title: "vr_panel.tooltip.translate",
        state: "vr_panel.tooltip.state_on · vr_panel.settings.changing_short", help: "vr_panel.tooltip.busy_help", force: false });
    assert.ok(classesOf(translation).includes("is_pending"));
    assert.equal(classesOf(translation).includes("is_disabled"), false);
    assert.equal(classesOf(microphone).includes("is_pending"), false);
    translation.props.onClick();
    assert.deepEqual(view.calls, []);
    assert.ok(markOf(translation));
});

test("while the settings page is open, every switch is locked, says why, and is marked with a lock", async context => {
    const view = await launcher(context, { configOpen: true, statuses: { ocr: { state: "pending", data: false } },
        blocks: { translation: { reason: "translation_model", action: "translation" } } });
    for (const button of view.functions) {
        assert.equal(button.props.tipState.split(" · ")[1], "vr_panel.tooltip.config_open");
        assert.deepEqual([button.props["aria-disabled"], button.props.tipHelp, button.props.tipForce], [true, "vr_panel.locked_by_config_page", false]);
        assert.ok(classesOf(button).includes("is_disabled"));
        assert.equal(classesOf(button).includes("is_blocked"), false);
        button.props.onClick();
    }
    assert.deepEqual(view.calls, []);
    // The lock mark is the same for all, a block or a wait under it does not show.
    assert.equal(new Set(view.functions.map(markOf)).size, 1);
    assert.deepEqual([view.functions[3].props["aria-busy"], view.functions[3].props.tipState], [true, "vr_panel.tooltip.state_off · vr_panel.tooltip.config_open"]);
});

// #1300 (decided on 2026-11-28): while Mic input's microphone waits to open, as Windows' question on
// the desktop holds it, the microphone's tooltip says so even with the tooltips off: there is nowhere
// else in VR to read it. The switch stays as it is and can still be turned off. A lock or a missing
// setup says its own. The hint is the panel's own short text, which fits the VR tooltip, worded for
// the system (#1314, V-1 and M-4; VrTooltipText.test.ts checks its length).
test("while Mic input's microphone waits to open, its button says Windows may be asking on the desktop", async context => {
    const view = await launcher(context, { micWaiting: true, statuses: { transcription_send: { state: "ok", data: true } } });
    const [translation, microphone] = view.functions;
    assert.deepEqual(tipOf(microphone), { label: "main_page.transcription_send", pressed: true, disabled: undefined, busy: undefined,
        title: "vr_panel.tooltip.microphone", state: "vr_panel.tooltip.state_on", help: "vr_panel.mic_wait.windows", force: true });
    const linux = await launcher(context, { micWaiting: true, system: "linux", statuses: { transcription_send: { state: "ok", data: true } } });
    assert.deepEqual([linux.functions[1].props.tipHelp, linux.functions[1].props.tipForce], ["vr_panel.mic_wait.linux", true]);
    assert.ok(markOf(microphone), "marked as waiting");
    assert.deepEqual([translation.props.tipHelp, translation.props.tipForce], ["vr_panel.tooltip.enable", false]);
    microphone.props.onClick();
    assert.deepEqual(view.calls, [["transcription_send"]]);
    const locked = await launcher(context, { micWaiting: true, configOpen: true });
    assert.deepEqual([locked.functions[1].props.tipHelp, locked.functions[1].props.tipForce], ["vr_panel.locked_by_config_page", false]);
});

test("the lock, the wait and the missing setup each have a mark of their own", async context => {
    const locked = await launcher(context, { configOpen: true });
    const pending = await launcher(context, { statuses: { translation: { state: "pending", data: false } } });
    const blocked = await launcher(context, { blocks: { translation: { reason: "translation_model", action: "translation" } } });
    const marks = [markOf(locked.functions[0]), markOf(pending.functions[0]), markOf(blocked.functions[0])];
    assert.ok(marks.every(mark => typeof mark === "string" && /^M\d/.test(mark)), marks.join("\n"));
    assert.equal(new Set(marks).size, 3);
    // A blocked switch that is not changing says only that it is blocked.
    assert.equal(blocked.functions[0].props.tipState, "vr_panel.tooltip.state_off · vr_panel.switch_blocked.state");
    assert.deepEqual([blocked.functions[0].props["aria-busy"], pending.functions[0].props["aria-busy"]], [undefined, true]);
});

test("the log button shows whether the log is open, and closes it when pressed", async context => {
    const closed = await launcher(context);
    const log = closed.windowButton(0);
    assert.deepEqual(tipOf(log), { label: "vr_panel.window_log", pressed: false, disabled: undefined, busy: undefined, title: "vr_panel.window_log",
        state: "vr_panel.tooltip.hidden", help: "vr_panel.tooltip.log_open_help", force: true });
    const open = await launcher(context, { windows: { log: true, popup: null } });
    const shown = open.windowButton(0);
    assert.deepEqual([shown.props["aria-pressed"], shown.props.tipState, shown.props.tipHelp, classesOf(shown).includes("is_on")],
        [true, "vr_panel.tooltip.open", "vr_panel.tooltip.log_close_help", true]);
    assert.equal(classesOf(shown).includes("is_attention"), false);
    shown.props.onClick();
    assert.deepEqual(open.calls, [["toggleLog"]]);
});

test("a log that is open but out of sight is recalled, not closed, and says so", async context => {
    const view = await launcher(context, { windows: { log: true, popup: null }, outOfView: true });
    const log = view.windowButton(0);
    assert.deepEqual(tipOf(log), { label: "vr_panel.recall_log", pressed: true, disabled: undefined, busy: undefined, title: "vr_panel.window_log",
        state: "vr_panel.tooltip.lost", help: "vr_panel.tooltip.click_recall", force: true });
    assert.ok(classesOf(log).includes("is_attention"));
    log.props.onClick();
    assert.deepEqual(view.calls, [["send", "/run/vr_panel_recall_log"]]);
    // Out of sight only counts while the log is open, and only when the main window says true.
    for (const options of [{ windows: { log: false, popup: null }, outOfView: true }, { windows: { log: true, popup: null }, outOfView: "true" }] as const) {
        const other = await launcher(context, options);
        const button = other.windowButton(0);
        assert.equal(button.props["aria-label"], "vr_panel.window_log", JSON.stringify(options));
        button.props.onClick();
        assert.deepEqual(other.calls, [["toggleLog"]]);
    }
});

// #1314 (V-4): the language, inputs and outputs, and VR settings windows share one button, which
// opens their list; while one of them (or the list) is open, the button closes it.
test("the windows' button opens their list, and closes whichever of them is open", async context => {
    const closed = await launcher(context);
    assert.equal(closed.windowNodes.length, 2);
    const button = closed.windowButton(1);
    assert.deepEqual(tipOf(button), { label: "vr_panel.window_more", pressed: false, disabled: undefined, busy: undefined, title: "vr_panel.window_more",
        state: "vr_panel.tooltip.hidden", help: "vr_panel.tooltip.open_view", force: false });
    button.props.onClick();
    assert.deepEqual(closed.calls, [["togglePopup", "windows"]]);
    for (const popup of ["windows", "language", "io_flow", "settings"] as const) {
        const open = await launcher(context, { windows: { log: false, popup } });
        const shown = open.windowButton(1);
        assert.deepEqual([shown.props["aria-pressed"], shown.props.tipState, shown.props.tipHelp, classesOf(shown).includes("is_on")],
            [true, "vr_panel.tooltip.open", "vr_panel.tooltip.close_view", true], popup);
        shown.props.onClick();
        assert.deepEqual(open.calls, [["togglePopup", popup]], popup);
    }
});

// #1314 (V-4): the stop of the main window's top bar, on the launcher. It is offered while
// something is read aloud, answers its press, and is never locked.
test("the stop asks the main window to stop while something is read aloud, and says when there is nothing", async context => {
    const idle = await launcher(context);
    assert.deepEqual(tipOf(idle.stop), { label: "voice_ui.topbar_stop", pressed: undefined, disabled: true, busy: undefined, title: "voice_ui.topbar_stop",
        state: "vr_panel.tooltip.stop_idle", help: "vr_panel.tooltip.stop_idle_help", force: undefined });
    assert.ok(classesOf(idle.stop).includes("stop_button") && classesOf(idle.stop).includes("is_idle"));
    idle.stop.props.onClick();
    assert.deepEqual(idle.calls, []);
    const reading = await launcher(context, { voice: { tts: { on: true, pending: false }, stop: { offered: true, phase: "idle" } } });
    assert.deepEqual([reading.stop.props["aria-disabled"], reading.stop.props.tipState, reading.stop.props.tipHelp], [undefined, "", "vr_panel.tooltip.stop_help"]);
    assert.equal(classesOf(reading.stop).includes("is_idle"), false);
    reading.stop.props.onClick();
    assert.deepEqual(reading.calls, [["sendToMain", "vr-panel-voice", "stop"]]);
    for (const [phase, words] of [["stopping", "voice_ui.topbar_stopping"], ["stopped", "voice_ui.topbar_stopped"]] as const) {
        const answered = await launcher(context, { voice: { tts: { on: true, pending: false }, stop: { offered: true, phase } } });
        assert.deepEqual([answered.stop.props.tipState, answered.stop.props["aria-disabled"]], [words, true], phase);
        answered.stop.props.onClick();
        assert.deepEqual(answered.calls, [], phase);
    }
    // The settings page locks the switches, not the stop.
    const locked = await launcher(context, { configOpen: true, voice: { tts: { on: true, pending: false }, stop: { offered: true, phase: "idle" } } });
    locked.stop.props.onClick();
    assert.deepEqual(locked.calls, [["sendToMain", "vr-panel-voice", "stop"]]);
});

test("the text to speech switch shows the main window's switch, and its missing setup", async context => {
    const on = await launcher(context, { voice: { tts: { on: true, pending: false }, stop: { offered: false, phase: "idle" } } });
    assert.deepEqual([on.functions[4].props["aria-pressed"], on.functions[4].props.tipState], [true, "vr_panel.tooltip.state_on"]);
    const pending = await launcher(context, { voice: { tts: { on: false, pending: true }, stop: { offered: false, phase: "idle" } } });
    assert.deepEqual([pending.functions[4].props["aria-busy"], pending.functions[4].props.tipHelp], [true, "vr_panel.tooltip.busy_help"]);
    pending.functions[4].props.onClick();
    assert.deepEqual(pending.calls, []);
    for (const reason of ["tts_source", "tts_model"]) {
        const blocked = await launcher(context, { blocks: { tts: { reason, action: "tts" } } });
        assert.deepEqual([blocked.functions[4].props.tipHelp, blocked.functions[4].props.tipForce], [`vr_panel.switch_blocked.${reason}`, true]);
        blocked.functions[4].props.onClick();
        assert.deepEqual(blocked.calls, [], reason);
    }
});

test("a long press on a temporary window's button does not hold: only the log's button has one", async context => {
    const view = await launcher(context);
    const windows = view.windowButton(1);
    windows.props.onMouseDown({ button: 0 });
    assert.equal(view.again(1).props.tipState, "vr_panel.tooltip.hidden");
    vi.advanceTimersByTime(1000);
    view.again(1).props.onClick();
    assert.deepEqual(view.calls, [["togglePopup", "windows"]]);
});

test("while the log's button is held, it says so; once the hold has fired, it stops saying so", async context => {
    const view = await launcher(context);
    assert.equal(view.windowButton(0).props.tipState, "vr_panel.tooltip.hidden");
    view.again(0).props.onMouseDown({ button: 0 });
    const held = view.again(0);
    assert.deepEqual([held.props.tipState, held.props.tipHelp, classesOf(held).includes("is_holding")],
        ["vr_panel.tooltip.holding", "vr_panel.tooltip.holding_help", true]);
    vi.advanceTimersByTime(600);
    assert.deepEqual(view.calls, [["openLog"], ["send", "/run/vr_panel_recall_log"]]);
    // Still pressed, but the hold is over.
    assert.equal(view.again(0).props.tipState, "vr_panel.tooltip.hidden");
});

test("a second press starts the hold again from its own start", async context => {
    const view = await launcher(context);
    view.windowButton(0).props.onMouseDown({ button: 0 });
    vi.advanceTimersByTime(300);
    view.again(0).props.onMouseDown({ button: 0 });
    vi.advanceTimersByTime(300);
    assert.deepEqual(view.calls, []);
    vi.advanceTimersByTime(300);
    assert.deepEqual(view.calls, [["openLog"], ["send", "/run/vr_panel_recall_log"]]);
});

test("presses from the keyboard, with no hold, each open or close the log", async context => {
    const view = await launcher(context);
    view.windowButton(0).props.onClick();
    view.again(0).props.onClick();
    assert.deepEqual(view.calls, [["toggleLog"], ["toggleLog"]]);
});

test("the hold is stopped by a release or a cancel anywhere: it listens in the capture phase where an overlay can swallow them", async context => {
    const view = await launcher(context);
    view.windowButton(0);
    assert.deepEqual(view.added.map(([target, type, , capture]) => [target, type, capture]), [
        ["document", "mouseup", true], ["document", "mouseleave", undefined], ["document", "pointercancel", true], ["window", "blur", undefined],
    ]);
    view.runtime.unmount();
    assert.deepEqual(view.removed, view.added);
});
