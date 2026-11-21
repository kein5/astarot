import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, findIn } from "../../../../../../../logics/test/hookHarness.ts";

// #912: the connection state's words keep the longest state's width, so the check button beside
// them stays put while a check runs.
test("the connection state is said in the space of its longest word", async () => {
    const runtime = hooks();
    const { ConnectionCheckButton } = await loadModule<typeof import("./ConnectionCheckButton.tsx")>(new URL("./ConnectionCheckButton.tsx", import.meta.url), runtime, {
        "../env_readout/EnvReadout": { EnvReadout: "readout" },
        "../../../../../../common_components/stable_words/StableWords": { StableWords: "stable-words" },
    });
    const words = (props: object) => findIn(runtime.render(ConnectionCheckButton, props), node => node.type === "stable-words").props;
    const all = ["checking", "connected", "disconnected"].map(state => `config_page.common.connection_check.${state}`);
    for (const [props, state] of [[{}, "disconnected"], [{ state: "pending" }, "checking"], [{ variable: true }, "connected"]] as const) {
        assert.deepEqual([words(props).current, words(props).words], [`config_page.common.connection_check.${state}`, all], state);
    }
    runtime.unmount();
});
