import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { componentName, componentOf, findIn, hooks, loadModule, treeNode } from "../../../../../../../logics/test/hookHarness.ts";
import type { HookRuntime, TreeNode } from "../../../../../../../logics/test/hookHarness.ts";

// A volume threshold's row (ThresholdComponent.tsx) for the microphone or the speaker: the volume
// check, the meter with its slider and the field, joined to that source's settings. The device and
// volume hooks are stand-ins that hold the values the test gives and record every action; the
// row's parts are stand-ins that keep their props.

type Setting = { state: string; data: unknown };
const ok = (data: unknown): Setting => ({ state: "ok", data });

async function thresholdRow(context: TestContext, values: Record<string, unknown> = {}) {
    const calls: unknown[][] = [], loading = hooks(), runtime = hooks();
    let active: HookRuntime = loading;
    context.onTestFinished(() => runtime.unmount());
    const react = new Proxy(loading.api, { get: (_, key) => Reflect.get(active.api, key) });
    const state: Record<string, unknown> = { currentMicThreshold: ok(300), currentSpeakerThreshold: ok(200), currentEnableAutomaticMicThreshold: ok(false),
        currentEnableAutomaticSpeakerThreshold: ok(false), ...values };
    // As react-i18next does, the words change with the UI language and t changes with them.
    const words = { language: "en" };
    let t = (key: string) => `${words.language}:${key}`;
    const recorder = new Proxy({}, { get: (_, key) => {
        const name = String(key);
        if (name in state) return state[name];
        if (name.startsWith("current")) return ok(`${name} value`);
        return (...args: unknown[]) => { calls.push([name, ...args]); };
    } });
    const module = await loadModule<typeof import("./ThresholdComponent.tsx")>(new URL("./ThresholdComponent.tsx", import.meta.url), { ...loading, api: react }, {
        "@useI18n": { useI18n: () => ({ t }) },
        "@logics_common": { useVolume: () => recorder },
        "@logics_configs": { useDevice: () => recorder },
        "./slider_and_meter/SliderAndMeter": { SliderAndMeter: "slider-and-meter" },
        "./threshold_entry/ThresholdEntry": { ThresholdEntry: "threshold-entry" },
        "./volume_check_button/VolumeCheckButton": { VolumeCheckButton: "volume-check" },
    });
    let props: Record<string, unknown> = { id: "mic_threshold", min: 0, max: 2000 };
    // The row, and the source's part drawn with the runtime that keeps its state.
    const draw = (next: Record<string, unknown> = {}) => {
        props = { ...props, ...next };
        const node = treeNode(module.ThresholdComponent({ id: "mic_threshold", min: 0, max: 2000, ...props }));
        assert.ok(node);
        const source = findIn(node, item => typeof item.type === "function");
        active = runtime;
        const drawn: unknown = runtime.render(componentOf(source), source.props);
        const part = (type: string): TreeNode => findIn({ props: { children: drawn } }, item => item.type === type, type);
        return { row: node, source: componentName(source), check: part("volume-check").props, meter: part("slider-and-meter").props, entry: part("threshold-entry").props };
    };
    // Drawn again, as the effects leave it.
    const redraw = (next: Record<string, unknown> = {}) => { draw(next); return draw(); };
    const language = (name: string) => { words.language = name; t = (key: string) => `${name}:${key}`; };
    return { calls, state, draw, redraw, language };
}

test("the microphone's row joins the volume check, the meter and the field to the microphone's threshold", async context => {
    const r = await thresholdRow(context, { currentMicThresholdCheckStatus: ok(true) });
    const shown = r.redraw();
    assert.equal(shown.source, "MicComponent");
    assert.deepEqual([shown.check.id, shown.check.min, shown.check.max, typeof shown.check.SvgComponent, shown.check.isChecking], ["mic_threshold", 0, 2000, "function", ok(true)]);
    shown.check.startFunction();
    shown.check.stopFunction();
    assert.deepEqual(r.calls, [["volumeCheckStart_Mic"], ["volumeCheckStop_Mic"]]);
    assert.deepEqual([shown.meter.id, shown.meter.ui_threshold, shown.entry.ui_threshold, shown.entry["aria-label"], shown.entry.confirmedThreshold, shown.entry.is_disable],
        ["mic_threshold", 300, 300, "en:vr_panel.mic_threshold", ok(300), false]);
    // Moving the slider moves the field with it; letting go saves the microphone's threshold.
    shown.meter.setUiThresholdFunction(450);
    assert.equal(r.draw().entry.ui_threshold, 450);
    shown.entry.setUiThresholdFunction(460);
    assert.equal(r.draw().meter.ui_threshold, 460);
    shown.meter.setThresholdFunction("470");
    shown.entry.setThresholdFunction("480");
    assert.deepEqual(r.calls.slice(2), [["setMicThreshold", "470"], ["setMicThreshold", "480"]]);
});

test("the speaker's row joins the same parts to the speaker's threshold", async context => {
    const r = await thresholdRow(context, { currentSpeakerThresholdCheckStatus: ok(false) });
    const shown = r.redraw({ id: "speaker_threshold", max: 1000 });
    assert.equal(shown.source, "SpeakerComponent");
    const mic = (await thresholdRow(context)).redraw().check.SvgComponent;
    assert.notEqual(shown.check.SvgComponent, mic, "headphones, not the microphone");
    assert.deepEqual([shown.check.id, shown.check.max, shown.check.isChecking, shown.meter.ui_threshold, shown.entry["aria-label"], shown.entry.confirmedThreshold, shown.entry.is_disable],
        ["speaker_threshold", 1000, ok(false), 200, "en:vr_panel.speaker_threshold", ok(200), false]);
    shown.check.startFunction();
    shown.check.stopFunction();
    shown.meter.setUiThresholdFunction(250);
    assert.equal(r.draw().entry.ui_threshold, 250);
    shown.entry.setUiThresholdFunction(255);
    assert.equal(r.draw().meter.ui_threshold, 255);
    shown.meter.setThresholdFunction("260");
    assert.deepEqual(r.calls, [["volumeCheckStart_Speaker"], ["volumeCheckStop_Speaker"], ["setSpeakerThreshold", "260"]]);
    assert.equal(shown.row.type, "div", "inside the row's container");
});

test("while the threshold is automatic or a voice activity filter cuts instead, the row says so in the UI's language and the field is off", async context => {
    for (const [id, automatic, key] of [["mic_threshold", "currentEnableAutomaticMicThreshold", "config_page.device.mic_dynamic_energy_threshold.option_auto"],
        ["speaker_threshold", "currentEnableAutomaticSpeakerThreshold", "config_page.device.speaker_dynamic_energy_threshold.option_auto"]] as const) {
        const r = await thresholdRow(context, { [automatic]: ok(true) });
        let shown = r.redraw({ id });
        assert.deepEqual([shown.meter.ui_threshold, shown.entry.ui_threshold, shown.entry.is_disable], [`en:${key}`, `en:${key}`, true], id);
        // A new UI language says it again in that language (#904).
        r.language("ja");
        shown = r.redraw();
        assert.equal(shown.meter.ui_threshold, `ja:${key}`, id);
        // Turned off again: the saved number.
        r.state[automatic] = ok(false);
        r.state[id === "mic_threshold" ? "currentMicThreshold" : "currentSpeakerThreshold"] = ok(321);
        shown = r.redraw();
        assert.deepEqual([shown.meter.ui_threshold, shown.entry.is_disable], [321, false], id);
        // A voice activity filter cuts instead.
        shown = r.redraw({ is_vad_active: true });
        assert.deepEqual([shown.meter.ui_threshold, shown.entry.is_disable], [`ja:${key}`, true], id);
        // Only a true counts.
        r.state[automatic] = ok("true");
        shown = r.redraw({ is_vad_active: "true" });
        assert.deepEqual([shown.meter.ui_threshold, shown.entry.is_disable], [321, false], id);
    }
});

test("the row waits while the saved threshold is pending, and then follows it", async context => {
    for (const [id, threshold] of [["mic_threshold", "currentMicThreshold"], ["speaker_threshold", "currentSpeakerThreshold"]] as const) {
        const r = await thresholdRow(context);
        r.redraw({ id });
        r.state[threshold] = { state: "pending", data: 999 };
        assert.equal(r.redraw().meter.ui_threshold, id === "mic_threshold" ? 300 : 200, id);
        r.state[threshold] = ok(999);
        assert.equal(r.redraw().meter.ui_threshold, 999, id);
    }
});
