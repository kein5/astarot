import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { hooks, loadModule, stubGlobals } from "../../../../logics/test/hookHarness.ts";

// #614: the empty conversation's line on turning OSC on in VRChat is a state, not standing help.
// It stands only while the app finds no VRChat with OSC on: the condition under which the quick
// settings' readout shows the same step. The hook that asks is the readout's own, loaded as it is.

interface Situation {
    presence: unknown;
    sends: boolean | undefined;
    osc_query: boolean;
}

async function setup(context: TestContext, { presence = null, sends = true, osc_query = true }: Partial<Situation> = {}) {
    const runtime = hooks(), asked: boolean[] = [], timers: { ms: number; cleared: boolean }[] = [];
    const state: Situation = { presence, sends, osc_query };
    stubGlobals(context, { setInterval: (_: () => void, ms: number) => { timers.push({ ms, cleared: false }); return timers.length - 1; },
        clearInterval: (id: number) => { timers[id].cleared = true; } });
    const presenceModule = await loadModule<typeof import("./VrchatPresence.tsx")>(new URL("./VrchatPresence.tsx", import.meta.url), runtime, {
        "@logics_configs": { useOthers: () => ({ currentVrchatOscPresence: { data: state.presence },
            currentEnableSendMessageToVrc: { data: state.sends }, getVrchatOscPresence: () => asked.push(true) }),
        useAdvancedSettings: () => ({ currentEnableOscQuery: { data: state.osc_query } }) },
        "../../config_page/setting_section/setting_box/_components/env_readout/EnvReadout": { EnvReadout: () => null },
    });
    const { VrchatOscHint } = await loadModule<typeof import("./VrchatOscHint.tsx")>(new URL("./VrchatOscHint.tsx", import.meta.url), runtime, {
        "./VrchatPresence": presenceModule,
    });
    const draw = () => runtime.render(VrchatOscHint, { className: "placed" });
    return { draw, asked, timers, state, unmount: () => runtime.unmount() };
}

test("the line stands only while no VRChat with OSC on is found", async context => {
    const s = await setup(context, { presence: "not_found" });
    const line = s.draw();
    assert.ok(line);
    assert.deepEqual([line.type, line.props.className, line.props.children], ["p", "placed", "studio.empty_vrchat_hint"]);
    // Found, or not possible to tell (another machine, receiving not started): nothing to do in VRChat that the app knows of.
    for (const presence of ["found", "unknown"]) {
        s.state.presence = presence;
        assert.equal(s.draw(), null, presence);
    }
});

test("until VRChat's presence is answered the line is not drawn, so it does not appear at startup only to go away", async context => {
    const s = await setup(context);
    assert.equal(s.draw(), null, "not answered yet");
    assert.equal(s.asked.length, 1, "it asks as soon as it is on screen");
    s.state.presence = "found";
    assert.equal(s.draw(), null, "VRChat was there all along: the line never showed");
    s.state.presence = "not_found";
    assert.ok(s.draw(), "VRChat was closed, or its OSC turned off");
});

test("with sending off or OSCQuery off, VRChat is not asked about and the line is not drawn", async context => {
    // The last answer may still be "not found": it says nothing once the app no longer asks.
    const off = await setup(context, { presence: "not_found", sends: false });
    assert.equal(off.draw(), null);
    assert.equal(off.asked.length, 0);
    const noQuery = await setup(context, { presence: "not_found", osc_query: false });
    assert.equal(noQuery.draw(), null);
    assert.equal(noQuery.asked.length, 0);
});

test("on screen it asks again every five seconds, as the readout does, and stops when it leaves", async context => {
    const s = await setup(context, { presence: "not_found" });
    s.draw();
    assert.deepEqual(s.timers.map(timer => [timer.ms, timer.cleared]), [[5000, false]]);
    s.unmount();
    assert.deepEqual(s.timers.map(timer => timer.cleared), [true]);
});
