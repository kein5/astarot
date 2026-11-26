import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { hooks, loadModule } from "../test/hookHarness.ts";
import type { HookRuntime, TreeNode } from "../test/hookHarness.ts";
import type { BackendErrorReport } from "../_useBackendErrorHandling.ts";
import * as translatorLabel from "../main/translatorLabel.ts";
import * as fieldErrors from "../configs/fieldErrors.ts";

const noop = () => {};
const api = <T extends object>(values: T) => new Proxy(values, { get: (object, name) => Reflect.get(object, name) ?? noop });
// A function given to an atom's update in place of its value.
const isUpdate = (value: unknown): value is (previous: unknown) => unknown => typeof value === "function";

interface SwitchState {
    data: unknown;
    state: string;
}
interface WeightRow {
    id: string;
    is_downloaded: boolean;
}
// A download of the catalog, as /get/data/model_download_state lists it by model.
interface CatalogJob {
    job_id: string;
    phase: string;
}
type Call = [string, ...unknown[]];
const applies = (calls: Call[]) => calls.filter(([path]) => path === "/run/apply_model_download");

async function fixture(context: TestContext) {
    const runtime = hooks(), calls: Call[] = [], notices: [string, unknown][] = [];
    const setup = await loadModule<typeof import("./useTranslationSetup.ts")>(new URL("./useTranslationSetup.ts", import.meta.url), runtime);
    const states: Record<string, SwitchState> = {};
    const mainStore: Record<string, unknown> = { store: { backend_subprocess: {} } };
    for (const name of ["Translation", "TranscriptionSend", "TranscriptionReceive", "OcrCapture", "Foreground"]) {
        states[name] = { data: false, state: "ok" };
        mainStore[`useStore_${name}Status`] = () => ({
            [`current${name}Status`]: states[name],
            [`pending${name}Status`]: () => { states[name].state = "pending"; },
            [`update${name}Status`]: (value: unknown, options?: { set_state?: string }) => {
                const data = isUpdate(value) ? value(states[name]) : value;
                states[name] = { data, state: options?.set_state ?? "ok" };
            },
        });
    }
    const main = await loadModule<typeof import("../main/useMainFunction.ts")>(new URL("../main/useMainFunction.ts", import.meta.url), runtime, {
        "@store": mainStore,
        "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython: async (...args: Call) => { calls.push(args); return true; } }) },
    });
    const weightRows: WeightRow[] = [{ id: "small", is_downloaded: false }];
    const translationValues = {
        currentCTranslate2WeightTypeStatus: { data: weightRows },
        currentSelectedCTranslate2WeightType: { data: "small", state: "ok" },
    };
    const translation = api(translationValues);
    const weight = (values: Partial<WeightRow>) => { translation.currentCTranslate2WeightTypeStatus = { data: [{
        ...translation.currentCTranslate2WeightTypeStatus.data[0], ...values }] }; };
    const configs: Record<string, unknown> = { useTranslation: () => translation, ocrStartErrorKey: () => null, ocrShouldRestoreSharedWindow: () => false };
    for (const name of ["Transcription", "Others", "Ocr", "OcrSharedWindow", "AdvancedSettings"]) configs[`use${name}`] = () => api({});
    const common: Record<string, unknown> = { useNotificationStatus: () => api({
        showNotification_Error: (_message: unknown, options?: { category_id?: unknown }) => notices.push(["error", options?.category_id]),
        showNotification_Success: (message: unknown) => notices.push(["success", message]),
    }) };
    for (const name of ["Volume", "LLMConnection", "IsSoftwareUpdating"]) common[`use${name}`] = () => api({});
    const errors = await loadModule<typeof import("../_useBackendErrorHandling.ts")>(new URL("../_useBackendErrorHandling.ts", import.meta.url), runtime, { "./configs/fieldErrors.ts": fieldErrors,
        "@useI18n": { useI18n: () => ({ t: (key: string) => key, i18n: { exists: () => true } }) },
        "@logics_common": common, "@logics_configs": configs, "@logics_main": main,
        "./ui_configs": {}, "./configs/cloudTranscription": { CLOUD_TRANSCRIPTION_ENGINES: [] },
        "./transcription/useTranscriptionConsent": { useTranscriptionConsent: () => ({ setRequest: noop }) },
        "./translation/useTranslationSetup": setup,
        "./main/translatorLabel": translatorLabel,
        "./ocr/useOcrSetup": { useOcrSetup: () => ({ show: noop }) },
        "./transcription/useRecognitionFix": { useRecognitionFix: () => ({ open: noop }) },
        "./transcription/recognitionFix": { recognitionFixOf: () => null },
    });
    const errorHandling = errors._useBackendErrorHandling().errorHandling_Backend;
    // A 400 answer as the tests report it: no message and no result, as before.
    const error = (report: Pick<BackendErrorReport, "error_code" | "endpoint" | "data">) =>
        errorHandling({ message: undefined, result: undefined, ...report });
    let selector = false;
    const expanded: boolean[] = [];
    // The catalog's downloads (#1015): "small" is made into the catalog's small-onnx-* models.
    const jobs: Record<string, CatalogJob> = {};
    const catalogIds = (weightType: unknown) => weightType === "small" ? ["small-onnx-float32", "small-onnx-int8"] : [];
    const controller = async (owner: HookRuntime) => loadModule<typeof import("../../views/app/_app_controllers/TranslationSetupController.tsx")>(
        new URL("../../views/app/_app_controllers/TranslationSetupController.tsx", import.meta.url), owner, {
        "@logics_configs": configs, "@logics_common": common,
        "@logics_main": { ...main, useIsMainPageCompactMode: () => ({ expandSidebar: () => expanded.push(true) }) },
        "@store": { useStore_IsOpenedTranslatorSelector: () => ({ updateIsOpenedTranslatorSelector: (value: boolean) => { selector = value; } }) },
        "../../../logics/translation/useTranslationSetup": setup,
        "../../../logics/translation/useOpenTranslatorList": await loadModule(new URL("./useOpenTranslatorList.ts", import.meta.url), owner, {
            "@logics_main": { useIsMainPageCompactMode: () => ({ expandSidebar: () => expanded.push(true) }) },
            "@store": { useStore_IsOpenedTranslatorSelector: () => ({ updateIsOpenedTranslatorSelector: (value: boolean) => { selector = value; } }) },
        }),
        "../../../logics/main/setupNeeds": { translationCatalogIds: catalogIds },
        "../../../logics/voice/useModelDownloads": { useModelDownloads: () => ({ state: { jobs },
            send: async (...args: Call) => { calls.push(args); } }) },
        "../config_page/setting_section/setting_box/_components/download_models/LegacyModelDownloadDialog": { LegacyModelDownloadDialog: "review" },
    });
    let { TranslationSetupController } = await controller(runtime);
    let owner = runtime;
    const render = () => owner.render(TranslationSetupController);
    // The engine starting again draws the controller again (the start-up lock takes it away), as a
    // change of the UI language did until #904.
    const remount = async () => {
        owner.unmount();
        const next = hooks();
        next.store = runtime.store;
        ({ TranslationSetupController } = await controller(next));
        owner = next;
        return render();
    };
    // The review a press opens; none fails here, as reading its props would.
    const press = () => {
        main.useMainFunction().toggleTranslation();
        error({ error_code: "TRANSLATION_MODEL_MISSING", endpoint: "/set/enable/translation", data: false });
        const review = render();
        assert.ok(review);
        return review;
    };
    // The download of a variant of the model the review is about, started on its card.
    const accept = (review: TreeNode | null) => {
        assert.ok(review);
        review.props.onCatalogStart("small-onnx-int8"); review.props.onCancel(); render();
    };
    const enables = () => calls.filter(([path]) => path === "/set/enable/translation").length;
    context.onTestFinished(() => runtime.unmount());
    render();
    return { render, remount, press, accept, enables, calls, notices, states, weight, setup, error, expanded, jobs, selector: () => selector };
}

test("turning Translation on without its model opens the review instead of a notice", async context => {
    const s = await fixture(context);
    assert.equal(s.render(), null);
    const review = s.press();
    assert.equal(review.type, "review");
    assert.equal(review.props.weightType, "small");
    assert.equal(review.props.note, "studio.setup_translation_resume", "the review says the switch will be turned on");
    assert.deepEqual(s.notices, []);
    assert.deepEqual(s.states.Translation, { data: false, state: "ok" }, "the switch settles off");
    assert.ok(!s.calls.some(([path]) => path.startsWith("/run/download")), "opening the review does not download");
});

test("changing the UI language while the model downloads still turns the switch on when it arrives", async context => {
    const s = await fixture(context);
    s.accept(s.press());
    s.jobs["small-onnx-int8"] = { job_id: "j1", phase: "downloading" };
    assert.equal(await s.remount(), null);
    assert.equal(s.enables(), 1);
    s.jobs["small-onnx-int8"] = { job_id: "j1", phase: "ready" };
    s.render();
    assert.equal(applies(s.calls).length, 1);
    s.weight({ is_downloaded: true });
    s.render();
    assert.equal(s.enables(), 2);
    assert.deepEqual(s.notices, [["success", "studio.setup_translation_ready"]]);
});

test("going back, or choosing another translator, downloads nothing and leaves Translation off", async context => {
    const s = await fixture(context);
    s.press().props.onCancel();
    assert.equal(s.render(), null);
    const review = s.press();
    review.props.onCancel();
    review.props.extraAction.onClick();
    assert.equal(s.selector(), true);
    assert.deepEqual(s.expanded, [true], "the icon rail has no translator list; the full rail opens to show it");
    assert.equal(review.props.extraAction.label, "studio.setup_other_translator");
    assert.ok(!s.calls.some(([path]) => path.startsWith("/run/download")));
    assert.equal(s.states.Translation.data, false);
});

test("asking for another translator opens the list once, and drawing the page again does not reopen it", async context => {
    const s = await fixture(context);
    s.setup.useTranslationSetup().chooseTranslator();
    assert.equal(s.render(), null, "no review opens");
    assert.equal(s.selector(), true);
    assert.deepEqual(s.expanded, [true]);
    await s.remount();
    assert.deepEqual(s.expanded, [true]);
    assert.ok(!s.calls.some(([path]) => path.startsWith("/run/download")));
});

test("a missing model reported for anything but the switch is a notice, as before", async context => {
    const s = await fixture(context);
    s.error({ error_code: "TRANSLATION_MODEL_MISSING", endpoint: "/run/send_message_box", data: false });
    assert.equal(s.render(), null);
    assert.deepEqual(s.notices, [["error", "TRANSLATION_MODEL_MISSING"]]);
});

// #1015: the review lists the translation models of the catalog; the download starts on a card.

test("a translation model fetched from the catalog is applied once and then turns the switch on", async context => {
    const s = await fixture(context);
    // A failed try of before: its end is not this download's.
    s.jobs["small-onnx-int8"] = { job_id: "before", phase: "failed" };
    const review = s.press();
    review.props.onCatalogStart("small-onnx-int8"); review.props.onCancel();
    assert.equal(s.render(), null);
    s.jobs["small-onnx-int8"] = { job_id: "j1", phase: "downloading" };
    s.render();
    assert.deepEqual(applies(s.calls), []);
    s.jobs["small-onnx-int8"] = { job_id: "j1", phase: "ready" };
    s.render();
    s.render();
    assert.deepEqual(applies(s.calls), [["/run/apply_model_download", { id: "small-onnx-int8", job_id: "j1", expected: {} }]], "applied once");
    assert.equal(s.enables(), 1, "the switch waits for the core to have the model");
    s.jobs["small-onnx-int8"] = { job_id: "j1", phase: "applied" };
    s.weight({ is_downloaded: true });
    s.render();
    assert.equal(s.enables(), 2);
    assert.deepEqual(s.notices, [["success", "studio.setup_translation_ready"]]);
});

test("a failed or cancelled catalog download leaves Translation off, even if the model arrives later", async context => {
    for (const phase of ["failed", "cancelled"]) {
        const s = await fixture(context);
        s.press().props.onCatalogStart("small-onnx-int8");
        s.jobs["small-onnx-int8"] = { job_id: "j1", phase };
        s.render();
        s.weight({ is_downloaded: true });
        s.render();
        assert.equal(s.enables(), 1, phase);
        assert.deepEqual(applies(s.calls), [], phase);
        assert.deepEqual(s.notices, [], phase);
    }
});

test("another model of the catalog, or a review the switch did not open, turns nothing on", async context => {
    const s = await fixture(context);
    // The review lists every translation model when the catalog has none of the selected one.
    const review = s.press();
    review.props.onCatalogStart("other-onnx-int8"); review.props.onCancel();
    s.jobs["other-onnx-int8"] = { job_id: "j1", phase: "ready" };
    s.render();
    assert.deepEqual(applies(s.calls), [], "the user applies it on its card");
    s.setup.useTranslationSetup().open(false);
    const quiet = s.render();
    assert.equal(quiet?.props.note, null, "the review from the empty conversation says nothing is turned on");
    quiet?.props.onCatalogStart("small-onnx-int8");
    s.jobs["small-onnx-int8"] = { job_id: "j2", phase: "ready" };
    s.render();
    s.weight({ is_downloaded: true });
    s.render();
    assert.deepEqual(applies(s.calls), []);
    assert.equal(s.enables(), 1);
    assert.deepEqual(s.notices, []);
});
