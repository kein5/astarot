import assert from "node:assert/strict";
import { test } from "vitest";
import { find, findIn, hooks, loadModule } from "../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../logics/test/hookHarness.ts";

const ENGINES = {
    voicevox: { name: "VOICEVOX", url: "voicevox_url", example: "http://127.0.0.1:50021", site: "https://voicevox.invalid" },
    coeiroink: { name: "COEIROINK", url: "coeiroink_url", example: "http://127.0.0.1:50032", site: "https://coeiroink.invalid" },
};
const STATES = ["unchecked", "checking", "connected", "url_invalid", "not_connected"];
// The badge keeps the space of the states a check goes through, not the far longer invalid address.
const BADGES = ["unchecked", "checking", "connected", "not_connected"];
const READOUTS = ["model_catalog.engine.state.unchecked", "voice_ui.engine.checking", "voice_ui.engine.connected",
    "voice_ui.errors.tts_engine_url_invalid", "voice_ui.engine.not_connected"];

// #912: checking an engine again moves nothing on its card. Its state and its readout take the
// space of their longest state, and the readout keeps the mark's place while there is no mark.
test("an engine card's state and readout keep the space of their longest state", async () => {
    const runtime = hooks();
    const { EngineCatalog } = await loadModule<typeof import("./EngineCatalog.tsx")>(new URL("./EngineCatalog.tsx", import.meta.url), runtime, {
        "@tauri-apps/api/core": { isTauri: () => false },
        "@tauri-apps/plugin-opener": { openUrl: async () => undefined },
        "../../../../../../logics/voice/useVoice": { useVoice: () => ({ settings: { japanese_engine: "voicevox" }, send: () => undefined,
            engineChecks: { voicevox: { request_id: "a", pending: true }, coeiroink: { request_id: "b", pending: false, connected: false, error_code: "tts_engine_unreachable" } } }) },
        "../tts/TtsEngine": { TTS_ENGINES: ENGINES },
        "../_components/env_readout/EnvReadout": { EnvReadout: "readout" },
        "../../../../../common_components/stable_words/StableWords": { StableWords: "stable-words" },
        "./catalogLayout": { CatalogFacts: "facts", CatalogList: "list", CatalogSection: "section" },
    });
    const tree = runtime.render(EngineCatalog, { layout: "grid" });
    const card = (id: string) => findIn(tree, node => node.props?.["data-engine-card"] === id, id);
    const words = (node: TreeNode, align?: string) => findIn(node, each => each.type === "stable-words" && each.props.align === align).props;
    for (const [id, state, progress] of [["voicevox", "checking", "working"], ["coeiroink", "not_connected", undefined]] as const) {
        const badge = words(card(id));
        assert.deepEqual([badge.current, badge.words], [`model_catalog.engine.state.${state}`, BADGES.map(each => `model_catalog.engine.state.${each}`)], id);
        const readout = findIn(card(id), node => node.type === "readout").props;
        assert.deepEqual([readout.progress, readout.reserveMark], [progress, true], id);
        const sentence = words(card(id), "start");
        assert.deepEqual([sentence.current, sentence.words], [READOUTS[STATES.indexOf(state)], READOUTS], id);
    }
    assert.equal(find(card("coeiroink"), node => node.type === "stable-words" && node.props.align === "center"), null);
    runtime.unmount();
});
