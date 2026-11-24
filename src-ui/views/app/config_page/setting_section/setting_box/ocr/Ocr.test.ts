import assert from "node:assert/strict";
import { test } from "vitest";
import { findIn, hooks, loadModule } from "../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../logics/test/hookHarness.ts";
import * as ocrReadiness from "../../../../../../logics/configs/ocrReadiness.ts";

const MODEL = "vrct-vox-chatbox-detector";
const STATES = ["on", "ready", "restart", "paused", "off", "missing"].map(state => `config_page.ocr.detector.status_${state}`);
const readiness = (installed: boolean) => ({ engine: true, detector_model: MODEL, detector_installed: installed, detector_enabled: true,
    runtime: { active: false, state: "stopped" } });

// #912: the chatbox detector's part has one size from the page's opening on: before the readiness
// arrives it is drawn as it will be (its switch as saved, unavailable), its line keeps the lines of
// its longest state, and its model's bar stays once the model is on the PC.
test("the chatbox detector's part keeps one size before and after the readiness arrives", async () => {
    const runtime = hooks();
    let answer: object | null = null, startup: object | null = null;
    let saved = true;
    const { OcrChatboxDetector_Box, Main_Container } = await loadModule<typeof import("./Ocr.tsx")>(new URL("./Ocr.tsx", import.meta.url), runtime, {
        "../../../../../../logics/common/languageNames.ts": { createLanguageNames: () => ({ language: (id: string) => id }) },
        "@logics_configs": {
            useOcr: () => ({ currentOcrReadiness: { state: "ok", data: answer }, currentOcrModelReadiness: { state: "ok", data: startup },
                getOcrReadiness: () => undefined, currentOcrSourceLanguage: { state: "ok", data: "Japanese" }, currentOcrWindowTitle: { state: "ok", data: "VRChat" },
                currentOcrCaptureStatus: { state: "ok", data: null }, currentOcrUseChatboxDetector: { state: "ok", data: saved },
                toggleOcrUseChatboxDetector: () => undefined }),
            useSaveButtonLogic: () => ({}),
        },
        "../../../../../../logics/configs/ocrReadiness": ocrReadiness,
        "../_templates/Templates": { CheckboxContainer: "checkbox", DropdownMenuContainer: "dropdown", EntryWithSaveButtonContainer: "entry", SliderContainer: "slider" },
        "../_components": { SectionLabelComponent: "label" },
        "./OcrRegions": { OcrRegions: "regions" },
        "./OcrModels": { OcrModels: "models" },
        "../../../../../../logics/ocr/useOcrSetup": { OCR_MODELS_SETTING_ID: "ocr_models" },
        "./OcrStatus": { OcrStatus: "status" },
        "./OcrSharedWindow": { OcrSharedWindow: "shared-window" },
        "../_components/advanced_section/AdvancedSection": { AdvancedSection: "advanced" },
        "../_components/hint/Hint": { HintDescriptions: "hints" },
        "../../../../../common_components/stable_words/StableWords": { StableWords: "stable-words" },
    });
    const part = (value: object | null) => {
        answer = value;
        const tree = runtime.render(OcrChatboxDetector_Box, {});
        const pick = (type: string) => findIn(tree, (node: TreeNode) => node.type === type, type).props;
        const { variable, is_available, toggleFunction } = pick("checkbox");
        const { current, words, align } = pick("stable-words");
        const { ids, missing, checking } = pick("models");
        return { checked: variable.data, is_available, toggles: !!toggleFunction, current, words, align, ids, missing, checking };
    };
    const line = { words: STATES, align: "start" };
    assert.deepEqual(part(null), { checked: true, is_available: false, toggles: false, current: "config_page.ocr.readiness.checking", ...line,
        ids: [], missing: [], checking: true });
    // Until the answer, the switch says what was saved: on above, off here.
    saved = false;
    assert.equal(part(null).checked, false);
    saved = true;
    assert.deepEqual(part(readiness(false)), { checked: false, is_available: false, toggles: false, current: "config_page.ocr.detector.status_missing", ...line,
        ids: [MODEL], missing: [MODEL], checking: false });
    assert.deepEqual(part(readiness(true)), { checked: true, is_available: true, toggles: true, current: "config_page.ocr.detector.status_ready", ...line,
        ids: [MODEL], missing: [], checking: false });
    // The start-up answer already says whether the model is on the PC: the part is drawn as it is.
    answer = null;
    startup = { required_models: [], missing_models: [], detector_model: MODEL, detector_installed: true, detector_enabled: true };
    assert.deepEqual(part(null), { checked: true, is_available: true, toggles: true, current: "config_page.ocr.detector.status_ready", ...line,
        ids: [MODEL], missing: [], checking: false });
    startup = null;
    // The models' part takes the models from the start-up answer until the page's own one comes,
    // so its cards are there from the start; with neither, it says it is checking.
    const models = () => {
        const { ids, missing, checking } = findIn(runtime.render(Main_Container, {}), (node: TreeNode) => node.type === "models", "models").props;
        return { ids, missing, checking };
    };
    assert.deepEqual(models(), { ids: [], missing: [], checking: true });
    startup = { required_models: ["ppocrv6-small"], missing_models: ["ppocrv6-small"] };
    assert.deepEqual(models(), { ids: ["ppocrv6-small"], missing: ["ppocrv6-small"], checking: false });
    answer = { required_models: ["ppocrv6-small"], missing_models: [] };
    assert.deepEqual(models(), { ids: ["ppocrv6-small"], missing: [], checking: false });
    startup = null;
    // A core whose readiness names no detector has none to offer.
    answer = { engine: true };
    assert.equal(runtime.render(OcrChatboxDetector_Box, {}), null);
    runtime.unmount();
});

// #1111: the window name saves by itself, and an empty one is said under the field, not sent.
test("the window name saves by itself and refuses an empty name in words", async () => {
    const runtime = hooks();
    let options: { autoSave?: boolean; validate?: (value: string) => string | null } = {};
    const { OcrWindowTitle_Box } = await loadModule<typeof import("./Ocr.tsx")>(new URL("./Ocr.tsx", import.meta.url), runtime, {
        "../../../../../../logics/common/languageNames.ts": { createLanguageNames: () => ({ language: (id: string) => id }) },
        "@logics_configs": {
            useOcr: () => ({ currentOcrWindowTitle: { state: "ok", data: "VRChat" }, setOcrWindowTitle: () => undefined }),
            useSaveButtonLogic: (given: typeof options) => {
                options = given;
                return { variable: "VRChat", onChangeFunction: () => undefined, saveFunction: () => undefined, revert: () => "reverted", error: "problem" };
            },
        },
        "../../../../../../logics/configs/ocrReadiness": {},
        "../_templates/Templates": { CheckboxContainer: "checkbox", DropdownMenuContainer: "dropdown", EntryWithSaveButtonContainer: "entry", SliderContainer: "slider" },
        "../_components": { SectionLabelComponent: "label" },
        "./OcrRegions": { OcrRegions: "regions" },
        "./OcrModels": { OcrModels: "models" },
        "../../../../../../logics/ocr/useOcrSetup": { OCR_MODELS_SETTING_ID: "ocr_models" },
        "./OcrStatus": { OcrStatus: "status" },
        "./OcrSharedWindow": { OcrSharedWindow: "shared-window" },
        "../_components/advanced_section/AdvancedSection": { AdvancedSection: "advanced" },
        "../_components/hint/Hint": { HintDescriptions: "hints" },
        "../../../../../common_components/stable_words/StableWords": { StableWords: "stable-words" },
    });
    const entry = findIn(runtime.render(OcrWindowTitle_Box, {}), (node: TreeNode) => node.type === "entry", "entry").props;
    assert.equal(entry.error, "problem");
    assert.equal(entry.onRevert(), "reverted");
    assert.equal(options.validate?.("   "), "config_page.ocr.window_title.errors.empty");
    assert.equal(options.validate?.("VRChat Launcher"), null);
    runtime.unmount();
});
