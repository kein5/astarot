import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, find } from "../../../../../../logics/test/hookHarness.ts";
import * as stopVoice from "../../../../../../logics/voice/stopVoice.ts";

// The TTS page's stop behaves as the top bar's (#937): offered while there is something to stop,
// disabled-looking with its tooltip saying when it can be pressed otherwise, and answering a press.
interface World { active: boolean; queued: number; phase: string; pressed: number }

async function load(world: World) {
    const runtime = hooks();
    const { StopVoiceButton } = await loadModule<typeof import("./StopVoiceButton.tsx")>(new URL("./StopVoiceButton.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t: (key: string) => key }) },
        "../../../../../../logics/voice/useVoice": { useVoice: () => ({ status: { active: world.active, queued: world.queued } }) },
        "../../../../../../logics/voice/useVoiceAudition": { useVoiceAudition: () => ({ audition: { phase: "idle" } }) },
        "../../../../../../logics/voice/useVirtualMic": { useVirtualMic: () => ({ check: { phase: "idle" } }) },
        "../../../../../../logics/voice/useStopVoice": { useStopVoice: () => ({ stop: { phase: world.phase }, press: () => { world.pressed += 1; } }) },
        "../../../../../../logics/voice/stopVoice.ts": stopVoice,
        "../../../../../common_components/tooltip/Tooltip": { Tooltip: "tooltip" },
        "../../../../../common_components/stable_words/StableWords": { StableWords: "stable-words" },
    });
    return { runtime, draw: () => runtime.render(StopVoiceButton) };
}
const parts = (tree: unknown) => {
    const tooltip = find(tree, node => node.type === "tooltip");
    const button = find(tree, node => node.type === "button");
    const words = find(tree, node => node.type === "stable-words");
    assert.ok(tooltip && button && words);
    return { tooltip, button, words };
};

test("with nothing to stop it reads as disabled, says when it can be pressed, and a press does nothing", async () => {
    const world = { active: false, queued: 0, phase: "idle", pressed: 0 };
    const { runtime, draw } = await load(world);
    const { tooltip, button } = parts(draw());
    assert.equal(tooltip.props.title, "voice_ui.topbar_stop_idle");
    assert.equal(button.props["aria-disabled"], true);
    assert.match(String(button.props.className), /is_idle/);
    button.props.onClick();
    assert.equal(world.pressed, 0);
    runtime.unmount();
});

test("while speaking it is offered and a press stops; the press is answered in its words", async () => {
    const world = { active: true, queued: 2, phase: "idle", pressed: 0 };
    const { runtime, draw } = await load(world);
    let { tooltip, button, words } = parts(draw());
    assert.equal(tooltip.props.title, "voice.stop");
    assert.equal(button.props["aria-disabled"], undefined);
    assert.equal(words.props.current, "voice_ui.topbar_stop");
    button.props.onClick();
    assert.equal(world.pressed, 1);
    // Waiting for the core: "Stopping…", and no second press.
    world.phase = "stopping";
    ({ button, words } = parts(draw()));
    assert.deepEqual([words.props.current, button.props["aria-busy"], button.props["aria-disabled"]], ["voice_ui.topbar_stopping", true, true]);
    button.props.onClick();
    assert.equal(world.pressed, 1);
    // Answered: "Stopped", even though nothing is left to stop.
    world.phase = "stopped"; world.active = false; world.queued = 0;
    ({ button, words } = parts(draw()));
    assert.equal(words.props.current, "voice_ui.topbar_stopped");
    assert.match(String(button.props.className), /is_stopped/);
    assert.doesNotMatch(String(button.props.className), /is_idle/);
    // The words keep the room of the longest, so nothing beside it moves (#912).
    assert.deepEqual(words.props.words, ["voice_ui.topbar_stop", "voice_ui.topbar_stopping", "voice_ui.topbar_stopped"]);
    runtime.unmount();
});
