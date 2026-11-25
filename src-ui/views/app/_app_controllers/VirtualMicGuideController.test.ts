import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { hooks, loadModule, find, nodesIn, kitStandIns } from "../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../logics/test/hookHarness.ts";
import { localeAt, readLocale } from "../../../logics/test/locales.ts";
import * as shapes from "../../../logics/voice/virtualMic.ts";

interface GuideSetup {
    notice?: boolean;
    current?: object;
    opened?: boolean;
    check?: object;
}

const id = (name: string) => JSON.stringify(["Windows WASAPI", name]);
const CABLE = { playback: id("CABLE Input (VB-Audio Virtual Cable)"), recording: id("CABLE Output (VB-Audio Virtual Cable)"),
    playback_label: "CABLE Input (VB-Audio Virtual Cable)", recording_label: "CABLE Output (VB-Audio Virtual Cable)" };
const IDLE = { phase: "idle", playback: null, level: 0, result: null, error: null };
const status = (extra: object = {}) => ({ supported: true, cables: [], error: null, tts_output: null, tts_output_is_cable: false, ...extra });

async function setup(context: TestContext, { notice = true, current = status(), opened = true, check = IDLE }: GuideSetup = {}) {
    const runtime = hooks(), calls: unknown[] = [];
    const state = { notice, status: current, check, opened,
        refreshStatus: () => calls.push("refresh"), startCheck: (playback: unknown) => calls.push(["check", playback]),
        resetCheck: () => calls.push("reset"),
        closeGuide: () => { calls.push("close"); state.opened = false; } };
    const { VirtualMicGuideController, VB_CABLE_URL } = await loadModule<typeof import("./VirtualMicGuideController.tsx")>(new URL("./VirtualMicGuideController.tsx", import.meta.url), runtime, {
        "@tauri-apps/api/core": { isTauri: () => false },
        "@tauri-apps/plugin-opener": { openUrl: () => assert.fail("no link opens in this test") },
        "@store": {
            useStore_IsOpenedConfigPage: () => ({ updateIsOpenedConfigPage: (value: unknown) => calls.push(["opened", value]) }),
            useStore_SelectedConfigTabId: () => ({ updateSelectedConfigTabId: (value: unknown) => calls.push(["tab", value]) }),
        },
        "../../../logics/common/useConsentDialog": { useConsentDialog: (open: unknown) => ({ dialog: { current: null, open }, close: () => calls.push("closed") }) },
        "../../../logics/voice/useVirtualMic": { useVirtualMic: () => state },
        "../../../logics/voice/virtualMic.ts": shapes,
    });
    context.onTestFinished(() => runtime.unmount());
    // The first render decides; the second shows what that decision opened.
    const render = () => { runtime.render(VirtualMicGuideController); return runtime.render(VirtualMicGuideController); };
    const all = (tree: unknown, type: string) => nodesIn(tree).filter(node => node.type === type);
    return { render, all, calls, state, url: VB_CABLE_URL, remount: runtime.remount };
}

const text = (node: TreeNode) => [node.props.children].flat().filter((item: unknown) => typeof item === "string").join("");

// #943: the guide opens only when the user opens it (the first-run setup's row, the TTS settings),
// never by itself, also on Windows without a cable and before it was ever finished.
test("it never opens by itself, and opens when asked, with a cable or without", async context => {
    for (const current of [status(), status({ cables: [CABLE] }), status({ supported: false }), status({ error: "audio_devices_unavailable" })]) {
        assert.equal((await setup(context, { opened: false, current })).render(), null, JSON.stringify(current));
    }
    assert.notEqual((await setup(context, { notice: true })).render(), null);
    assert.notEqual((await setup(context, { notice: false, current: status({ cables: [CABLE] }) })).render(), null);
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
    // One way out, and the cable's page first; nothing about opening by itself.
    assert.deepEqual(buttons.map(button => button.props.children), ["virtual_mic.close", "virtual_mic.install.open_page"]);
    assert.equal(buttons[1].props.autoFocus, true);
    // No test tone and no setting without a cable.
    assert.equal(nodesIn(tree).filter(node => node.type === kitStandIns.Select).length, 0);
});

test("Close and Escape close it and change no setting; it opens again only when asked", async context => {
    const s = await setup(context);
    s.all(s.render(), "button")[0].props.onClick();
    assert.deepEqual(s.calls.filter(call => call !== "refresh"), ["closed", "close"]);
    assert.equal(s.render(), null);
    const escaped = await setup(context);
    const dialog = find(escaped.render(), node => node.type === "dialog");
    assert.ok(dialog);
    dialog.props.onCancel({ preventDefault() {} });
    assert.deepEqual(escaped.calls.filter(call => call !== "refresh"), ["closed", "close"]);
    // Asked again, it opens again.
    escaped.state.opened = true;
    assert.notEqual(escaped.render(), null);
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
        ["virtual_mic.found.open_tts", "virtual_mic.test.start", "virtual_mic.done"]);
    assert.equal(s.calls.filter(call => Array.isArray(call)).length, 0);
    // The tone plays only when asked, into the cable shown.
    buttons[1].props.onClick();
    assert.deepEqual(s.calls.at(-1), ["check", CABLE.playback]);
    const meter = find(tree, node => node.props?.role === "meter");
    assert.ok(meter);
    assert.equal(meter.props["aria-valuenow"], 0);
    buttons[0].props.onClick();
    assert.deepEqual(s.calls.slice(-2), [["tab", "tts"], ["opened", true]]);
});

test("while a check runs the meter follows it and the dialog cannot be put away", async context => {
    const s = await setup(context, { notice: false, opened: true, current: status({ cables: [CABLE], tts_output: CABLE.playback, tts_output_is_cable: true }),
        check: { ...IDLE, phase: "running", playback: CABLE.playback, level: 0.62 } });
    const tree = s.render();
    const meter = find(tree, node => node.props?.role === "meter");
    assert.ok(meter);
    assert.equal(meter.props["aria-valuenow"], 62);
    const buttons = s.all(tree, "button");
    // TTS already plays into the cable: no settings button.
    assert.deepEqual(buttons.map(button => button.props.disabled), [true, true]);
    const dialog = find(tree, node => node.type === "dialog");
    assert.ok(dialog);
    dialog.props.onCancel({ preventDefault() {} });
    assert.ok(!s.calls.includes("close"));
});

for (const language of ["en", "ja"]) test(`${language}: the line about the output device says the state; the way to the settings is the button under it`, () => {
    const line = localeAt(readLocale(language), "virtual_mic.found.output_unset");
    assert.ok(typeof line === "string");
    // The device it should be, once, and no path through the settings (#614).
    assert.equal(line.split("{{playback}}").length - 1, 1);
    assert.doesNotMatch(line, language === "ja" ? /設定の「/ : /settings/i);
});

test("every text the guide shows exists in English and Japanese", () => {
    const keys = new Set<string>();
    const source = readFileSync(new URL("./VirtualMicGuideController.tsx", import.meta.url), "utf8")
        + readFileSync(new URL("../config_page/setting_section/setting_box/tts/VirtualMicEntry.tsx", import.meta.url), "utf8");
    for (const [, key] of source.matchAll(/"(virtual_mic\.[a-z_.]+)"/g)) keys.add(key);
    for (const code of [...source.matchAll(/"(virtual_mic_[a-z_]+|audio_devices_unavailable)"/g)].map(match => match[1]).concat("other"))
        keys.add(`virtual_mic.test.error.${code}`);
    for (const language of ["en", "ja"]) {
        const strings = readLocale(language);
        for (const key of keys) assert.equal(typeof localeAt(strings, key), "string", `${language}: ${key}`);
    }
});

// D-14 (decided on 2026-11-25): with more than one cable, the choice of the cable is the kit's
// Select, with the kit's options. A choice starts the check over; while a check runs it waits.
test("with several cables the cable is chosen with the kit's Select, which waits while the tone plays", async context => {
    const OTHER = { playback: id("Voicemeeter Input"), recording: id("Voicemeeter Out B1"), playback_label: "Voicemeeter Input", recording_label: "Voicemeeter Out B1" };
    const s = await setup(context, { notice: false, opened: true, current: status({ cables: [CABLE, OTHER] }) });
    const choice = (tree: unknown) => {
        const found = nodesIn(tree).find(node => node.type === kitStandIns.Select);
        assert.ok(found);
        return found;
    };
    let tree = s.render();
    assert.deepEqual([choice(tree).props.value, choice(tree).props.disabled], [CABLE.playback, false]);
    assert.deepEqual(nodesIn(choice(tree)).filter(node => node.type === kitStandIns.SelectOption).map(option => [option.props.value, option.props.children]),
        [[CABLE.playback, CABLE.playback_label], [OTHER.playback, OTHER.playback_label]]);
    assert.deepEqual(nodesIn(tree).filter(node => node.type === "select" || node.type === "option"), []);
    const label = nodesIn(tree).find(node => node.type === "label" && nodesIn(node).some(inner => inner.type === kitStandIns.Select));
    assert.equal(text(s.all(label, "span")[0]), "virtual_mic.found.choose");
    choice(tree).props.onChange({ target: { value: OTHER.playback } });
    tree = s.render();
    assert.equal(choice(tree).props.value, OTHER.playback);
    assert.deepEqual(s.all(tree, "dd").map(text), [OTHER.playback_label, OTHER.recording_label]);
    assert.ok(s.calls.includes("reset"), "a new choice starts the check over");
    s.state.check = { ...IDLE, phase: "running", playback: OTHER.playback, level: 0.4 };
    assert.equal(choice(s.render()).props.disabled, true);
});
