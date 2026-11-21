import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { hooks, loadModule } from "../test/hookHarness.ts";
import type { HookRuntime, TreeNode } from "../test/hookHarness.ts";
import { downloadProgress } from "../main/setupNeeds.ts";
import type { BackendErrorReport } from "../_useBackendErrorHandling.ts";
import * as translatorLabel from "../main/translatorLabel.ts";

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
    is_pending?: boolean;
    progress?: number | null;
}
type Call = [string, ...unknown[]];

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
        pendingCTranslate2WeightTypeStatus: (id: string) => { weight({ is_pending: true }); calls.push(["pending", id]); },
        downloadCTranslate2WeightTypeStatus: (value: unknown) => calls.push(["/run/download_ctranslate2_weight", value]),
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
    const errors = await loadModule<typeof import("../_useBackendErrorHandling.ts")>(new URL("../_useBackendErrorHandling.ts", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t: (key: string) => key, i18n: { exists: () => true } }) },
        "@logics_common": common, "@logics_configs": configs, "@logics_main": main,
        "./ui_configs": {}, "./configs/legacyModelConsent": {}, "./configs/cloudTranscription": { CLOUD_TRANSCRIPTION_ENGINES: [] },
        "./transcription/useTranscriptionConsent": { useTranscriptionConsent: () => ({ setRequest: noop }) },
        "./translation/useTranslationSetup": setup,
        "./main/translatorLabel": translatorLabel,
        "./ocr/useOcrSetup": { useOcrSetup: () => ({ show: noop }) },
    });
    const errorHandling = errors._useBackendErrorHandling().errorHandling_Backend;
    // A 400 answer as the tests report it: no message and no result, as before.
    const error = (report: Pick<BackendErrorReport, "error_code" | "endpoint" | "data">) =>
        errorHandling({ message: undefined, result: undefined, ...report });
    let selector = false;
    const expanded: boolean[] = [];
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
        "../../../logics/main/setupNeeds": { downloadProgress },
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
    const accept = (review: TreeNode | null) => {
        assert.ok(review);
        review.props.onDownload({ weight_type: "small", consent: true }); review.props.onCancel(); render();
    };
    const enables = () => calls.filter(([path]) => path === "/set/enable/translation").length;
    context.onTestFinished(() => runtime.unmount());
    render();
    return { render, remount, press, accept, enables, calls, notices, states, weight, setup, error, expanded, selector: () => selector };
}

test("turning Translation on without its model opens the review instead of a notice", async context => {
    const s = await fixture(context);
    assert.equal(s.render(), null);
    const review = s.press();
    assert.equal(review.type, "review");
    assert.equal(review.props.kind, "ctranslate2");
    assert.equal(review.props.weightType, "small");
    assert.equal(review.props.note, "studio.setup_translation_resume", "the review says the switch will be turned on");
    assert.deepEqual(s.notices, []);
    assert.deepEqual(s.states.Translation, { data: false, state: "ok" }, "the switch settles off");
    assert.ok(!s.calls.some(([path]) => path.startsWith("/run/download")), "opening the review does not download");
});

test("after consent the switch is turned on once, when the model has arrived", async context => {
    const s = await fixture(context);
    s.accept(s.press());
    assert.equal(s.render(), null);
    assert.deepEqual(s.calls.slice(-2), [["pending", "small"], ["/run/download_ctranslate2_weight", { weight_type: "small", consent: true }]]);
    assert.equal(s.enables(), 1, "nothing is retried while the model is on its way");
    s.weight({ progress: 40 });
    s.render();
    assert.equal(s.enables(), 1);
    s.weight({ is_downloaded: true, is_pending: false, progress: null });
    s.render();
    assert.equal(s.enables(), 2);
    assert.deepEqual(s.notices, [["success", "studio.setup_translation_ready"]]);
    s.render();
    assert.equal(s.enables(), 2, "one continuation only");
});

test("changing the UI language while the model downloads still turns the switch on when it arrives", async context => {
    const s = await fixture(context);
    s.accept(s.press());
    s.weight({ progress: 40 });
    assert.equal(await s.remount(), null);
    assert.equal(s.enables(), 1);
    s.weight({ is_downloaded: true, is_pending: false, progress: null });
    s.render();
    assert.equal(s.enables(), 2);
    assert.deepEqual(s.notices, [["success", "studio.setup_translation_ready"]]);
});

test("a cancelled or failed download leaves Translation off, even if the model arrives later", async context => {
    const s = await fixture(context);
    s.accept(s.press());
    s.weight({ is_pending: false, progress: null });
    s.render();
    s.weight({ is_downloaded: true });
    s.render();
    assert.equal(s.enables(), 1);
    assert.deepEqual(s.notices, []);
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

test("a review opened from the empty conversation fetches the model without turning Translation on", async context => {
    const s = await fixture(context);
    s.setup.useTranslationSetup().open(false);
    const review = s.render();
    assert.ok(review);
    assert.equal(review.props.note, null, "the review keeps saying nothing is turned on");
    s.accept(s.render());
    s.weight({ is_downloaded: true, is_pending: false, progress: null });
    s.render();
    assert.equal(s.enables(), 0);
    assert.deepEqual(s.notices, []);
});

test("a missing model reported for anything but the switch is a notice, as before", async context => {
    const s = await fixture(context);
    s.error({ error_code: "TRANSLATION_MODEL_MISSING", endpoint: "/run/send_message_box", data: false });
    assert.equal(s.render(), null);
    assert.deepEqual(s.notices, [["error", "TRANSLATION_MODEL_MISSING"]]);
});
