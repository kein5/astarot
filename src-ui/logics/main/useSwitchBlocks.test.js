import assert from "node:assert/strict";
import { test } from "node:test";
import { hooks, loadModule } from "../test/hookHarness.js";
import * as switchBlocks from "./switchBlocks.js";

const load = async () => {
    const runtime = hooks(), calls = [];
    const state = { ready: true, needs: [], language: "Japanese", fullReadiness: null, jobs: {},
        ocr: { language: "Japanese", language_supported: true, required_models: ["a"], missing_models: ["a"] },
        voiceSettings: null, directState: {} };
    const mod = await loadModule(new URL("./useSwitchBlocks.js", import.meta.url), runtime, {
        "@logics_configs": { useOcr: () => ({
            currentOcrModelReadiness: { data: state.ocr }, currentOcrSourceLanguage: { data: state.language },
            currentOcrReadiness: { data: state.fullReadiness }, getOcrModelReadiness: () => calls.push("get"),
        }) },
        "@store": {
            useStore_IsBackendReady: () => ({ currentIsBackendReady: { data: state.ready } }),
            useStore_IsOpenedConfigPage: () => ({ updateIsOpenedConfigPage: value => calls.push(["opened", value]) }),
            useStore_SelectedConfigTabId: () => ({ updateSelectedConfigTabId: value => calls.push(["tab", value]) }),
        },
        "./useSetupNeeds": { useSetupNeeds: () => ({ needs: state.needs }) },
        "./switchBlocks": switchBlocks,
        "../voice/useVoice": { useVoice: () => ({ settings: state.voiceSettings, directState: state.directState }) },
        "../voice/useModelDownloads": { useModelDownloads: () => ({ state: { jobs: state.jobs } }) },
        "../translation/useTranslationSetup": { useTranslationSetup: () => ({ open: resume => calls.push(["review", resume]) }) },
        "../ocr/useOcrSetup": { focusOcrModels: () => calls.push("focus") },
    });
    return { render: () => runtime.render(mod.useSwitchBlocks), state, calls };
};

test("the blocks follow the settings as they change, without a restart", async () => {
    const s = await load();
    assert.deepEqual(s.render().blocks.ocr, { reason: "ocr_models", action: "ocr_models" });
    s.state.ocr = { ...s.state.ocr, missing_models: [] };
    assert.equal(s.render().blocks.ocr, undefined);
    s.state.voiceSettings = { mode: "off", mic_mode: "off" };
    assert.equal(s.render().blocks.tts.reason, "tts_source");
    s.state.voiceSettings = { mode: "original", mic_mode: "off" };
    assert.equal(s.render().blocks.tts, undefined);
});

test("before the engine is ready nothing is blocked and nothing is asked", async () => {
    const s = await load();
    s.state.ready = false;
    assert.deepEqual(s.render().blocks, {});
    assert.deepEqual(s.calls, []);
});

test("the chat reading models are asked again on a language change or a finished download only", async () => {
    const s = await load();
    s.render();
    assert.deepEqual(s.calls, ["get"]);
    s.render();
    assert.deepEqual(s.calls, ["get"]);
    s.state.language = "Korean";
    s.render();
    s.state.jobs = { "ppocrv5-korean": { phase: "downloading" } };
    s.render();
    assert.deepEqual(s.calls, ["get", "get"]);
    s.state.jobs = { "ppocrv5-korean": { phase: "ready" } };
    s.render();
    assert.deepEqual(s.calls, ["get", "get", "get"]);
});

test("each action opens its place and never downloads or turns a switch on", async () => {
    const s = await load();
    const { prepare } = s.render();
    s.calls.length = 0;
    prepare("translation");
    prepare("ocr_models");
    prepare("transcription");
    prepare(null);
    assert.deepEqual(s.calls, [["review", false], ["tab", "ocr"], ["opened", true], "focus",
        ["tab", "transcription"], ["opened", true]]);
});
