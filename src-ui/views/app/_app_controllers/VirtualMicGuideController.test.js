import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import yaml from "js-yaml";
import { hooks, loadModule, find } from "../../../logics/test/hookHarness.js";
import * as shapes from "../../../logics/voice/virtualMic.ts";
import * as firstRunLogic from "../../../logics/setup/firstRunSetup.ts";

const id = name => JSON.stringify(["Windows WASAPI", name]);
const CABLE = { playback: id("CABLE Input (VB-Audio Virtual Cable)"), recording: id("CABLE Output (VB-Audio Virtual Cable)"),
    playback_label: "CABLE Input (VB-Audio Virtual Cable)", recording_label: "CABLE Output (VB-Audio Virtual Cable)" };
const IDLE = { phase: "idle", playback: null, level: 0, result: null, error: null };
const status = (extra = {}) => ({ supported: true, cables: [], error: null, tts_output: null, tts_output_is_cable: false, ...extra });

async function setup(context, { notice = true, current = status(), opened = false, telemetryPending = false, check = IDLE,
    firstRun = { notice: false, settled: false } } = {}) {
    const runtime = hooks(), calls = [];
    const state = { notice, status: current, check, opened,
        refreshStatus: () => calls.push("refresh"), startCheck: playback => calls.push(["check", playback]),
        resetCheck: () => calls.push("reset"), dismissNotice: () => { calls.push("dismiss"); state.notice = false; },
        closeGuide: () => { calls.push("close"); state.opened = false; } };
    const { VirtualMicGuideController, VB_CABLE_URL } = await loadModule(new URL("./VirtualMicGuideController.tsx", import.meta.url), runtime, {
        "@tauri-apps/api/core": { isTauri: () => false },
        "@tauri-apps/plugin-opener": { openUrl: () => assert.fail("no link opens in this test") },
        "@logics_configs": { useOthers: () => ({ currentTelemetryNotice: { state: "ok", data: { pending: telemetryPending } } }) },
        "@store": {
            useStore_IsOpenedConfigPage: () => ({ updateIsOpenedConfigPage: value => calls.push(["opened", value]) }),
            useStore_SelectedConfigTabId: () => ({ updateSelectedConfigTabId: value => calls.push(["tab", value]) }),
        },
        "../../../logics/common/useConsentDialog": { useConsentDialog: open => ({ dialog: { current: null, open }, close: () => calls.push("closed") }) },
        "../../../logics/voice/useVirtualMic": { useVirtualMic: () => state },
        "../../../logics/voice/virtualMic.ts": shapes,
        "../../../logics/setup/useFirstRunSetup": { useFirstRunSetup: () => firstRun },
        "../../../logics/setup/firstRunSetup.ts": firstRunLogic,
    });
    context.onTestFinished(() => runtime.unmount());
    // The first render decides; the second shows what that decision opened.
    const render = () => { runtime.render(VirtualMicGuideController); return runtime.render(VirtualMicGuideController); };
    const all = (tree, type) => {
        const found = [];
        find(tree, node => { if (node.type === type) found.push(node); return false; });
        return found;
    };
    return { render, all, calls, state, url: VB_CABLE_URL, remount: runtime.remount };
}

const text = node => [node.props.children].flat().filter(item => typeof item === "string").join("");

test("at start-up it opens by itself only without a cable, and after the other first-run notices", async context => {
    assert.notEqual((await setup(context)).render(), null);
    assert.equal((await setup(context, { current: status({ cables: [CABLE] }) })).render(), null);
    assert.equal((await setup(context, { notice: false })).render(), null);
    assert.equal((await setup(context, { current: status({ supported: false }) })).render(), null);
    assert.equal((await setup(context, { current: status({ error: "audio_devices_unavailable" }) })).render(), null);
    assert.equal((await setup(context, { telemetryPending: true })).render(), null);
    // The first-run setup (#557) goes first while it is pending, until it is put away or not needed.
    assert.equal((await setup(context, { firstRun: { notice: true, settled: false } })).render(), null);
    assert.notEqual((await setup(context, { firstRun: { notice: true, settled: true } })).render(), null);
    // From the settings it opens with a cable too.
    assert.notEqual((await setup(context, { notice: false, current: status({ cables: [CABLE] }), opened: true })).render(), null);
});

test("without a cable it says why, points to the cable's own page and keeps looking", async context => {
    const s = await setup(context);
    const tree = s.render();
    const paragraphs = s.all(tree, "p").map(text);
    // The request and its purpose come first.
    assert.deepEqual(paragraphs.slice(0, 2), ["virtual_mic.purpose", "virtual_mic.not_needed"]);
    assert.ok(paragraphs.includes("virtual_mic.install.third_party"));
    assert.ok(paragraphs.includes("virtual_mic.install.searching"));
    assert.equal(s.all(tree, "a")[0].props.href, s.url);
    assert.equal(s.url, "https://vb-audio.com/Cable/");
    // It looked again as soon as it opened (the timer repeats it).
    assert.ok(s.calls.includes("refresh"));
    const buttons = s.all(tree, "button");
    assert.deepEqual(buttons.map(button => button.props.children),
        ["virtual_mic.later", "virtual_mic.install.open_page", "virtual_mic.dont_show"]);
    assert.equal(buttons[1].props.autoFocus, true);
    // No test tone and no setting without a cable.
    assert.equal(s.all(tree, "select").length, 0);
});

test("Later puts it away for this run; Don't show again stops it opening by itself", async context => {
    const later = await setup(context);
    later.all(later.render(), "button")[0].props.onClick();
    assert.deepEqual(later.calls.filter(call => call !== "refresh"), ["closed", "close"]);
    assert.equal(later.render(), null);
    const never = await setup(context);
    never.all(never.render(), "button")[2].props.onClick();
    assert.ok(never.calls.includes("dismiss"));
});

// #563: changing the UI language draws the main page again (App.jsx), and the guide put away
// with Later opened again at once.
test("a guide put away with Later stays away when the main page is drawn again", async context => {
    const s = await setup(context);
    s.all(s.render(), "button")[0].props.onClick();
    s.remount();
    assert.equal(s.render(), null);
    assert.ok(!s.calls.includes("dismiss"), "Later is not Don't show again");
});

test("with a cable it shows both ends, checks with the tone and ends at VRChat's microphone", async context => {
    const s = await setup(context, { notice: false, opened: true, current: status({ cables: [CABLE] }) });
    const tree = s.render();
    const facts = s.all(tree, "dd").map(text);
    assert.deepEqual(facts, [CABLE.playback_label, CABLE.recording_label]);
    const headings = s.all(tree, "h4").map(text);
    assert.deepEqual(headings, ["virtual_mic.found.heading", "virtual_mic.test.heading", "virtual_mic.vrchat.heading"]);
    // TTS does not play into the cable yet: say so and offer the TTS settings, without changing them.
    const buttons = s.all(tree, "button");
    assert.deepEqual(buttons.map(button => button.props.children),
        ["virtual_mic.found.open_tts", "virtual_mic.test.start", "virtual_mic.later", "virtual_mic.done"]);
    assert.equal(s.calls.filter(call => Array.isArray(call)).length, 0);
    // The tone plays only when asked, into the cable shown.
    buttons[1].props.onClick();
    assert.deepEqual(s.calls.at(-1), ["check", CABLE.playback]);
    const meter = find(tree, node => node.props?.role === "meter");
    assert.equal(meter.props["aria-valuenow"], 0);
    buttons[0].props.onClick();
    assert.deepEqual(s.calls.slice(-2), [["tab", "tts"], ["opened", true]]);
});

test("while a check runs the meter follows it and the dialog cannot be put away", async context => {
    const s = await setup(context, { notice: false, opened: true, current: status({ cables: [CABLE], tts_output: CABLE.playback, tts_output_is_cable: true }),
        check: { ...IDLE, phase: "running", playback: CABLE.playback, level: 0.62 } });
    const tree = s.render();
    assert.equal(find(tree, node => node.props?.role === "meter").props["aria-valuenow"], 62);
    const buttons = s.all(tree, "button");
    // TTS already plays into the cable: no settings button.
    assert.deepEqual(buttons.map(button => button.props.disabled), [true, true, true]);
    find(tree, node => node.type === "dialog").props.onCancel({ preventDefault() {} });
    assert.ok(!s.calls.includes("close"));
});

test("every text the guide shows exists in English and Japanese", () => {
    const keys = new Set();
    const source = readFileSync(new URL("./VirtualMicGuideController.tsx", import.meta.url), "utf8")
        + readFileSync(new URL("../config_page/setting_section/setting_box/tts/VirtualMicEntry.tsx", import.meta.url), "utf8");
    for (const [, key] of source.matchAll(/"(virtual_mic\.[a-z_.]+)"/g)) keys.add(key);
    for (const code of [...source.matchAll(/"(virtual_mic_[a-z_]+|audio_devices_unavailable)"/g)].map(match => match[1]).concat("other"))
        keys.add(`virtual_mic.test.error.${code}`);
    for (const language of ["en", "ja"]) {
        const strings = yaml.load(readFileSync(new URL(`../../../../locales/${language}.yml`, import.meta.url), "utf8"));
        for (const key of keys) {
            const value = key.split(".").reduce((node, part) => node?.[part], strings);
            assert.equal(typeof value, "string", `${language}: ${key}`);
        }
    }
});
