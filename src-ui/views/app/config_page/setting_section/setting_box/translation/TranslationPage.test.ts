import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { componentName, componentOf, findIn, hooks, loadModule, nodesIn, treeNode } from "../../../../../../logics/test/hookHarness.ts";
import type { HookRuntime, TreeNode } from "../../../../../../logics/test/hookHarness.ts";
import * as ctranslate2License from "../../../../../../logics/configs/ctranslate2License.ts";
import * as endpointPrivacy from "../../../../../../logics/common/endpointPrivacy.ts";
import * as setupNeeds from "../../../../../../logics/main/setupNeeds.ts";
import * as localModelList from "../../../../../../logics/translation/localModelList.ts";
import * as translationCatalog from "../../../../../../logics/translation/translationCatalog.ts";
import * as uiConfigs from "../../../../../../logics/ui_configs.ts";
import * as computeDeviceOptions from "../_components/compute_device/computeDeviceOptions.ts";

// The translation settings page, drawn with the real rules it applies: which local models are listed
// and by what name, the license of a non-commercial model, when a compute device needs the app
// started again, and the warning about plain HTTP on the LAN. The shared rows are stand-ins that keep
// their props; every setting the page reads is given, and every action it takes is recorded.

const t = (key: string, variables?: object) => variables ? `${key} ${JSON.stringify(variables)}` : key;
type Setting = { state: string; data: unknown };
const ok = (data: unknown): Setting => ({ state: "ok", data });

// What a text field gave its save logic.
interface SaveRequest { variable: unknown; state?: string; label?: string; setFunction: (value: unknown) => unknown; deleteFunction?: () => unknown }
interface Engine { id: string; label?: string; is_available?: unknown }
interface PageOptions {
    values?: Record<string, unknown>;
    llm?: Record<string, unknown>;
    engines?: Engine[] | null;
    selected?: Record<string, string> | null;
    downloads?: unknown;
    catalog?: unknown;
    tauri?: boolean;
    openUrl?: (url: string) => Promise<void>;
}

const NLLB = "nllb-200-distilled-600M-ct2-int8";
// A download catalog that offers the ONNX build of M2M100 418M, made from its CTranslate2 weight.
const OFFERS_M2M = { models: [{ id: "m2m100-418m-onnx-int8", target: "translation" }] };
const M2M = "m2m100_418M-ct2-int8";
const M2M_BIG = "m2m100_1.2B-ct2-int8";
// The built-in rows as the backend lists them, with their license fields from ui_configs.
const builtin = (id: string, extra: Record<string, unknown> = {}) => {
    const row = uiConfigs.ctranslate2_weight_type_status.find(item => item.id === id);
    assert.ok(row, id);
    return { ...row, ...extra };
};

async function translationPage(options: PageOptions = {}) {
    const calls: unknown[][] = [], saves: SaveRequest[] = [], revealed: unknown[] = [], opened: string[] = [];
    // What the license dialog asked useConsentDialog for on each drawing, and how often it closed.
    const consent = { asked: [] as { open: boolean; fallback: unknown }[], closed: 0 };
    const loading = hooks();
    let active: HookRuntime = loading;
    // The module's React is the hooks of the runtime drawing at the time: each part keeps its own memory.
    const react = new Proxy(loading.api, { get: (_, key) => Reflect.get(active.api, key) });
    // A settings hook: the given value, or nothing yet; every action records its call.
    const recorder = (fields: Record<string, unknown>) => new Proxy({}, { get: (_, key) => {
        const name = String(key);
        if (name in fields) return fields[name];
        if (name.startsWith("current")) return ok(null);
        return (...args: unknown[]) => { calls.push([name, ...args]); };
    } });
    const values: Record<string, unknown> = { currentCTranslate2WeightTypeStatus: ok([]), currentSelectedTranslationComputeDevice: ok(""), ...options.values };
    const llmValues: Record<string, unknown> = { ...options.llm };
    const settings = recorder(values), llm = recorder(llmValues);
    const module = await loadModule<typeof import("./Translation.tsx")>(new URL("./Translation.tsx", import.meta.url), { ...loading, api: react }, {
        "@useI18n": { useI18n: () => ({ t }) },
        // The fields' checks are the page's own rules (#1111): the real ones.
        "../../../../../../logics/configs/fieldChecks.ts": await import("../../../../../../logics/configs/fieldChecks.ts"),
        "@tauri-apps/api/core": { isTauri: () => options.tauri ?? true },
        "@tauri-apps/plugin-opener": { openUrl: options.openUrl ?? (async (url: string) => { opened.push(url); }) },
        "@logics_configs": { useTranslation: () => settings,
            useSaveButtonLogic: (request: SaveRequest) => { saves.push(request); return { variable: request.variable, onChangeFunction: "change", saveFunction: "save" }; } },
        "@logics_common": { useLLMConnection: () => llm },
        "@store": { useStore_TranslationEngines: () => ({ currentTranslationEngines: { data: options.engines === undefined ? [] : options.engines } }),
            useStore_SelectedTranslationEngines: () => ({ currentSelectedTranslationEngines: { data: options.selected === undefined ? {} : options.selected } }) },
        "@ui_configs": uiConfigs,
        "../../../../../../logics/common/endpointPrivacy": endpointPrivacy,
        "../../../../../../logics/configs/ctranslate2License": ctranslate2License,
        "../../../../../../logics/main/setupNeeds": setupNeeds,
        "../../../../../../logics/translation/localModelList": localModelList,
        "../../../../../../logics/translation/translationCatalog": translationCatalog,
        "../_components/compute_device/computeDeviceOptions": computeDeviceOptions,
        "../../../../../../logics/common/useConsentDialog": { useConsentDialog: (open: boolean, fallback: unknown) => {
            consent.asked.push({ open, fallback });
            return { dialog: "dialog", close: () => { consent.closed++; } };
        } },
        "../../../../../../logics/voice/useModelDownloads": { useModelDownloads: () => ({ catalog: options.downloads ?? null }) },
        "../../../../../../logics/translation/useTranslationCatalog": { useTranslationCatalog: () => ({ catalog: options.catalog ?? null }) },
        "../../../../../../logics/configs/revealSetting.ts": { revealSetting: (target: unknown) => { revealed.push(target); } },
        "../_components/credential_pair/CredentialPair": { CredentialPair: "credential-pair" },
        "../_components/form_row/FormRow": { FormRow: "form-row" },
        "./TranslationCatalog": { TranslationCatalogSection: "catalog-section" },
        "./TranslationGpuRuntimes": { TranslationGpuRuntimes: "gpu-runtimes" },
        "../_templates/Templates": { DownloadModelsContainer: "download-models", AuthKeyContainer: "auth-key", EntryWithSaveButtonContainer: "entry",
            DropdownMenuContainer: "dropdown", ConnectionCheckButtonContainer: "connection-check" },
        "../_components": { SectionLabelComponent: "section-label" },
        "../_components/compute_device/ComputeDevice": { ComputeDevice: "compute-device" },
        "../_components/description/Description": { Description: "description" },
        "../_components/hint/Hint": { HintDescriptions: "hints" },
        "../_components/lead/Lead": { Lead: "lead" },
        "../_components/custom_model_link/CustomModelLink": { CustomModelLink: "custom-model-link" },
        "../_components/setup_section/SetupSection": { SetupSection: "setup-section" },
        "../_components/advanced_section/AdvancedSection": { AdvancedSection: "advanced-section" },
        "../_components/download_models/LegacyModelDownloadDialog": { LegacyModelDownloadDialog: "download-dialog" },
    });
    // Draws one of the page's own components, with hook memory of its own unless a runtime is given.
    const draw = (node: TreeNode, runtime: HookRuntime = hooks()) => {
        active = runtime;
        return runtime.render(componentOf(node), node.props);
    };
    // The first of the page's own components of that name: the parts are drawn level by level until one holds it.
    const reach = (name: string): TreeNode => {
        const queue: unknown[] = [draw(elementOf(module.Translation))];
        while (queue.length > 0) {
            const parts = nodesIn(queue.shift()).filter(node => typeof node.type === "function");
            const found = parts.find(node => componentName(node) === name);
            if (found) return found;
            for (const node of parts) queue.push(draw(node));
        }
        assert.fail(`the page has no ${name}`);
    };
    // A part drawn, and the stand-in row of that type in it.
    const row = (name: string, type: string) => findIn(draw(reach(name)), node => node.type === type, `${type} in ${name}`);
    return { module, calls, saves, revealed, opened, consent, values, llmValues, settings, draw, reach, row, tree: () => draw(elementOf(module.Translation)) };
}

// An element of one of the module's components with the given props, as the page would draw it.
function elementOf(type: unknown, props: object = {}): TreeNode {
    const node = treeNode({ type, props });
    assert.ok(node);
    return node;
}

// The words a part of the tree shows.
const textOf = (value: unknown): string => {
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (Array.isArray(value)) return value.map(textOf).join("");
    const node = treeNode(value);
    return node ? textOf(node.props.children) : "";
};
const ofType = (tree: unknown, type: string) => nodesIn(tree).filter(node => node.type === type);

test("the advanced fold counts the ready APIs and local servers apart, and opens while a language preset uses one of them", async () => {
    const apis = ["DeepL_API", "Google_Cloud_API", "Papago_API", "Plamo_API", "Gemini_API", "OpenAI_API", "Groq_API", "OpenRouter_API"];
    const servers = ["LMStudio", "Ollama", "OpenAI_Compatible"];
    // Only a provider the backend marks available with true counts; the local model is in neither group.
    const engines = [...apis, ...servers, "CTranslate2"].map(id => ({ id, is_available: true }));
    const fold = async (options: PageOptions) => {
        const p = await translationPage(options);
        return findIn(p.tree(), node => node.type === "advanced-section", "the advanced fold").props;
    };
    const all = await fold({ engines, selected: { 1: "CTranslate2" } });
    assert.equal(all.status, `config_page.advanced_status.translation {"api":8,"llm":3}`);
    assert.equal(all.attention, false, "the local model alone keeps the fold closed");

    const some = await fold({ engines: [{ id: "DeepL_API", is_available: "yes" }, { id: "Groq_API", is_available: true }, { id: "Ollama", is_available: false },
        { id: "LMStudio", is_available: true }, { id: "CTranslate2", is_available: true }] });
    assert.equal(some.status, `config_page.advanced_status.translation {"api":1,"llm":1}`);
    // Nothing known yet: none ready, the fold closed.
    const none = await fold({ engines: null, selected: null });
    assert.equal(none.status, `config_page.advanced_status.translation {"api":0,"llm":0}`);
    assert.equal(none.attention, false);
    for (const id of ["Groq_API", "LMStudio"]) assert.equal((await fold({ selected: { 1: "CTranslate2", 2: id } })).attention, true, id);
});

test("the page's provider lists are the APIs and the local servers it draws", async () => {
    const p = await translationPage();
    assert.deepEqual(p.module.EXTERNAL_API_PROVIDERS, ["DeepL_API", "Google_Cloud_API", "Papago_API", "Plamo_API", "Gemini_API", "OpenAI_API", "Groq_API", "OpenRouter_API"]);
    assert.deepEqual(p.module.LOCAL_LLM_PROVIDERS, ["LMStudio", "Ollama", "OpenAI_Compatible"]);
});

test("a provider counts as ready only when the backend says it is available with true", async () => {
    const p = await translationPage({ engines: [{ id: "DeepL_API", label: "DeepL API", is_available: "yes" }, { id: "Groq_API", is_available: true }] });
    const fold = (id: string) => findIn(p.draw(findIn(p.draw(p.reach("ExternalTranslationAPI_Container")), node => node.props?.id === id)), node => node.type === "setup-section").props;
    assert.deepEqual([fold("DeepL_API").title, fold("DeepL_API").status], ["DeepL API", "config_page.translation.provider_not_set"]);
    assert.deepEqual([fold("Groq_API").title, fold("Groq_API").status], ["Groq_API", "config_page.translation.provider_ready"]);

    // Before the engines and the presets arrive, each provider is named by its id and not set up.
    const early = await translationPage({ engines: null, selected: null });
    const first = findIn(early.draw(findIn(early.draw(early.reach("ExternalTranslationAPI_Container")), node => node.props?.id === "DeepL_API")),
        node => node.type === "setup-section").props;
    assert.deepEqual([first.title, first.status, first.attention], ["DeepL_API", "config_page.translation.provider_not_set", false]);
});

test("the local model's line names the model, whether it is downloaded or cannot be had, and the device it runs on", async () => {
    const gpu = { device: "cuda", device_index: 0, device_name: "RTX 4070" };
    const line = async (options: PageOptions) => {
        const p = await translationPage(options);
        const section = findIn(p.draw(p.reach("AITranslation_Container")), node => node.type === "setup-section");
        const { title, status, attention } = section.props;
        return { title, status, attention, unavailable: ofType(section, "description").map(node => node.props) };
    };
    const offered = OFFERS_M2M;
    const values = (rows: unknown, selected: unknown, device: unknown = gpu) => ({ currentCTranslate2WeightTypeStatus: ok(rows),
        currentSelectedCTranslate2WeightType: ok(selected), currentSelectedTranslationComputeDevice: ok(device) });

    assert.deepEqual(await line({ values: values([builtin(M2M, { is_downloaded: true })], M2M), downloads: offered }),
        { title: "config_page.translation.setup_title", status: "M2M100 418M · int8 · config_page.translation.setup_downloaded · RTX 4070", attention: false, unavailable: [] });
    // Missing and offered: the fold opens on the download.
    assert.deepEqual(await line({ values: values([builtin(M2M)], M2M), downloads: offered }),
        { title: "config_page.translation.setup_title", status: "M2M100 418M · int8 · config_page.translation.setup_not_downloaded · RTX 4070", attention: true, unavailable: [] });
    // The catalog does not offer the selected model, but offers another: still open, the other one is listed.
    assert.deepEqual(await line({ values: values([builtin(M2M), builtin(NLLB)], NLLB), downloads: offered }),
        { title: "config_page.translation.setup_title", status: "NLLB-200 distilled 600M · int8 · config_page.translation.setup_unavailable · RTX 4070", attention: true, unavailable: [] });
    // Nothing can be downloaded and the selected model is missing: the fold stays closed and says so, unfolded.
    assert.deepEqual(await line({ values: values([builtin(NLLB)], NLLB), downloads: { models: [] } }),
        { title: "config_page.translation.setup_title", status: "NLLB-200 distilled 600M · int8 · config_page.translation.setup_unavailable · RTX 4070", attention: false,
            unavailable: [{ text: "config_page.translation.models_unavailable", fold: false }] });
    // A model the user added is never one the catalog cannot offer; it is named by its catalog entry.
    const catalog = { engine: [{ weight: "user:mine", origin: "user", name: "My model" }] };
    assert.equal((await line({ values: values([{ id: "user:mine", is_custom: true, is_downloaded: false }], "user:mine"), downloads: { models: [] }, catalog })).status,
        "My model · config_page.translation.setup_not_downloaded · RTX 4070");
    // A GPU set up during this run says it is used from the next start.
    assert.equal((await line({ values: values([builtin(M2M, { is_downloaded: true })], M2M, { ...gpu, restart_required: true }) })).status,
        `M2M100 418M · int8 · config_page.translation.setup_downloaded · config_page.common.compute_device.after_restart {"device":"RTX 4070"}`);
    // Nothing selected and no device yet: an empty line, closed.
    assert.deepEqual(await line({ values: values([builtin(M2M)], null, "") }), { title: "config_page.translation.setup_title", status: "", attention: false, unavailable: [] });
    // Before the list and the choice arrive: an empty line, closed.
    assert.deepEqual(await line({ values: values(null, undefined, "") }), { title: "config_page.translation.setup_title", status: "", attention: false, unavailable: [] });
    // Before the list arrives the selected model is named, as not downloaded, and the fold waits closed.
    assert.deepEqual(await line({ values: values(null, M2M, { device: "cpu", device_index: 0, device_name: "cpu" }) }),
        { title: "config_page.translation.setup_title", status: "M2M100 418M · int8 · config_page.translation.setup_not_downloaded · CPU", attention: false, unavailable: [] });
});

test("the note about the retired models folder shows only while that folder is used, and leads to the form that adds a model", async () => {
    const note = async (used: unknown) => {
        const p = await translationPage({ catalog: { retired_folder_used: used } });
        return nodesIn(p.draw(p.reach("AITranslation_Container"))).filter(node => componentName(node) === "RetiredModelsFolderNote").length;
    };
    assert.equal(await note(true), 1);
    assert.equal(await note(1), 0, "only a true from the backend");
    assert.equal(await note(false), 0);

    const p = await translationPage();
    const drawn = p.draw(elementOf(p.module.RetiredModelsFolderNote));
    assert.equal(drawn.props["data-retired-models-folder"], true);
    const row = findIn(drawn, node => node.type === "form-row").props;
    assert.deepEqual([row.group, row.label, row.description, row.fold, row.keepDescription], [true, "config_page.translation.retired_models_folder.label",
        "config_page.translation.retired_models_folder.desc", false, true]);
    const button = findIn(drawn, node => node.type === "button").props;
    assert.equal(button.type, "button");
    assert.equal(button.children, "config_page.translation.retired_models_folder.open_add_form");
    button.onClick();
    assert.deepEqual(p.revealed, [{ setting_id: "translation_catalog_add_engine" }]);
});

test("the model list names each model and shows its license, and a model the user added says its license is theirs", async () => {
    const catalog = { engine: [{ weight: "user:mine", origin: "user", name: "My model" }] };
    const p = await translationPage({ catalog, downloads: OFFERS_M2M,
        values: { currentCTranslate2WeightTypeStatus: ok([builtin(M2M), builtin(NLLB, { is_downloaded: true }), builtin(M2M_BIG), { id: "user:mine", is_custom: true, is_downloaded: true }]),
            currentSelectedCTranslate2WeightType: ok(M2M) } });
    const drawn = p.draw(p.reach("CTranslate2WeightType_Box"));
    assert.deepEqual([drawn.type, drawn.props.role, drawn.props.tabIndex, drawn.props["aria-label"]], ["div", "group", -1, "config_page.translation.ctranslate2_weight_type.label"]);
    const list = findIn(drawn, node => node.type === "download-models").props;
    assert.deepEqual([list.label, list.desc, list.name], ["config_page.translation.ctranslate2_weight_type.label", "config_page.translation.ctranslate2_weight_type.desc", "ctranslate2_weight_type"]);
    assert.equal(list.checked_variable, p.values.currentSelectedCTranslate2WeightType);
    // M2M100 1.2B is not offered and not on the PC: it is not listed.
    assert.deepEqual(list.options.map((option: Record<string, unknown>) => [option.id, option.label, option.desc, option.desc_tone, option.keep_desc]), [
        [M2M, "M2M100 418M · int8", `config_page.translation.ctranslate2_weight_type.license_commercial {"license":"MIT"}`, undefined, true],
        [NLLB, "NLLB-200 distilled 600M · int8", `config_page.translation.ctranslate2_weight_type.license_non_commercial {"license":"CC-BY-NC-4.0"}`, "warning", true],
        ["user:mine", "My model", "config_page.translation.ctranslate2_weight_type.custom_model", undefined, true],
    ]);
    assert.ok(!("desc_tone" in list.options[2]), "a model of one's own has no warning tone");
    assert.equal(list.options[1].is_downloaded, true, "the row keeps what the backend said");
});

test("choosing a non-commercial model asks first, once a session; a commercial one or the one in use is chosen at once", async () => {
    const p = await translationPage({ values: { currentCTranslate2WeightTypeStatus: ok([builtin(M2M, { is_downloaded: true }), builtin(NLLB, { is_downloaded: true }),
        builtin("nllb-200-distilled-1.3B-ct2-int8", { is_downloaded: true })]), currentSelectedCTranslate2WeightType: ok("nllb-200-distilled-1.3B-ct2-int8") } });
    const element = p.reach("CTranslate2WeightType_Box"), runtime = hooks();
    const box = () => p.draw(element, runtime);
    const list = () => findIn(box(), node => node.type === "download-models").props;
    const dialog = () => nodesIn(box()).find(node => componentName(node) === "CTranslate2LicenseDialog");
    const chosen = () => p.calls.filter(call => call[0] === "setSelectedCTranslate2WeightType").map(call => call[1]);

    list().selectFunction(M2M);
    assert.deepEqual(chosen(), [M2M]);
    // The model in use never asks again.
    list().selectFunction("nllb-200-distilled-1.3B-ct2-int8");
    assert.deepEqual(chosen(), [M2M, "nllb-200-distilled-1.3B-ct2-int8"]);
    assert.equal(dialog(), undefined);
    // A model the list does not hold is sent as it is.
    list().selectFunction("unknown");
    assert.deepEqual(chosen().at(-1), "unknown");

    list().selectFunction(NLLB);
    assert.equal(chosen().length, 3, "nothing is chosen while the license waits");
    const asking = dialog();
    assert.ok(asking);
    assert.deepEqual([asking.props.weight.id, asking.props.action], [NLLB, "select"]);
    // The dialog gives focus back to the list when it closes.
    assert.equal(asking.props.fallback, box().props.ref);
    asking.props.onCancel();
    assert.equal(dialog(), undefined);
    assert.equal(chosen().length, 3, "cancelled: nothing chosen");

    list().selectFunction(NLLB);
    const again = dialog();
    assert.ok(again);
    again.props.onConfirm();
    assert.equal(dialog(), undefined);
    assert.deepEqual(chosen().at(-1), { weight_type: NLLB, accept_non_commercial_license: true });
    // Confirmed for this session: chosen again at once, with the opt-in.
    list().selectFunction(NLLB);
    assert.equal(dialog(), undefined);
    assert.deepEqual(chosen().at(-1), { weight_type: NLLB, accept_non_commercial_license: true });
});

test("a download is reviewed first in its own dialog, with the device the model would run on; the list sends nothing itself", async () => {
    const device = { device: "cuda", device_index: 1, device_name: "GPU" };
    const p = await translationPage({ values: { currentCTranslate2WeightTypeStatus: ok([builtin(M2M), builtin(NLLB)]), currentSelectedCTranslate2WeightType: ok(M2M),
        currentSelectedTranslationComputeDevice: ok(device) } });
    const element = p.reach("CTranslate2WeightType_Box"), runtime = hooks();
    const box = () => p.draw(element, runtime);
    const list = () => findIn(box(), node => node.type === "download-models").props;
    const review = () => nodesIn(box()).find(node => node.type === "download-dialog");
    assert.equal(review(), undefined);

    list().downloadStartFunction(NLLB);
    const dialog = review();
    assert.ok(dialog);
    assert.deepEqual([dialog.props.weightType, dialog.props.computeDevice], [NLLB, device]);
    assert.deepEqual(p.calls, [], "the review starts nothing");
    dialog.props.onCancel();
    assert.equal(review(), undefined);
    // Another model's review replaces it.
    list().downloadStartFunction(M2M);
    assert.equal(review()?.props.weightType, M2M);
    // Its license is still asked when the model is chosen.
    list().selectFunction(NLLB);
    assert.equal(nodesIn(box()).find(node => componentName(node) === "CTranslate2LicenseDialog")?.props.weight.id, NLLB);
    assert.deepEqual(p.calls, []);
});

test("the license dialog confirms only once its box is ticked, and names the model, its license and its pages", async () => {
    const p = await translationPage();
    const events: string[] = [];
    const weight = { id: NLLB, license: "CC-BY-NC-4.0", license_url: "https://license.example", model_card_url: "https://card.example" };
    const runtime = hooks();
    const props = { weight, action: "select" as const, fallback: null, onCancel: () => { events.push("cancel"); }, onConfirm: () => { events.push("confirm"); } };
    const dialog = (action: "select" | "download" = "select") => p.draw(elementOf(p.module.CTranslate2LicenseDialog, { ...props, action }), runtime);
    const drawn = dialog();
    assert.deepEqual(p.consent.asked.at(-1), { open: true, fallback: null });
    assert.deepEqual([drawn.type, drawn.props.ref, drawn.props["aria-label"]], ["dialog", "dialog", "config_page.translation.ctranslate2_weight_type.confirm_title"]);
    assert.equal(textOf(findIn(drawn, node => node.type === "h3")), "config_page.translation.ctranslate2_weight_type.confirm_title");
    assert.equal(textOf(findIn(drawn, node => node.type === "p")),
        `config_page.translation.ctranslate2_weight_type.confirm_body {"weight_type":"NLLB-200 distilled 600M · int8","license":"CC-BY-NC-4.0"}`);
    // The two links in one line, apart.
    assert.equal(textOf(ofType(drawn, "p")[1]), "config_page.translation.ctranslate2_weight_type.license_link (CC-BY-NC-4.0) · config_page.translation.ctranslate2_weight_type.model_card_link");
    const [license, card] = ofType(drawn, "a");
    assert.deepEqual([license.props.href, license.props.target, license.props.rel, textOf(license)],
        ["https://license.example", "_blank", "noreferrer", "config_page.translation.ctranslate2_weight_type.license_link (CC-BY-NC-4.0)"]);
    assert.deepEqual([card.props.href, card.props.target, card.props.rel, textOf(card)],
        ["https://card.example", "_blank", "noreferrer", "config_page.translation.ctranslate2_weight_type.model_card_link"]);
    assert.equal(textOf(findIn(drawn, node => node.type === "label")), "config_page.translation.ctranslate2_weight_type.confirm_check");

    const buttons = () => ofType(dialog(), "button").map(node => node.props);
    const [cancel, confirm] = buttons();
    assert.deepEqual([cancel.type, cancel.autoFocus, cancel.children], ["button", true, "config_page.translation.ctranslate2_weight_type.confirm_cancel"]);
    assert.deepEqual([confirm.type, confirm.disabled, confirm.children], ["button", true, "config_page.translation.ctranslate2_weight_type.confirm_select"]);
    // Pressed before the box is ticked (the button is disabled), nothing happens.
    confirm.onClick();
    assert.deepEqual(events, []);
    assert.equal(p.consent.closed, 0);
    const box = findIn(dialog(), node => node.type === "input");
    assert.deepEqual([box.props.type, box.props.checked], ["checkbox", false]);
    box.props.onChange({ target: { checked: true } });
    assert.equal(findIn(dialog(), node => node.type === "input").props.checked, true);
    const ticked = buttons()[1];
    assert.equal(ticked.disabled, false);
    ticked.onClick();
    assert.deepEqual(events, ["confirm"]);
    assert.equal(p.consent.closed, 1, "closed before the choice is made");

    // The cancel button and Escape both close it and cancel.
    buttons()[0].onClick();
    let prevented = 0;
    dialog().props.onCancel({ preventDefault: () => { prevented++; } });
    assert.deepEqual(events, ["confirm", "cancel", "cancel"]);
    assert.equal(prevented, 1);
    assert.equal(p.consent.closed, 3);

    // The download review asks with the download's words.
    assert.equal(ofType(dialog("download"), "button")[1].props.children, "config_page.translation.ctranslate2_weight_type.confirm_download");
});

test("the license dialog's links open in the system browser in the app, and fall back to the page's own link elsewhere", async () => {
    const weight = { id: NLLB, license: "CC-BY-NC-4.0", license_url: "https://license.example", model_card_url: "https://card.example" };
    const linksOf = async (options: PageOptions, given: { id: string; license?: string; license_url?: string; model_card_url?: string } = weight) => {
        const p = await translationPage(options);
        const drawn = p.draw(elementOf(p.module.CTranslate2LicenseDialog, { weight: given, action: "select", onCancel() {}, onConfirm() {} }));
        assert.equal(p.consent.asked.at(-1)?.fallback, undefined, "no fallback given");
        let prevented = 0;
        const event = { preventDefault: () => { prevented++; } };
        for (const link of ofType(drawn, "a")) await link.props.onClick(event);
        return { opened: p.opened, prevented };
    };
    assert.deepEqual(await linksOf({}), { opened: ["https://license.example", "https://card.example"], prevented: 2 });
    assert.deepEqual(await linksOf({ tauri: false }), { opened: [], prevented: 0 });
    // A model without pages: links without a target do nothing.
    assert.deepEqual(await linksOf({}, { id: NLLB, license: "x" }), { opened: [], prevented: 0 });

    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("no browser");
    assert.deepEqual(await linksOf({ openUrl: async () => { throw failure; } }), { opened: [], prevented: 2 });
    assert.deepEqual(errors.mock.calls, [["Failed to open", "https://license.example", failure], ["Failed to open", "https://card.example", failure]]);
});

test("the compute device row is the translation's, and says when the chosen GPU is used only after a restart", async () => {
    const devices = { 0: { device: "cpu", device_index: 0, device_name: "cpu" } };
    const p = await translationPage({ values: { currentSelectableTranslationComputeDeviceList: ok(devices),
        currentSelectedTranslationComputeDevice: ok({ device: "cuda", device_index: 0, device_name: "GPU", restart_required: true }), currentSelectedTranslationComputeType: ok("int8") } });
    const drawn = p.draw(p.reach("TranslationComputeDevice_Box"));
    const row = findIn(drawn, node => node.type === "compute-device").props;
    assert.deepEqual([row.label, row.dropdownIdPrefix], ["config_page.translation.translation_compute_device.label", "translation"]);
    assert.equal(row.currentDeviceList, p.values.currentSelectableTranslationComputeDeviceList);
    assert.equal(row.currentSelectedDevice, p.values.currentSelectedTranslationComputeDevice);
    assert.equal(row.currentSelectedComputeType, p.values.currentSelectedTranslationComputeType);
    row.setSelectedDevice("device");
    row.setSelectedComputeType("float16");
    assert.deepEqual(p.calls, [["setSelectedTranslationComputeDevice", "device"], ["setSelectedTranslationComputeType", "float16"]]);
    const note = findIn(drawn, node => node.type === "p").props;
    assert.deepEqual([note.role, note.children], ["status", "config_page.translation.translation_compute_device.restart_note"]);

    p.values.currentSelectedTranslationComputeDevice = ok({ device: "cuda", device_index: 0, device_name: "GPU" });
    assert.equal(ofType(p.draw(p.reach("TranslationComputeDevice_Box")), "p").length, 0);
});

// The rows with a provider's key: [component, settings base, locale key, page with the key, what else it has].
const KEY_ROWS: [string, string, string, string, Record<string, unknown>][] = [
    ["DeepLAuthKey_Box", "DeepL", "deepl", uiConfigs.deepl_auth_key_url, { desc: `config_page.translation.deepl_auth_key.desc {"translator":"main_page.translator"}` }],
    ["GoogleCloudAuthKey_Box", "GoogleCloud", "google_cloud", uiConfigs.google_cloud_auth_key_url, { desc: "config_page.translation.google_cloud_auth_key.desc", keep_desc: true }],
    ["PapagoAuthKey_Box", "Papago", "papago", uiConfigs.papago_auth_key_url, {}],
    ["PlamoAuthKey_Box", "Plamo", "plamo", uiConfigs.plamo_auth_key_url, { remove_border_bottom: true }],
    ["GeminiAuthKey_Box", "Gemini", "gemini", uiConfigs.gemini_auth_key_url, { remove_border_bottom: true }],
    ["OpenAIAuthKey_Box", "OpenAI", "openai", uiConfigs.openai_auth_key_url, { remove_border_bottom: true }],
    ["GroqAuthKey_Box", "Groq", "groq", uiConfigs.groq_auth_key_url, { remove_border_bottom: true }],
    ["OpenRouterAuthKey_Box", "OpenRouter", "openrouter", uiConfigs.openrouter_auth_key_url, { remove_border_bottom: true }],
];

test("each provider's key row names the provider, links to its key page, and saves or deletes that provider's key", async () => {
    const values = Object.fromEntries(KEY_ROWS.map(([, base, key]) => [`current${base}AuthKey`, { state: `state-${key}`, data: `key-${key}` }]));
    const p = await translationPage({ values });
    for (const [name, base, key, url, extra] of KEY_ROWS) {
        const row = p.row(name, "auth-key").props;
        const label = `config_page.translation.${key}_auth_key.label`;
        assert.deepEqual({ label: row.label, desc: row.desc, keep_desc: row.keep_desc, webpage_url: row.webpage_url, variable: row.variable, state: row.state,
            remove_border_bottom: row.remove_border_bottom, onChangeFunction: row.onChangeFunction, saveFunction: row.saveFunction },
        { label, desc: undefined, keep_desc: undefined, webpage_url: url, variable: `key-${key}`, state: `state-${key}`, remove_border_bottom: undefined,
            onChangeFunction: "change", saveFunction: "save", ...extra }, name);
        const save = p.saves.at(-1);
        assert.ok(save);
        assert.deepEqual([save.label, save.variable, save.state], [label, `key-${key}`, `state-${key}`], name);
        save.setFunction("new");
        save.deleteFunction?.();
        assert.deepEqual(p.calls.splice(0), [[`set${base}AuthKey`, "new"], [`delete${base}AuthKey`]], name);
    }
});

test("a key the backend answered with as a number is shown as its text; no key stays empty", async () => {
    const p = await translationPage({ values: { currentDeepLAuthKey: ok(12345), currentGroqAuthKey: ok(undefined), currentGeminiAuthKey: ok(true) } });
    assert.equal(p.row("DeepLAuthKey_Box", "auth-key").props.variable, "12345");
    assert.equal(p.row("GeminiAuthKey_Box", "auth-key").props.variable, "true");
    assert.equal(p.row("GroqAuthKey_Box", "auth-key").props.variable, undefined);
    assert.equal(p.row("PlamoAuthKey_Box", "auth-key").props.variable, null);
});

test("Papago's client ID is saved on its own row, before the secret, and has nothing to delete", async () => {
    const p = await translationPage({ values: { currentPapagoClientID: { state: "pending", data: "client" } } });
    const row = p.row("PapagoClientID_Box", "entry").props;
    assert.deepEqual([row.label, row.desc, row.variable, row.state, row.remove_border_bottom],
        ["config_page.translation.papago_client_id.label", "config_page.translation.papago_client_id.desc", "client", "pending", true]);
    const save = p.saves.at(-1);
    assert.ok(save);
    assert.deepEqual([save.label, save.variable, save.state, save.deleteFunction], ["config_page.translation.papago_client_id.label", "client", "pending", undefined]);
    save.setFunction("id");
    assert.deepEqual(p.calls, [["setPapagoClientID", "id"]]);
});

// The model lists: [component, settings base, list id, what opens the list, the words while it is closed].
const KEY_NEEDED = "config_page.common.correct_auth_key_required";
const MODEL_ROWS: [string, string, string, string, string][] = [
    ["PlamoModelContainer", "Plamo", "select_plamo_model", "currentPlamoAuthKey", KEY_NEEDED],
    ["GeminiModelContainer", "Gemini", "select_gemini_model", "currentGeminiAuthKey", KEY_NEEDED],
    ["OpenAIModelContainer", "OpenAI", "select_openai_model", "currentOpenAIAuthKey", KEY_NEEDED],
    ["GroqModelContainer", "Groq", "select_groq_model", "currentGroqAuthKey", KEY_NEEDED],
    ["OpenRouterModelContainer", "OpenRouter", "select_openrouter_model", "currentOpenRouterAuthKey", KEY_NEEDED],
    ["OpenAICompatibleModelContainer", "OpenAICompatible", "select_openai_compatible_model", "currentOpenAICompatibleAuthKey", KEY_NEEDED],
    ["LMStudioModelContainer", "LMStudio", "select_lmstudio_model", "currentIsLMStudioConnected", "config_page.translation.select_lmstudio_model.connection_required"],
    ["OllamaModelContainer", "Ollama", "select_ollama_model", "currentIsOllamaConnected", "config_page.translation.select_ollama_model.connection_required"],
];

test("each model list opens once the provider's key is saved or its server answers, and sends the model chosen", async () => {
    const p = await translationPage();
    for (const [name, base, id, gate, closedWords] of MODEL_ROWS) {
        const gates = gate.startsWith("currentIs") ? p.llmValues : p.values;
        const list = [{ id: "a", label: "A" }];
        p.values[`currentSelectable${base}ModelList`] = ok(list);
        const view = (gated: unknown, model: unknown) => {
            gates[gate] = ok(gated);
            p.values[`currentSelected${base}Model`] = { state: `state-${base}`, data: model };
            const row = p.row(name, "dropdown").props;
            return [row.dropdown_id, row.label, row.selected_id, row.is_disabled, row.state, row.list];
        };
        const label = `config_page.translation.${id}.label`;
        assert.deepEqual(view(null, null), [id, label, closedWords, true, `state-${base}`, list], name);
        assert.deepEqual(view(gate.startsWith("currentIs") ? true : "key", null), [id, label, null, false, `state-${base}`, list], name);
        // A model saved before the key went away stays named, and the list stays closed.
        assert.deepEqual(view(gate.startsWith("currentIs") ? false : "", "kept"), [id, label, "kept", true, `state-${base}`, list], name);
        p.row(name, "dropdown").props.selectFunction({ selected_id: "chosen" });
        assert.deepEqual(p.calls.splice(0), [[`setSelected${base}Model`, "chosen"]], name);
    }
});

test("the local servers' addresses warn about plain HTTP on the LAN, and an empty address is an empty field", async () => {
    const rows: [string, string, string, string][] = [
        ["LMStudioURL_Box", "LMStudio", "LM Studio URL", "network_privacy.save_notice"],
        ["OllamaURL_Box", "Ollama", "config_page.translation.ollama_url.label", "config_page.translation.ollama_url.desc network_privacy.save_notice"],
    ];
    const p = await translationPage();
    for (const [name, base, label, desc] of rows) {
        const view = (url: unknown) => {
            p.values[`current${base}URL`] = { state: `state-${base}`, data: url };
            const row = p.row(name, "entry").props;
            return { label: row.label, desc: row.desc, warnings: row.add_warnings, variable: row.variable, state: row.state, last: row.remove_border_bottom };
        };
        assert.deepEqual(view("http://192.168.1.20:1234"), { label, desc, warnings: [{ label: "network_privacy.http_warning" }], variable: "http://192.168.1.20:1234",
            state: `state-${base}`, last: true }, name);
        assert.deepEqual(view("https://llm.example"), { label, desc, warnings: undefined, variable: "https://llm.example", state: `state-${base}`, last: true }, name);
        assert.deepEqual(view(null), { label, desc, warnings: undefined, variable: "", state: `state-${base}`, last: true }, name);
        const save = p.saves.at(-1);
        assert.ok(save);
        assert.deepEqual([save.label, save.variable, save.state, save.deleteFunction], [label, null, `state-${base}`, undefined], name);
        save.setFunction("http://localhost:1");
        assert.deepEqual(p.calls.splice(0), [[`set${base}URL`, "http://localhost:1"]], name);
    }
});

test("each local server's connection check shows whether it answered and asks it again", async () => {
    const p = await translationPage({ llm: { currentIsLMStudioConnected: { state: "ok", data: true }, currentIsOllamaConnected: { state: "pending", data: false } } });
    for (const [name, base, data, state] of [["LMStudioConnectionCheck_Box", "LMStudio", true, "ok"], ["OllamaConnectionCheck_Box", "Ollama", false, "pending"]] as const) {
        const row = p.row(name, "connection-check").props;
        assert.deepEqual([row.label, row.variable, row.state, row.remove_border_bottom], [`config_page.translation.${base.toLowerCase()}_connection_check.label`, data, state, true], name);
        row.checkFunction();
        assert.deepEqual(p.calls.splice(0), [[`checkConnection_${base}`]], name);
    }
});

test("the OpenAI-compatible server keeps its address and key together, with the words about its charges in sight", async () => {
    const p = await translationPage();
    const pair = p.row("OpenAICompatibleCredentials", "credential-pair").props;
    assert.equal(pair.settings, p.settings);
    assert.deepEqual([pair.base, pair.provider, pair.section, pair.keepUrlDescription], ["OpenAICompatible", "openai_compatible", "translation", true]);
});

test("what an AI engine is asked besides the text: a temperature from 0 to 2 and free instructions, both empty by default", async () => {
    const p = await translationPage({ values: { currentLLMTranslationTemperature: { state: "ok", data: 0.7 }, currentLLMTranslationInstructions: { state: "pending", data: null } } });
    const temperature = p.row("LLMTranslationTemperature_Box", "entry").props;
    assert.deepEqual({ label: temperature.label, desc: temperature.desc, type: temperature.type, min: temperature.min, max: temperature.max, step: temperature.step,
        width: temperature.width, variable: temperature.variable, state: temperature.state, last: temperature.remove_border_bottom }, {
        label: "config_page.translation.llm_translation_temperature.label", desc: "config_page.translation.llm_translation_temperature.desc", type: "number",
        min: 0, max: 2, step: 0.1, width: "8rem", variable: "0.7", state: "ok", last: undefined });
    let save = p.saves.at(-1);
    assert.ok(save);
    assert.deepEqual([save.label, save.variable, save.state, save.deleteFunction], ["config_page.translation.llm_translation_temperature.label", 0.7, "ok", undefined]);
    save.setFunction(1);
    const instructions = p.row("LLMTranslationInstructions_Box", "entry").props;
    assert.deepEqual([instructions.label, instructions.desc, instructions.variable, instructions.state, instructions.remove_border_bottom, instructions.type],
        ["config_page.translation.llm_translation_instructions.label", "config_page.translation.llm_translation_instructions.desc", "", "pending", true, undefined]);
    save = p.saves.at(-1);
    assert.ok(save);
    assert.deepEqual([save.label, save.variable, save.state], ["config_page.translation.llm_translation_instructions.label", null, "pending"]);
    save.setFunction("Be polite.");
    assert.deepEqual(p.calls, [["setLLMTranslationTemperature", 1], ["setLLMTranslationInstructions", "Be polite."]]);

    p.values.currentLLMTranslationTemperature = ok(null);
    assert.equal(p.row("LLMTranslationTemperature_Box", "entry").props.variable, "", "an empty temperature is an empty field");
});

test("the page's sections are headed in order, and the local servers point to how to use a model of one's own", async () => {
    const p = await translationPage();
    const labels = (name: string) => ofType(p.draw(p.reach(name)), "section-label").map(node => [node.props.label, node.props.sub]);
    assert.deepEqual(labels("AITranslation_Container"), [["config_page.translation.section_label_ai_translation", undefined]]);
    assert.deepEqual(labels("ExternalTranslationAPI_Container"), [["config_page.translation.section_label_external_api", true]]);
    assert.deepEqual(labels("LocalLLM_Container"), [["config_page.translation.section_label_local_llm", true]]);
    assert.deepEqual(labels("LLMTranslationOptions_Container"), [["config_page.translation.section_label_llm_options", true]]);
    assert.deepEqual(ofType(p.draw(p.reach("LocalLLM_Container")), "custom-model-link").map(node => node.props.section), ["translation"]);
});
