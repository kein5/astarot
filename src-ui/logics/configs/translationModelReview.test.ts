import assert from "node:assert/strict";
import { test } from "vitest";
import i18next from "i18next";
import { hooks, kitStandIns, loadModule, stubGlobals, find, findIn, componentName, nodesIn, setRef } from "../test/hookHarness.ts";
import type { TestContext } from "vitest";
import { loadBridgeRoutes, settingAtom } from "../test/bridgeHarness.ts";
import { readLocale } from "../test/locales.ts";
import * as setupNeeds from "../main/setupNeeds.ts";

// The review of a translation model (LegacyModelDownloadDialog): the translation models of the
// shared download catalog. Its built-in CTranslate2 half went with #1015.

// A row of a weight list, as the bridge keeps it in the setting's atom.
interface WeightRow {
    id: string;
    job_id?: string;
    is_pending: boolean;
    is_downloaded: boolean;
    progress: number | null;
}
// The registry keeps each setting's atom, which the setting's hook writes.
const weightsAtom = (subject: Awaited<ReturnType<typeof loadBridgeRoutes>>, name: string) =>
    settingAtom<WeightRow[]>(subject.stores.dynamicStoreRegistry, name);

const componentURL = new URL("../../views/app/config_page/setting_section/setting_box/_components/download_models/LegacyModelDownloadDialog.tsx", import.meta.url);
// The model the review is opened for.
const weightType = "nllb-200-distilled-600M-ct2-int8";

async function dialogFixture(context: TestContext, language: string, catalog: unknown,
    extra: { note?: string | null; onCatalogStart?: (id: string) => void; extraAction?: { label: string; onClick: () => void } } = {}) {
    const translations = i18next.createInstance();
    const resource = readLocale(language);
    await translations.init({ lng: language, resources: { [language]: { translation: resource } } });
    const events = { focused: 0, opened: 0, closed: 0 };
    stubGlobals(context, { document: { activeElement: { isConnected: true, getAttribute: () => null,
        closest: () => null, focus: () => events.focused++ } } });
    const runtime = hooks(), reads: unknown[][] = [];
    const dialogHooks = await loadModule<typeof import("../common/useConsentDialog.ts")>(new URL("../common/useConsentDialog.ts", import.meta.url), runtime);
    const downloads: { catalog: unknown; error?: string | null; send: (...args: unknown[]) => void } = { catalog, send: (...args: unknown[]) => reads.push(args) };
    const { LegacyModelDownloadDialog } = await loadModule<typeof import("../../views/app/config_page/setting_section/setting_box/_components/download_models/LegacyModelDownloadDialog.tsx")>(componentURL, runtime, {
        "@useI18n": { useI18n: () => ({ t: translations.t.bind(translations) }) },
        "../../../../../../../logics/voice/useModelDownloads": { useModelDownloads: () => downloads },
        "@logics_configs": { useTranslation: () => ({ currentCTranslate2WeightTypeStatus: { state: "ok", data: [] } }) },
        "../../../../../../../logics/main/setupNeeds": setupNeeds,
        "../../../../../../../logics/common/useConsentDialog": dialogHooks,
        "../../advanced_settings/ModelDownloads": { ModelDownloads: function ModelDownloads() { return null; } },
        "../custom_model_link/CustomModelLink": { CustomModelLink: function CustomModelLink() { return null; } },
    });
    const props = { weightType, onCancel: () => events.closed++, ...extra };
    const modal = { open: false, showModal() { this.open = true; events.opened++; }, close() { this.open = false; } };
    const render = () => runtime.render(LegacyModelDownloadDialog, props, tree => {
        // The fake modal goes where React would put the dialog: into the kit's Dialog's ref (D-23).
        setRef(findIn(tree, node => node.type === kitStandIns.Dialog), modal);
    });
    context.onTestFinished(() => runtime.unmount());
    render();
    return { runtime, reads, downloads, events, render, t: translations.t.bind(translations) };
}

const published = (...ids: string[]) => ({ models: ids.map(id => ({ id, target: "translation", name: id, artifacts: [] })) });

for (const language of ["en", "ja"]) {
    test(`${language}: the review reads the catalog, waits for it, and says when it cannot be read`, async context => {
        const s = await dialogFixture(context, language, null);
        const tree = s.render();
        assert.equal(s.reads[0][0], "/get/data/model_download_catalog");
        assert.equal(s.events.opened, 1);
        assert.notEqual(find(tree, node => node.props?.role === "status" && node.props.children === s.t("model_downloads.loading")), null);
        assert.equal(findIn(tree, node => node.type === kitStandIns.Button && node.props.autoFocus).props.children, s.t("model_downloads.back"));
        // Shown while drawn, named by its title alone, as before (D-43), with its one button in the footer.
        // In the forms' section (the catalog's words) and the shared host, which takes no room of its own.
        assert.deepEqual(String(tree.props.className).split(" ").sort(), ["container", "host"]);
        const dialog = findIn(tree, node => node.type === kitStandIns.Dialog);
        assert.deepEqual([dialog.props.open, "aria-describedby" in dialog.props, dialog.props["aria-describedby"]], [true, true, undefined]);
        assert.equal(findIn(dialog, node => node.type === kitStandIns.DialogTitle).props.children, s.t("model_downloads.warning_title"));
        assert.deepEqual(nodesIn(findIn(dialog, node => node.type === kitStandIns.DialogFooter)).filter(node => node.type === kitStandIns.Button)
            .map(node => [node.props.children, node.props.tone]), [[s.t("model_downloads.back"), undefined]]);
        s.downloads.error = "backend_unavailable";
        assert.notEqual(find(s.render(), node => node.props?.role === "status"
            && node.props.children === s.t("legacy_model_downloads.review_unavailable")), null);
    });
    test(`${language}: Escape closes the review and gives the focus back`, async context => {
        const s = await dialogFixture(context, language, published("nllb-200-distilled-600m-onnx-int8"));
        // Escape: the kit's Dialog asks its owner to close it (Dialog.test.ts).
        findIn(s.render(), node => node.type === kitStandIns.Dialog).props.onOpenChange(false);
        s.runtime.unmount();
        await Promise.resolve();
        assert.equal(s.events.closed, 1);
        assert.equal(s.events.focused, 1);
    });
    test(`${language}: without a published translation model the review says so and that one's own is added in the catalog`, async context => {
        const s = await dialogFixture(context, language, { models: [] });
        const tree = s.render();
        const paragraph = (key: string) => find(tree, node => node.type === "p" && node.props.children === s.t(key));
        assert.notEqual(paragraph("legacy_model_downloads.translation_not_published"), null);
        assert.notEqual(paragraph("legacy_model_downloads.translation_own_model"), null);
        // No folder to place a model in is named any more (#597): no path at all.
        assert.equal(find(tree, node => node.type === "code"), null);
        assert.match(s.t("legacy_model_downloads.translation_own_model"), language === "ja" ? /自分のモデルを追加/ : /Add a model of your own/);
        assert.equal(paragraph("model_downloads.loading"), null);
        assert.equal(find(tree, node => node.type === kitStandIns.Button && node.props.children === s.t("model_downloads.start")), null);
        const close = findIn(tree, node => node.type === kitStandIns.Button && node.props.autoFocus);
        assert.equal(close.props.children, s.t("legacy_model_downloads.close"));
        close.props.onClick();
        assert.equal(s.events.closed, 1);
    });
    test(`${language}: a published translation model is reviewed in the shared download card`, async context => {
        const s = await dialogFixture(context, language, published("m2m100-418m-onnx-int8"));
        const tree = s.render();
        const card = findIn(tree, node => componentName(node) === "ModelDownloads");
        assert.deepEqual(card.props.targets, ["translation"]);
        assert.deepEqual(card.props.expected, { translation: {} });
        // Opened for NLLB, which the catalog does not offer: every translation model is shown.
        assert.equal(card.props.only, undefined);
        assert.equal(find(tree, node => node.type === "p" && node.props.children === s.t("legacy_model_downloads.translation_not_published")), null);
        // Someone getting a built-in model is not told about their own (#1266): no note, no link.
        assert.equal(find(tree, node => node.type === "p" && node.props.children === s.t("legacy_model_downloads.translation_own_model")), null);
        assert.equal(find(tree, node => componentName(node) === "CustomModelLink"), null);
    });
    test(`${language}: the switch's review says what follows and hears a card's download start (#1015)`, async context => {
        const model = "nllb-200-distilled-600m-onnx-int8";
        const started: string[] = [];
        const s = await dialogFixture(context, language, published(model), { note: "the switch goes on", onCatalogStart: id => started.push(id) });
        const tree = s.render();
        assert.notEqual(find(tree, node => node.type === "p" && node.props.children === "the switch goes on"), null);
        findIn(tree, node => componentName(node) === "ModelDownloads").props.onStart(model);
        assert.deepEqual(started, [model]);
        // Without a model to fetch, nothing follows: the note stays away.
        const none = await dialogFixture(context, language, { models: [] }, { note: "the switch goes on" });
        assert.equal(find(none.render(), node => node.type === "p" && node.props.children === "the switch goes on"), null);
    });
    // Decided on 2026-11-25: the kit's quiet Button, on its own line under the footer.
    test(`${language}: another way forward is a quiet button under the footer that closes the review first`, async context => {
        const order: string[] = [];
        const s = await dialogFixture(context, language, published("m2m100-418m-onnx-int8"),
            { extraAction: { label: "use without it", onClick: () => order.push(`go on, closed ${s.events.closed}`) } });
        const dialog = findIn(s.render(), node => node.type === kitStandIns.Dialog);
        const button = findIn(dialog, node => node.type === kitStandIns.Button && node.props.children === "use without it");
        assert.deepEqual([button.props.tone, button.props.className], ["quiet", "ownLine"]);
        // A part of the dialog of its own, after the footer.
        const parts = [dialog.props.children].flat(3).filter(Boolean);
        assert.equal(parts.at(-1)?.props.children, "use without it");
        assert.equal(parts.at(-2)?.type, kitStandIns.DialogFooter);
        button.props.onClick();
        assert.deepEqual(order, ["go on, closed 1"]);
        // Without one, no such button.
        const plain = await dialogFixture(context, language, published("m2m100-418m-onnx-int8"));
        assert.equal(find(plain.render(), node => node.props?.className === "ownLine"), null);
    });
    test(`${language}: the review opened from a model's row shows that model's variants`, async context => {
        const s = await dialogFixture(context, language, published("m2m100-418m-onnx-int8", "m2m100-418m-onnx-float16", "nllb-200-distilled-600m-onnx-int8"));
        const card = findIn(s.render(), node => componentName(node) === "ModelDownloads");
        assert.deepEqual(card.props.only, ["nllb-200-distilled-600m-onnx-int8"]);
    });
    // #1266 T-3: the press that opened the review asked for that model's review, so it opens at once
    // over this one, which steps back; Back there closes this one too, a started download stays.
    test(`${language}: the model asked about is reviewed at once, and Back there closes the review`, async context => {
        const s = await dialogFixture(context, language, published("nllb-200-distilled-600m-onnx-int8"));
        const tree = s.render();
        const card = findIn(tree, node => componentName(node) === "ModelDownloads");
        assert.equal(card.props.reviewAtOnce, true);
        assert.equal(findIn(tree, node => node.type === kitStandIns.Dialog).props.stepsBack, true);
        card.props.onReviewDone(true);
        assert.equal(s.events.closed, 0, "a started download stays in sight with its progress");
        card.props.onReviewDone(false);
        assert.equal(s.events.closed, 1);
        // Opened for a model the catalog does not offer, every model is listed: no review at once.
        const every = await dialogFixture(context, language, published("m2m100-418m-onnx-int8"));
        assert.equal(findIn(every.render(), node => componentName(node) === "ModelDownloads").props.reviewAtOnce, false);
    });
}

// A translation model of the catalog that the core applied arrives as its weight
// (/run/downloaded_ctranslate2_weight, translation_model_downloaded in the core).
test("a weight the core has verified is marked downloaded, and late progress is ignored", async () => {
    const subject = await loadBridgeRoutes();
    const atom = weightsAtom(subject, "Atom_CTranslate2WeightTypeStatus");
    subject.runtime.store.set(atom, { state: "ok", data: [
        { id: "requested", is_pending: true, is_downloaded: false, progress: 12 },
        { id: "other", is_pending: true, is_downloaded: false, progress: 50 },
    ] });
    const endpoint = "/run/downloaded_ctranslate2_weight";
    subject.receiveRoutes({ status: 200, endpoint, result: { weight_type: "requested", job_id: "job", downloaded: false } });
    assert.equal(subject.runtime.store.get(atom).data[0].is_downloaded, false);
    subject.receiveRoutes({ status: 200, endpoint, result: { weight_type: "requested", job_id: "job", downloaded: true } });
    subject.receiveRoutes({ status: 200, endpoint: "/run/download_progress_ctranslate2_weight",
        result: { weight_type: "requested", job_id: "job", progress: 0.9 } });
    assert.deepEqual(subject.runtime.store.get(atom).data, [
        { id: "requested", is_pending: false, is_downloaded: true, progress: null },
        { id: "other", is_pending: true, is_downloaded: false, progress: 50 },
    ]);
});

test("a consent the core asks for is a translated notice", async () => {
    const subject = await loadBridgeRoutes();
    subject.receiveRoutes({ status: 400, endpoint: "/run/error_ctranslate2_weight", result: {
        error_code: "WEIGHT_DOWNLOAD_CONSENT_REQUIRED", data: { kind: "ctranslate2", weight_type: "requested" },
    } });
    assert.equal(subject.notices[0].key, "backend_errors.WEIGHT_DOWNLOAD_CONSENT_REQUIRED");
    subject.receiveRoutes({ status: 400, endpoint: "/run/error_ctranslate2_weight", result: {
        error_code: "WEIGHT_DOWNLOAD_CONSENT_REQUIRED", data: { kind: "ctranslate2", weight_type: "requested", startup: true },
    } });
    assert.equal(subject.notices[1].key, "legacy_model_downloads.startup_skipped");
});
