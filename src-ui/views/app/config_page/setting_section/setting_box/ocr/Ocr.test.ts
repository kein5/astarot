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
// arrives it is drawn as it will be, its line keeps the lines of its longest state, and its model's
// bar stays once the model is on the PC.
test("the chatbox detector's part keeps one size before and after the readiness arrives", async () => {
    const runtime = hooks();
    let answer: object | null = null;
    const { OcrChatboxDetector_Box } = await loadModule<typeof import("./Ocr.tsx")>(new URL("./Ocr.tsx", import.meta.url), runtime, {
        "../../../../../../logics/common/languageNames.ts": { createLanguageNames: () => ({ language: (id: string) => id }) },
        "@logics_configs": {
            useOcr: () => ({ currentOcrReadiness: { state: "ok", data: answer }, getOcrReadiness: () => undefined,
                currentOcrCaptureStatus: { state: "ok", data: null }, currentOcrUseChatboxDetector: { state: "ok", data: true },
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
    assert.deepEqual(part(null), { checked: false, is_available: false, toggles: false, current: "config_page.ocr.readiness.checking", ...line,
        ids: [], missing: [], checking: true });
    assert.deepEqual(part(readiness(false)), { checked: false, is_available: false, toggles: false, current: "config_page.ocr.detector.status_missing", ...line,
        ids: [MODEL], missing: [MODEL], checking: false });
    assert.deepEqual(part(readiness(true)), { checked: true, is_available: true, toggles: true, current: "config_page.ocr.detector.status_ready", ...line,
        ids: [MODEL], missing: [], checking: false });
    // A core that names no detector has none to offer.
    answer = { engine: true };
    assert.equal(runtime.render(OcrChatboxDetector_Box, {}), null);
    runtime.unmount();
});
