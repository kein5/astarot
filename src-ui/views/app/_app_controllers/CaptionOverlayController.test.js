import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { hooks, loadModule } from "../../../logics/test/hookHarness.js";
import { flush } from "../../../logics/test/bridgeHarness.js";
import * as lines from "../../../logics/captionOverlay/lines.ts";
import * as ioFlow from "../../../logics/flow/ioFlow.ts";
import * as flowText from "../../../logics/flow/flowText.ts";
import * as adjust from "../../../logics/captionOverlay/adjust.ts";
import * as windowFailures from "../../../logics/common/windowFailures.ts";

const t = (key, options) => options ? `${key}:${JSON.stringify(options)}` : key;

const row = (id, category, message, status = "ok") => ({
    id, category, status, messages: { original: { message, transliteration: [] }, translations: [] },
});

async function setup(context, { supported = true, fail = () => null } = {}) {
    vi.useFakeTimers({ toFake: ["Date"], now: 1_000_000 });
    const runtime = hooks(), calls = [], notices = [];
    const state = { ready: true, enabled: false, rows: [], onlyTranslated: false,
        settings: { position: "bottom", font_size: 28, display_duration: 6, opacity: 0.6 },
        placement: { x: null, y: null },
        flow: { desktop: false, count: 1 }, traces: [], map: null };
    const invoke = async (command, args) => {
        calls.push([command, args]);
        const failure = fail(command, args);
        if (failure) throw failure;
        return command === "caption_overlay_supported" ? supported : undefined;
    };
    const listeners = new Map(), saved = [];
    const listen = async (name, callback) => {
        listeners.set(name, callback);
        return () => listeners.delete(name);
    };
    const { CaptionOverlayController } = await loadModule(new URL("./CaptionOverlayController.tsx", import.meta.url), runtime, {
        "@tauri-apps/api/core": { invoke },
        "@tauri-apps/api/event": { listen },
        "../../../logics/captionOverlay/adjust": adjust,
        "@store": { useStore_MessageLogs: () => ({ currentMessageLogs: { data: state.rows } }),
            useStore_SpeakerNames: () => ({ currentSpeakerNames: { data: state.speakerNames ?? {} } }) },
        "@useI18n": { useI18n: () => ({ t }) },
        "@logics_common": { useIsBackendReady: () => ({ currentIsBackendReady: { data: state.ready } }),
            useNotificationStatus: () => ({ showNotification_Error: (message, options) => notices.push([message, options]) }) },
        "../../../logics/common/windowFailures.ts": windowFailures,
        "@logics_configs": {
            useExperimentalFeature: id => id === "tray_companion" && state.companion === true,
            useAppearance: () => ({ currentSelectedFontFamily: { data: "Yu Gothic UI" } }),
            useVr: () => ({
                currentIsEnabledOverlayDesktop: { data: state.enabled },
                currentOverlayDesktopSettings: { data: state.settings },
                currentOverlayShowOnlyTranslatedMessages: { data: state.onlyTranslated },
                currentIoFlowOverlaySettings: { data: state.flow },
                currentOverlayDesktopPlacement: { data: state.placement },
                setOverlayDesktopSettings: value => saved.push(["settings", value]),
                setOverlayDesktopPlacement: value => saved.push(["placement", value]),
            }),
        },
        "../../../logics/captionOverlay/lines": lines,
        "../../../logics/flow/useIoFlow": { useIoFlow: () => ({ currentIoFlow: { data: state.map }, currentIoTraces: { data: state.traces } }) },
        "../../../logics/flow/ioFlow.ts": ioFlow,
        "../../../logics/flow/flowText.ts": flowText,
    });
    const render = async () => {
        runtime.render(CaptionOverlayController); await flush();
        runtime.render(CaptionOverlayController); await flush();
    };
    await render();
    context.onTestFinished(() => runtime.unmount());
    return { state, calls, notices, render, listeners, saved, runtime, tick: ms => vi.advanceTimersByTime(ms),
        of: name => calls.filter(([command]) => command === name).map(([, args]) => args) };
}

test("the window opens only while the setting is on, and closes when it is turned off", async context => {
    const s = await setup(context);
    assert.deepEqual(s.of("caption_overlay_set"), [{ open: false, position: "bottom", placement: null }]);
    assert.deepEqual(s.of("caption_overlay_update"), []);
    s.state.enabled = true;
    await s.render();
    assert.deepEqual(s.of("caption_overlay_set").at(-1), { open: true, position: "bottom", placement: null });
    s.state.settings = { ...s.state.settings, position: "top" };
    await s.render();
    assert.deepEqual(s.of("caption_overlay_set").at(-1), { open: true, position: "top", placement: null });
    s.state.enabled = false;
    await s.render();
    assert.deepEqual(s.of("caption_overlay_set").at(-1), { open: false, position: "top", placement: null });
});

test("the tray companion (an experimental feature) shows the captions with the setting off", async context => {
    const s = await setup(context);
    s.state.companion = true;
    await s.render();
    assert.deepEqual(s.of("caption_overlay_set").at(-1), { open: true, position: "bottom", placement: null });
    s.state.ready = false;
    await s.render();
    assert.deepEqual(s.of("caption_overlay_set").at(-1), { open: false, position: "bottom", placement: null });
});

test("the backend not being ready keeps the window closed", async context => {
    const s = await setup(context);
    s.state.enabled = true; s.state.ready = false;
    await s.render();
    assert.equal(s.of("caption_overlay_set").every(args => args.open === false), true);
    assert.deepEqual(s.of("caption_overlay_update"), []);
});

test("where the overlay is not supported, nothing is opened or sent", async context => {
    const s = await setup(context, { supported: false });
    s.state.enabled = true; s.state.rows = [row(1, "sent", "こんにちは")];
    await s.render();
    assert.deepEqual(s.calls.map(([command]) => command), ["caption_overlay_supported"]);
});

test("a name given to a voice goes to the window, and the line keeps its display time", async context => {
    // #447: naming a voice redraws the captions; the words did not change, so the time stays.
    const s = await setup(context);
    s.state.enabled = true;
    await s.render();
    s.state.rows = [{ ...row("heard", "received", "やあ"), speakers: ["A"], realtime: { namespace: "one" } }];
    await s.render();
    const before = s.of("caption_overlay_update").at(-1).snapshot.lines[0];
    assert.equal(before.speaker_names, undefined);
    s.tick(1000);
    s.state.speakerNames = { one: { A: "ミカ" } };
    await s.render();
    const after = s.of("caption_overlay_update").at(-1).snapshot.lines[0];
    assert.deepEqual(after.speaker_names, ["ミカ"]);
    assert.equal(after.until, before.until);
});

test("rows already in the log are not shown; new rows get the display time and carry the look", async context => {
    const s = await setup(context);
    s.state.rows = [row(1, "sent", "前からあった行"), row(2, "system", "保存しました")];
    s.state.enabled = true;
    await s.render();
    const first = s.of("caption_overlay_update").at(-1).snapshot;
    assert.deepEqual(first.lines.map(line => [line.id, line.until]), [["1", 0]]);
    assert.deepEqual([first.position, first.font_size, first.opacity, first.font_family], ["bottom", 28, 0.6, "Yu Gothic UI"]);

    s.tick(5000);
    s.state.rows = [...s.state.rows, row(3, "received", "Hello")];
    await s.render();
    const second = s.of("caption_overlay_update").at(-1).snapshot;
    assert.deepEqual(second.lines.map(line => [line.id, line.kind, line.text, line.until]),
        [["1", "sent", "前からあった行", 0], ["3", "received", "Hello", 1_000_000 + 5000 + 6000]]);

    // Turning the overlay off and on again treats the log as history once more.
    s.state.enabled = false;
    await s.render();
    s.state.enabled = true;
    await s.render();
    assert.deepEqual(s.of("caption_overlay_update").at(-1).snapshot.lines.map(line => line.until), [0, 0]);
});

const trace = (id, input, at) => ({ id, input, text: `text ${id}`, translation: "", origin: "send", stages: {},
    outputs: { chatbox: { state: "sent", at_ms: at } } });

test("the flow strip opens the window without captions, and lists the newest inputs up to the setting", async context => {
    const s = await setup(context);
    s.state.rows = [row(1, "sent", "字幕にはしない")];
    s.state.traces = [trace("a", "voice", 300), trace("b", "chat", 120)];
    s.state.map = { conversion_round_trip_ms: 31 };
    s.state.flow = { desktop: true, count: 1 };
    await s.render();
    assert.deepEqual(s.of("caption_overlay_set").at(-1), { open: true, position: "bottom", placement: null });
    let snapshot = s.of("caption_overlay_update").at(-1).snapshot;
    assert.deepEqual(snapshot.lines, [], "captions stay off");
    assert.deepEqual(snapshot.flow.map(item => [item.id, item.input, item.rows[0].value]), [["b", "chat", "120 ms"]]);
    assert.equal(snapshot.flow_note, 'io_flow.conversion_live:{"ms":31}');
    s.state.flow = { desktop: true, count: 3 };
    await s.render();
    snapshot = s.of("caption_overlay_update").at(-1).snapshot;
    assert.deepEqual(snapshot.flow.map(item => item.id), ["b", "a"]);
    // With the strip off the snapshot is as before: no flow at all.
    s.state.flow = { desktop: false, count: 3 };
    s.state.enabled = true;
    await s.render();
    snapshot = s.of("caption_overlay_update").at(-1).snapshot;
    assert.equal("flow" in snapshot, false);
});


test("a saved place goes to the window; a drag that ends is saved, and a malformed one is not", async context => {
    const s = await setup(context);
    s.state.enabled = true;
    s.state.placement = { x: -1700, y: 640 };
    await s.render();
    assert.deepEqual(s.of("caption_overlay_set").at(-1), { open: true, position: "bottom", placement: { x: -1700, y: 640 } });
    s.listeners.get("caption-overlay-moved")({ payload: { x: 300, y: 200 } });
    s.listeners.get("caption-overlay-moved")({ payload: { x: 1.5, y: 200 } });
    s.listeners.get("caption-overlay-moved")({ payload: null });
    assert.deepEqual(s.saved, [["placement", { x: 300, y: 200 }]]);
});

test("Ctrl and + or - step the size within the slider's range, and quick presses each count", async context => {
    const s = await setup(context);
    const step = change => s.listeners.get("caption-overlay-font-step")({ payload: change });
    step(1); step(1);
    // The backend has not answered yet: the second press starts from the first one's size.
    assert.deepEqual(s.saved.map(([, value]) => value.font_size), [30, 32]);
    // The first answer arrives: the next press still starts from the second request.
    s.state.settings = { ...s.state.settings, font_size: 30 };
    await s.render();
    step(1);
    assert.equal(s.saved.at(-1)[1].font_size, 34);
    s.state.settings = { ...s.state.settings, font_size: 34 };
    await s.render();
    step(-1);
    assert.deepEqual(s.saved.at(-1), ["settings", { position: "bottom", font_size: 32, display_duration: 6, opacity: 0.6 }]);
    // At either end nothing more is sent, and a payload that is not a step is ignored.
    s.saved.length = 0;
    s.state.settings = { ...s.state.settings, font_size: 72 };
    await s.render();
    step(1); step(2); step("1");
    assert.deepEqual(s.saved, []);
});

test("the listeners go when the controller does", async context => {
    const s = await setup(context);
    assert.deepEqual([...s.listeners.keys()].sort(), ["caption-overlay-font-step", "caption-overlay-moved"]);
    s.runtime.unmount();
    await flush();
    assert.equal(s.listeners.size, 0);
});
test("a window that cannot be opened says why, once, and closing one says nothing", async context => {
    let failing = "caption_overlay_no_monitor";
    const s = await setup(context, { fail: (command, args) => command === "caption_overlay_set" && args.open ? failing : null });
    s.state.enabled = true;
    await s.render();
    assert.deepEqual(s.notices, [["common_error.window.caption_overlay_no_monitor", { category_id: "caption_overlay_open_failed" }]]);
    // Moved while it still fails: no second notice.
    s.state.settings = { ...s.state.settings, position: "top" };
    await s.render();
    assert.equal(s.notices.length, 1);
    // A system error's text gets the general words; after a success a new failure is said again.
    failing = null;
    s.state.settings = { ...s.state.settings, position: "bottom" };
    await s.render();
    failing = "Os { code: 1400 }";
    s.state.settings = { ...s.state.settings, position: "top" };
    await s.render();
    assert.deepEqual(s.notices.at(-1), ["common_error.window.caption_overlay_open_failed", { category_id: "caption_overlay_open_failed" }]);
    // Turning it off is not an open that failed.
    const before = s.notices.length;
    s.state.enabled = false;
    await s.render();
    assert.equal(s.notices.length, before);
});

test("captions that cannot be updated are said once until an update works again", async context => {
    let failing = "caption_overlay_invalid";
    const s = await setup(context, { fail: command => command === "caption_overlay_update" ? failing : null });
    s.state.enabled = true;
    await s.render();
    for (const id of [1, 2, 3]) {
        s.state.rows = [...s.state.rows, row(id, "sent", `行${id}`)];
        await s.render();
    }
    assert.deepEqual(s.notices, [["common_error.window.caption_overlay_update_failed", { category_id: "caption_overlay_update_failed" }]]);
    failing = null;
    s.state.rows = [...s.state.rows, row(4, "sent", "行4")];
    await s.render();
    failing = "caption_overlay_invalid";
    s.state.rows = [...s.state.rows, row(5, "sent", "行5")];
    await s.render();
    assert.equal(s.notices.length, 2);
    // The notice never carries what was said.
    assert.ok(s.notices.every(([message]) => !message.includes("行")));
});