import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { componentNamed, findIn, hooks, kitStandIns, loadModule, find, setRef, stubGlobals } from "../test/hookHarness.ts";
import type { HookRuntime } from "../test/hookHarness.ts";
import * as endpointPrivacy from "./endpointPrivacy.ts";
import * as languageNames from "./languageNames.ts";
import * as modelCatalog from "../voice/modelCatalog.ts";
import * as modelHardwareWarning from "../voice/modelHardwareWarning.ts";
import * as modelRestrictions from "../voice/modelRestrictions.ts";

const boxes = new URL("../../views/app/config_page/setting_section/setting_box/", import.meta.url);
const entry = { id: "reviewed-model", name: "Reviewed model", target: "rvc", total_bytes: 100,
    provider: "Provider", license: "MIT", notice: "permissive", source: "https://example.test/model",
    licenses: [], artifacts: [], destination: "/models/reviewed" };

type Kind = "catalog" | "ocr" | "nllb";
type OpenerState = "present" | "removed" | "disabled";

// The catalog's headings as they are, with the hint mark as a name: the catalog draws them in place.
const loadHeading = (runtime: HookRuntime) => loadModule<typeof import("../../views/app/config_page/setting_section/setting_box/advanced_settings/catalogHeading.tsx")>(new URL("../../views/app/config_page/setting_section/setting_box/advanced_settings/catalogHeading.tsx", import.meta.url), runtime,
    { "../_components/hint/Hint": { Hint: "hint" } });

async function fixture(context: TestContext, kind: Kind, openerState: OpenerState) {
    const runtime = hooks(), calls: [string, unknown?][] = [], focus: string[] = [], order: string[] = [];
    const control = (name: string) => ({ isConnected: true, disabled: false, tabIndex: 0,
        getAttribute: () => null, closest: () => null, focus: () => focus.push(name) });
    const fallbackControl = control("nearby control");
    const scope = { ...control("model group"), tabIndex: -1, querySelectorAll: () => [fallbackControl] };
    // The caller's section holds a control of its own, apart from the model row's.
    const section = { ...control("model section"), tabIndex: -1, querySelectorAll: () => [control("section control")] };
    // The opener's model row or setting, which the hook looks for by these attributes.
    const opener = { ...control("opener"), closest: (selector: string) => selector === "[data-model-download], [data-setting-id]" ? scope : null };
    stubGlobals(context, { document: { activeElement: opener } });
    const modal = { open: false, showModal() { this.open = true; },
        close() { this.open = false; order.push("close"); } };
    const dialogHooks = await loadModule(new URL("./useConsentDialog.ts", import.meta.url), runtime);
    const downloads = { catalog: { models: [{ ...entry, target: kind === "ocr" ? "ocr" : "rvc" }],
        catalog_version: "reviewed-catalog" }, state: { jobs: {} }, hardware: {}, ensureHardware: () => {}, send: (endpoint: string, data?: unknown) => {
        calls.push([endpoint, data]);
        if (endpoint.startsWith("/run/")) order.push("request");
    } };
    let ended = false;
    const end = () => { assert.equal(modal.open, false, "close() precedes unmount"); ended = true; order.push("unmount"); };
    const imports = {
        "@tauri-apps/api/core": { isTauri: () => false },
        "@tauri-apps/plugin-opener": { openUrl: () => assert.fail("no link activation") },
        "../../../../../../logics/common/endpointPrivacy": endpointPrivacy,
        "../../../../../../logics/common/useConsentDialog": dialogHooks,
        "../../../../../../../logics/common/useConsentDialog": dialogHooks,
        "../../../../../../logics/voice/useModelDownloads": { useModelDownloads: () => downloads },
        "../../../../../../../logics/voice/useModelDownloads": { useModelDownloads: () => downloads },
        "../../../../../../logics/voice/modelHardwareAdvice": { modelAdvice: () => ({}) },
        "../../../../../../logics/voice/modelCatalog": modelCatalog,
        "../../../../../../logics/voice/modelHardwareWarning": modelHardwareWarning,
        "../../../../../../logics/voice/modelRestrictions": modelRestrictions,
        "./EngineCatalog": { EngineCatalog: "engines" },
        "./UserModels": { UserModelCards: "user-model-cards", UserModelRegistration: "user-model-registration" },
        "./VoiceAudition": { AuditionButton: "audition-button", AuditionNote: "audition-note" },
        "./InputChoice": { InputChoice: "input-choice" },
        "../../../../../../logics/transcription/listeningModel": await import("../transcription/listeningModel.ts"),
        "../_components/hint/Hint": { Hint: "hint", useHintDescriptions: () => false },
        "../_components/fold/Fold": { Fold: "fold" },
        "./catalogHeading": await loadHeading(runtime),
        "./catalogLayout": { useCatalogLayout: () => "list", CatalogList: "ul", CatalogFacts: "catalog-facts", CatalogLayoutSwitch: "catalog-layout-switch", CatalogSection: "catalog-section" },
        "../advanced_settings/catalogLayout": { useCatalogLayout: () => "list", CatalogList: "ul", CatalogFacts: "catalog-facts", CatalogLayoutSwitch: "catalog-layout-switch", CatalogSection: "catalog-section" },
        "../../../../../../logics/common/languageNames": languageNames,
        "../_components/env_readout/EnvReadout": { EnvReadout: "readout" },
        "../../../../../../logics/configs/ctranslate2License": {},
        // The translation review reads which translation models the app can use (#947).
        "@logics_configs": { useTranslation: () => ({ currentCTranslate2WeightTypeStatus: { state: "ok", data: [] } }) },
        "../_templates/Templates": {}, "../_components": {},
        "../_components/compute_device/ComputeDevice": {}, "../_components/setup_section/SetupSection": {}, "../_components/advanced_section/AdvancedSection": {},
        "../_components/description/Description": {}, "../_components/custom_model_link/CustomModelLink": {},
        "../_components/credential_pair/CredentialPair": {}, "../_components/lead/Lead": {},
        "../_components/download_models/LegacyModelDownloadDialog": {}, "../shared_items/SharedItems": {},
        "../../advanced_settings/ModelDownloads": { ModelDownloads: () => null },
        "../custom_model_link/CustomModelLink": { CustomModelLink: () => null },
        "../../../../../../logics/main/setupNeeds": { translationDownloadable: () => null },
        "../../../../../../../logics/main/setupNeeds": { translationCatalogIds: () => [] },
        "../../../../../../logics/translation/localModelList": { localModelList: (rows?: unknown[]) => ({ rows: rows ?? [], unavailable: false }) },
        "../../../../../../logics/translation/useTranslationCatalog": { useTranslationCatalog: () => ({ catalog: null }) },
        "../../../../../../logics/translation/translationCatalog": { isUsersWeight: () => false, weightLabel: (weight: string) => weight, ENGINE_FORM_SETTING_ID: "translation_catalog_add_engine" },
        "../../../../../../logics/configs/revealSetting.ts": { revealSetting() {} },
        "../../../../../../logics/configs/fieldChecks.ts": {},
        "../_components/form_row/FormRow": { FormRow: () => null },
        "./TranslationCatalog": { TranslationCatalogGroup: () => null },
        "./TranslationGpuRuntimes": { TranslationGpuRuntimes: () => null },
        "../../../../../../logics/main/translatorLabel.ts": { LOCAL_TRANSLATION_ENGINE: "CTranslate2", translatorLabel: () => "" }, "@logics_main": {},
        "../_components/compute_device/computeDeviceOptions": { computeDeviceLabel: (device?: { device_name?: string }) => device?.device_name, needsRestart: () => false },
        "@ui_configs": {}, "@logics_common": {}, "@store": {},
    };
    const paths: Record<Kind, [string, string]> = { catalog: ["advanced_settings/ModelDownloads.tsx", "ModelDownloads"],
        ocr: ["ocr/OcrModels.tsx", "OcrModels"], nllb: ["translation/Translation.tsx", "CTranslate2LicenseDialog"] };
    const [path, name] = paths[kind];
    // The component named for this kind; the props below are the ones for that kind.
    const Component = componentNamed(await loadModule(new URL(path, boxes), runtime, imports), name);
    // The catalog tells its caller which download the user started (#1015).
    const started: string[] = [];
    const props = kind === "catalog" ? { targets: ["rvc"], onStart: (id: string) => started.push(id) } : kind === "ocr"
        ? { ids: [entry.id], missing: [entry.id], onChanged: () => {}, title: "OCR models" }
        : { weight: entry, action: "select", fallback: { current: section },
            onCancel: end, onConfirm: () => { calls.push(["select"]); end(); } };
    // The dialogs are the kit's Dialog (D-23), its buttons the kit's Button.
    const render = () => runtime.render(Component, props, tree => {
        const dialog = find(tree, node => node.type === kitStandIns.Dialog);
        // The test points the refs at its stand-ins.
        if (dialog) setRef(dialog, modal);
        if (tree.type === "section") setRef(tree, section);
    });
    context.onTestFinished(() => runtime.unmount());
    let tree = render();
    if (["catalog", "ocr"].includes(kind)) {
        // The OCR models' review is the kit's Button; the catalog's is still the form's.
        findIn(tree, node => (node.type === "button" || node.type === kitStandIns.Button) && node.props.children === "model_downloads.review").props.onClick();
    }
    tree = render();
    const commit = async () => {
        if (openerState === "removed") opener.isConnected = false;
        if (openerState === "disabled") opener.disabled = true;
        if (ended) runtime.unmount();
        else {
            assert.equal(modal.open, false, "close() precedes the render that removes the dialog");
            assert.equal(find(render(), node => node.type === kitStandIns.Dialog), null);
        }
        await Promise.resolve();
    };
    return { render, tree, modal, calls, started, focus, order, commit, runtime, scope, opener, fallbackControl };
}

for (const kind of ["catalog", "ocr", "nllb"] as const) {
    for (const path of ["back/cancel", "start/consent", "escape"]) {
        for (const openerState of ["present", "removed", "disabled"] as const) {
            test(`${kind}: ${path} closes before unmount and restores focus (${openerState} opener)`, async context => {
                const s = await fixture(context, kind, openerState);
                let tree = s.tree;
                const start = () => findIn(tree, node => node.type === kitStandIns.Button &&
                    ["model_downloads.start", "config_page.translation.ctranslate2_weight_type.confirm_select"].includes(node.props.children));
                assert.equal(s.modal.open, true);
                assert.equal(start().props.disabled, true);
                start().props.onClick(); // A disabled handler cannot bypass consent.
                assert.equal(s.calls.filter(([endpoint]) => !endpoint.startsWith("/get/")).length, 0);
                if (path === "start/consent") {
                    findIn(tree, node => node.type === "input" && node.props.type === "checkbox").props.onChange({ target: { checked: true } });
                    tree = s.render();
                    assert.equal(start().props.disabled, false);
                    assert.equal(s.calls.filter(([endpoint]) => !endpoint.startsWith("/get/")).length, 0);
                    start().props.onClick();
                } else if (path === "escape") {
                    // The kit's Dialog keeps Esc from closing it and asks its owner (Dialog.test.ts).
                    findIn(tree, node => node.type === kitStandIns.Dialog).props.onOpenChange(false);
                } else findIn(tree, node => node.type === kitStandIns.Button && node.props.autoFocus).props.onClick();
                assert.equal(s.modal.open, false);
                await s.commit();
                assert.deepEqual(s.focus, [openerState === "present" ? "opener" : "nearby control"]);
                assert.equal(s.order.filter(event => event === "close").length, 1);
                const writes = s.calls.filter(([endpoint]) => !endpoint.startsWith("/get/"));
                assert.equal(writes.length, path === "start/consent" ? 1 : 0);
                if (path === "start/consent" && ["catalog", "ocr"].includes(kind)) {
                    assert.deepEqual(writes[0], ["/run/start_model_download", { id: entry.id, consent: true, catalog_version: "reviewed-catalog" }]);
                }
                if (kind === "catalog") assert.deepEqual(s.started, path === "start/consent" ? [entry.id] : []);
            });
        }
    }
}

test("a pending download with no enabled nearby control returns focus to its named section", async context => {
    const s = await fixture(context, "catalog", "disabled");
    s.fallbackControl.disabled = true;
    findIn(s.tree, node => node.type === kitStandIns.Button && node.props.autoFocus).props.onClick();
    await s.commit();
    assert.deepEqual(s.focus, ["model section"]);
});

test("NLLB falls back to the labelled section when its template has no enabled controls", async context => {
    const s = await fixture(context, "nllb", "disabled");
    s.fallbackControl.disabled = true;
    findIn(s.tree, node => node.type === kitStandIns.Button && node.props.autoFocus).props.onClick();
    await s.commit();
    assert.deepEqual(s.focus, ["model section"]);
});

test("removing the entire model row uses a control in the stable section", async context => {
    const s = await fixture(context, "ocr", "removed");
    s.scope.isConnected = false;
    findIn(s.tree, node => node.type === kitStandIns.Button && node.props.autoFocus).props.onClick();
    await s.commit();
    assert.deepEqual(s.focus, ["section control"]);
});
