import assert from "node:assert/strict";
import { test } from "vitest";
import { componentName, componentOf, findIn, hooks, loadModule, nodesIn, treeNode } from "../../../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../../../logics/test/hookHarness.ts";

// The volume meter and threshold slider of the microphone or the speaker (SliderAndMeter.tsx): how
// far the meter reaches and whether it is past the threshold, and when the slider is there and what
// it sets. The volume stores and the device settings are stand-ins that hold the values the test gives.

const t = (key: string) => key;
type Setting = { state: string; data: unknown };
const ok = (data: unknown): Setting => ({ state: "ok", data });

async function meter(values: Record<string, unknown> = {}) {
    const ui: unknown[] = [], saved: unknown[] = [];
    const state: Record<string, unknown> = { currentMicVolume: ok(600), currentSpeakerVolume: ok(300), currentEnableAutomaticMicThreshold: ok(false),
        currentEnableAutomaticSpeakerThreshold: ok(false), currentMicVadFilter: ok(false), currentSpeakerVadFilter: ok(false), currentVadAvailable: ok(true), ...values };
    const module = await loadModule<typeof import("./SliderAndMeter.tsx")>(new URL("./SliderAndMeter.tsx", import.meta.url), hooks(), {
        "@useI18n": { useI18n: () => ({ t }) },
        "@store": { useStore_MicVolume: () => ({ currentMicVolume: state.currentMicVolume }), useStore_SpeakerVolume: () => ({ currentSpeakerVolume: state.currentSpeakerVolume }) },
        "@logics_configs": { useDevice: () => state },
    });
    // The row for a source drawn down to its meter and slider (none of its parts keeps state).
    const draw = (props: Record<string, unknown> = {}) => {
        const node = treeNode(module.SliderAndMeter({ id: "mic_threshold", min: 0, max: 2000, ui_threshold: 300,
            setUiThresholdFunction: (value: unknown) => { ui.push(value); }, setThresholdFunction: (value: unknown) => { saved.push(value); }, ...props }));
        assert.ok(node);
        const source = findIn(node, item => typeof item.type === "function");
        const drawn = componentOf(source)(source.props);
        const bar = findIn(drawn, item => componentName(item) === "VolumeMeter");
        return { source: componentName(source), bar: componentOf(bar)(bar.props), barProps: bar.props, slider: nodesIn(drawn).find(item => item.type === "input") ?? null };
    };
    return { ui, saved, state, draw };
}
const styleOf = (bar: TreeNode) => bar.props.style;

test("the microphone's meter reaches as far as its volume goes toward the upper limit, and darkens below the threshold", async () => {
    const m = await meter();
    let drawn = m.draw();
    assert.equal(drawn.source, "ThresholdVolumeMeter_Mic");
    assert.deepEqual([drawn.barProps.volume_width_percentage, drawn.barProps.volume, drawn.barProps.threshold], [30, 600, 300]);
    assert.deepEqual(styleOf(drawn.bar), { width: "30%", backgroundColor: "var(--primary_400_color)" }, "louder than the threshold");
    drawn = m.draw({ ui_threshold: 700 });
    assert.equal(styleOf(drawn.bar).backgroundColor, "var(--primary_750_color)", "quieter than the threshold");
    assert.equal(styleOf(m.draw({ ui_threshold: "600" }).bar).backgroundColor, "var(--primary_400_color)", "at the threshold it counts as past it");
    // A volume above the upper limit fills the meter and no more.
    m.state.currentMicVolume = ok(5000);
    drawn = m.draw();
    assert.deepEqual([drawn.barProps.volume_width_percentage, drawn.barProps.volume, styleOf(drawn.bar).width], [100, 2000, "100%"]);
    // The words of an automatic threshold count as a threshold of nothing.
    m.state.currentMicVolume = ok(0);
    assert.equal(styleOf(m.draw({ ui_threshold: "Automatic" }).bar).backgroundColor, "var(--primary_400_color)");
});

test("the microphone's slider sets the threshold the row shows while it moves and saves it when let go", async () => {
    const m = await meter();
    const slider = m.draw().slider;
    assert.ok(slider);
    assert.deepEqual([slider.props.type, slider.props.min, slider.props.max, slider.props.value, slider.props["aria-label"]], ["range", 0, 2000, 300, "vr_panel.mic_threshold"]);
    slider.props.onChange({ target: { value: "450" } });
    slider.props.onMouseUp({ currentTarget: { value: "460" } });
    slider.props.onKeyUp({ currentTarget: { value: "470" } });
    assert.deepEqual([m.ui, m.saved], [["450"], ["460", "470"]]);
    // Words in the row put the slider at the lower limit, or at 0 without one.
    assert.equal(m.draw({ ui_threshold: "Automatic", min: 100 }).slider?.props.value, 100);
    assert.equal(m.draw({ ui_threshold: "Automatic", min: undefined }).slider?.props.value, 0);
});

test("the microphone's slider goes while the threshold is automatic or a voice activity filter cuts instead, and only a filter this build has", async () => {
    const shown = async (values: Record<string, unknown>) => (await meter(values)).draw().slider !== null;
    assert.equal(await shown({ currentEnableAutomaticMicThreshold: ok(true) }), false);
    assert.equal(await shown({ currentMicVadFilter: ok(true) }), false);
    assert.equal(await shown({ currentMicVadFilter: ok(true), currentVadAvailable: ok(false) }), true, "a saved filter this build does not have cuts nothing");
    assert.equal(await shown({ currentEnableAutomaticMicThreshold: ok("true") }), true, "only a true from the backend");
    assert.equal(await shown({ currentSpeakerVadFilter: ok(true), currentEnableAutomaticSpeakerThreshold: ok(true) }), true, "the speaker's settings are not the microphone's");
});

test("the speaker's row has its own meter and slider, on the speaker's volume and settings", async () => {
    const m = await meter();
    const drawn = m.draw({ id: "speaker_threshold", max: 1000, ui_threshold: 200 });
    assert.equal(drawn.source, "ThresholdVolumeMeter_Speaker");
    assert.deepEqual([drawn.barProps.volume_width_percentage, drawn.barProps.volume, styleOf(drawn.bar)], [30, 300,
        { width: "30%", backgroundColor: "var(--primary_400_color)" }]);
    assert.equal(styleOf(m.draw({ id: "speaker_threshold", max: 1000, ui_threshold: 301 }).bar).backgroundColor, "var(--primary_750_color)");
    const slider = drawn.slider;
    assert.ok(slider);
    assert.deepEqual([slider.props.type, slider.props.min, slider.props.max, slider.props.value, slider.props["aria-label"]], ["range", 0, 1000, 200, "vr_panel.speaker_threshold"]);
    slider.props.onChange({ target: { value: "250" } });
    slider.props.onMouseUp({ currentTarget: { value: "260" } });
    slider.props.onKeyUp({ currentTarget: { value: "270" } });
    assert.deepEqual([m.ui, m.saved], [["250"], ["260", "270"]]);
    assert.equal(m.draw({ id: "speaker_threshold", ui_threshold: "x", min: 5 }).slider?.props.value, 5);
    assert.equal(m.draw({ id: "speaker_threshold", ui_threshold: "x", min: undefined }).slider?.props.value, 0);
    m.state.currentSpeakerVolume = ok(9000);
    assert.deepEqual([m.draw({ id: "speaker_threshold", max: 1000 }).barProps.volume, m.draw({ id: "speaker_threshold", max: 1000 }).barProps.volume_width_percentage], [1000, 100]);
    for (const [values, shown] of [[{ currentEnableAutomaticSpeakerThreshold: ok(true) }, false], [{ currentSpeakerVadFilter: ok(true) }, false],
        [{ currentSpeakerVadFilter: ok(true), currentVadAvailable: ok(false) }, true], [{ currentMicVadFilter: ok(true), currentEnableAutomaticMicThreshold: ok(true) }, true]] as const) {
        assert.equal((await meter(values)).draw({ id: "speaker_threshold" }).slider !== null, shown, JSON.stringify(values));
    }
});
