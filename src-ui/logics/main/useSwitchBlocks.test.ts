import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule } from "../test/hookHarness.ts";
import * as switchBlocks from "./switchBlocks.ts";
import type { SwitchDirectState, SwitchVoiceSettings } from "./switchBlocks.ts";

// What the stand-ins below read and write.
interface State {
    ready: boolean;
    needs: unknown[];
    language: string;
    fullReadiness: unknown;
    jobs: Record<string, { phase: string }>;
    ocr: Record<string, unknown>;
    voiceSettings: SwitchVoiceSettings | null;
    directState: SwitchDirectState;
    published: unknown;
}

const load = async () => {
    const runtime = hooks(), calls: unknown[] = [];
    const state: State = { ready: true, needs: [], language: "Japanese", fullReadiness: null, jobs: {},
        ocr: { language: "Japanese", language_supported: true, required_models: ["a"], missing_models: ["a"] },
        voiceSettings: null, directState: {}, published: {} };
    const mod = await loadModule<typeof import("./useSwitchBlocks.ts")>(new URL("./useSwitchBlocks.ts", import.meta.url), runtime, {
        "@logics_configs": { useOcr: () => ({
            currentOcrModelReadiness: { data: state.ocr }, currentOcrSourceLanguage: { data: state.language },
            currentOcrReadiness: { data: state.fullReadiness }, getOcrModelReadiness: () => calls.push("get"),
        }) },
        "@store": {
            useStore_IsBackendReady: () => ({ currentIsBackendReady: { data: state.ready } }),
            useStore_IsOpenedConfigPage: () => ({ updateIsOpenedConfigPage: (value: unknown) => calls.push(["opened", value]) }),
            useStore_SelectedConfigTabId: () => ({ updateSelectedConfigTabId: (value: unknown) => calls.push(["tab", value]) }),
            useStore_SwitchBlocks: () => ({ currentSwitchBlocks: { data: state.published },
                updateSwitchBlocks: (value: unknown) => { state.published = value; calls.push(["publish", value]); } }),
        },
        "./useSetupNeeds": { useSetupNeeds: () => ({ needs: state.needs }) },
        "./switchBlocks": switchBlocks,
        "../voice/useVoice": { useVoice: () => ({ settings: state.voiceSettings, directState: state.directState }) },
        "../voice/useModelDownloads": { useModelDownloads: () => ({ state: { jobs: state.jobs } }) },
        "../translation/useTranslationSetup": { useTranslationSetup: () => ({ open: (resume: unknown) => calls.push(["review", resume]) }) },
        "../ocr/useOcrSetup": { focusOcrModels: () => calls.push("focus") },
        "../setup/useFirstRunSetup": { useFirstRunSetup: () => ({ openSetup: () => calls.push("setup") }) },
    });
    // Only the requests to the engine, not the writes to the shared atom.
    const asked = () => calls.filter(call => call === "get");
    return { render: () => runtime.render(mod.useSwitchBlocksSource), read: () => runtime.render(mod.useSwitchBlocks),
        state, calls, asked };
};

test("the blocks follow the settings as they change, without a restart", async () => {
    const s = await load();
    assert.deepEqual(s.render().ocr, { reason: "ocr_models", action: "ocr_models" });
    assert.deepEqual(s.read().blocks.ocr, { reason: "ocr_models", action: "ocr_models" });
    s.state.ocr = { ...s.state.ocr, missing_models: [] };
    assert.equal(s.render().ocr, undefined);
    assert.equal(s.read().blocks.ocr, undefined);
    s.state.voiceSettings = { mode: "off", mic_mode: "off" };
    assert.equal(s.render().tts?.reason, "tts_source");
    assert.equal(s.read().blocks.tts?.reason, "tts_source");
    s.state.voiceSettings = { mode: "original", mic_mode: "off" };
    s.render();
    assert.equal(s.read().blocks.tts, undefined);
});

test("before the engine is ready nothing is blocked and nothing is asked", async () => {
    const s = await load();
    s.state.ready = false;
    assert.deepEqual(s.render(), {});
    assert.deepEqual(s.state.published, {});
    assert.deepEqual(s.asked(), []);
});

test("the chat reading models are asked again on a language change or a finished download only", async () => {
    const s = await load();
    s.render();
    assert.deepEqual(s.asked(), ["get"]);
    s.render();
    assert.deepEqual(s.asked(), ["get"]);
    s.state.language = "Korean";
    s.render();
    s.state.jobs = { "ppocrv5-korean": { phase: "downloading" } };
    s.render();
    assert.deepEqual(s.asked(), ["get", "get"]);
    s.state.jobs = { "ppocrv5-korean": { phase: "ready" } };
    s.render();
    assert.deepEqual(s.asked(), ["get", "get", "get"]);
});

test("each action opens its place and never downloads or turns a switch on", async () => {
    const s = await load();
    const { prepare } = s.read();
    s.calls.length = 0;
    prepare("translation");
    prepare("ocr_models");
    prepare("transcription");
    // The speech recognition models: the setup, which reviews them before anything is downloaded (#1225).
    prepare("recognition_setup");
    prepare(null);
    assert.deepEqual(s.calls, [["review", false], ["tab", "ocr"], ["opened", true], "focus",
        ["tab", "transcription"], ["opened", true], "setup"]);
});

test("the shared atom is written only when a block changes", async () => {
    const s = await load();
    s.render();
    s.render();
    const writes = () => s.calls.filter(call => Array.isArray(call) && call[0] === "publish");
    assert.equal(writes().length, 1);
    s.state.language = "Korean"; // asked again, but the answer is the same
    s.render();
    assert.equal(writes().length, 1);
    s.state.ocr = { ...s.state.ocr, missing_models: [] };
    s.render();
    assert.deepEqual(writes().at(-1), ["publish", {}]);
});
