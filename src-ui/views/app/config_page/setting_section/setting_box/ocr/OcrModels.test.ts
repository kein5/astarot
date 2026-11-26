import assert from "node:assert/strict";
import { test } from "vitest";
import { find, findIn, hooks, loadModule, nodesIn, kitStandIns } from "../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../logics/test/hookHarness.ts";

// Chat reading's models as a part of a catalog (#831): a bar with their readout, cards in the
// layout chosen for every catalog, each with its name and state, its size, its terms and its
// download. The part starts closed as every catalog's part; its readout says what is missing.
const MODEL = { id: "ppocr", target: "ocr", name: "PP-OCR small", provider: "PaddlePaddle", license: "Apache-2.0", licenses: [],
    notice: "ppocr", artifacts: [], total_bytes: 31_457_280, destination: "/models/ocr", source: "https://example.invalid/ppocr" };
const t = (key: string, options?: object) => options ? `${key}:${JSON.stringify(options)}` : key;

async function ocrModels(layout: "grid" | "list", jobs: Record<string, object> = {}, pending: object | null = null, model: object = MODEL) {
    const runtime = hooks();
    const sent: unknown[] = [];
    const { OcrModels } = await loadModule<typeof import("./OcrModels.tsx")>(new URL("./OcrModels.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t }) },
        "@tauri-apps/api/core": { isTauri: () => false },
        "@tauri-apps/plugin-opener": {},
        "../../../../../../logics/voice/useModelDownloads": { useModelDownloads: () => ({ catalog: { catalog_version: "1", models: [model] },
            state: { jobs }, error: null, pending, send: (...request: unknown[]) => sent.push(request) }) },
        "../_components/env_readout/EnvReadout": { EnvReadout: "readout" },
        "../advanced_settings/catalogLayout": { useCatalogLayout: () => layout, CatalogList: "ul", CatalogFacts: "catalog-facts",
            CatalogLayoutSwitch: "catalog-layout-switch", CatalogSection: "catalog-section", CatalogState: "catalog-state" },
        "../../../../../../logics/common/useConsentDialog": { useConsentDialog: () => ({ dialog: { current: null }, close() {} }) },
    });
    const draw = (props: { missing: string[]; checking?: boolean; ids?: string[]; inFix?: boolean; onStart?: (id: string) => void }) => runtime.render(OcrModels,
        { ids: ["ppocr"], onChanged: () => {}, title: "Recognition models", desc: "What they are", note: "Needed", ...props });
    return { draw, sent };
}

const part = (tree: TreeNode) => findIn(tree, node => node.type === "catalog-section").props;
const card = (tree: TreeNode) => findIn(tree, node => node.props?.["data-model-download"] !== undefined);
// A card's parts by name: the kit's Card parts, the catalog's fold, or the classes of a part of its own.
const KIT_PARTS = new Map<unknown, string>([[kitStandIns.CardHeader, "CardHeader"], [kitStandIns.CardContent, "CardContent"],
    [kitStandIns.CardFooter, "CardFooter"]]);
const parts = (node: TreeNode) => [node.props.children].flat(2).filter(Boolean)
    .map(child => child.type === "catalog-facts" ? "catalog-facts" : KIT_PARTS.get(child.type) ?? String(child.props.className));
// The card's state: the catalogs' state badge (catalogLayout.tsx's CatalogState), which draws each state's look.
const state = (node: TreeNode) => findIn(node, child => child.type === "catalog-state").props;

test("the models are a part of a catalog, folded as every catalog's part, with their readout", async () => {
    const s = await ocrModels("list");
    let tree = s.draw({ missing: ["ppocr"] });
    assert.deepEqual([part(tree).title, part(tree).level, part(tree).help], ["Recognition models", 3, ["What they are"]]);
    // Folded like the catalogs' parts (CatalogSection starts them closed), even with a model missing.
    assert.equal(part(tree).fold, true);
    assert.equal(part(tree).readout, 'model_catalog.group_readout:{"count":1,"obtained":0}');
    assert.ok(find(tree, node => node.type === "catalog-layout-switch"), "the layout buttons at the head of the part");
    tree = s.draw({ missing: [] });
    assert.equal(part(tree).readout, 'model_catalog.group_readout:{"count":1,"obtained":1}');
});

test("until the page hears which models it needs, the part's bar keeps its place and says it is checking (#912)", async () => {
    const s = await ocrModels("list");
    // While checking the page knows no model yet (Ocr.tsx passes the empty list).
    const tree = s.draw({ missing: [], checking: true, ids: [] });
    assert.equal(part(tree).readout, "config_page.ocr.readiness.checking");
    assert.equal(part(tree).title, "Recognition models");
    assert.equal(find(tree, node => node.props?.["data-model-download"] !== undefined), null, "no card until the answer");
});

test("a model's card says its state by the catalogs' badges, why it is listed, its size and terms, and its download", async () => {
    for (const layout of ["list", "grid"] as const) {
        const s = await ocrModels(layout);
        const missing = card(s.draw({ missing: ["ppocr"] }));
        // The kit's Card, an item of the catalog's list.
        assert.deepEqual([missing.type, missing.props.as, missing.props["data-status"], missing.props.tabIndex, missing.props.role, missing.props["aria-label"]],
            [kitStandIns.Card, "li", "not_downloaded", -1, "group", "PP-OCR small"]);
        assert.deepEqual([state(missing).state, state(missing).children], ["not_downloaded", "model_catalog.status.not_downloaded"]);
        assert.ok(find(missing, node => node.type === kitStandIns.Badge && node.props.tone === undefined && node.props.children === "Needed"),
            "why the page lists it, in a plain badge");
        // In the list the size and the terms are one table beside what the model is; in the grid
        // the size is on the card and the terms are in its fold.
        assert.deepEqual(parts(missing), layout === "list" ? ["CardHeader", "CardContent", "CardFooter"]
            : ["CardHeader", "facts card_key", "catalog-facts", "CardFooter"]);
        const words = nodesIn(missing).filter(node => node.type === "dd").map(node => node.props.children);
        assert.ok(words.includes("30.0 MB"), layout);
        assert.ok(nodesIn(missing).some(node => node.type === "dd" && [node.props.children].flat().join("").includes("PaddlePaddle")), layout);
        findIn(missing, node => node.type === kitStandIns.Button && node.props.children === "model_downloads.review").props.onClick();
        // Downloaded: the filled badge, and nothing left to do.
        const there = card(s.draw({ missing: [] }));
        assert.equal(state(there).state, "downloaded");
        assert.equal(find(there, node => node.type === kitStandIns.Button), null);
    }
});

test("a download in progress says so on its card, with its progress and a way to cancel it", async () => {
    const s = await ocrModels("grid", { ppocr: { job_id: "job", phase: "downloading", received_bytes: 10_485_760, total_bytes: 31_457_280 } });
    const running = card(s.draw({ missing: ["ppocr"] }));
    assert.equal(state(running).state, "working");
    const bar = findIn(running, node => node.type === kitStandIns.Progress).props;
    assert.deepEqual([bar["aria-label"], bar.value, bar.max], ["model_downloads.progress", 10_485_760, 31_457_280]);
    assert.ok(find(running, node => node.type === "readout"), "what runs, on the card");
    findIn(running, node => node.type === kitStandIns.Button && node.props.children === "model_downloads.cancel").props.onClick();
    assert.deepEqual(s.sent.at(-1), ["/run/cancel_model_download", { id: "ppocr", job_id: "job" }]);
    assert.equal(find(running, node => node.type === kitStandIns.Button && node.props.children === "model_downloads.review"), null);
});

test("the cancel waits while a request is out or the download is being cancelled, and a finished job has none", async () => {
    const cancel = (tree: TreeNode) => find(card(tree), node => node.type === kitStandIns.Button && node.props.children === "model_downloads.cancel");
    const downloading = { job_id: "job", phase: "downloading", received_bytes: 1, total_bytes: 2 };
    assert.equal(cancel((await ocrModels("list", { ppocr: downloading })).draw({ missing: ["ppocr"] }))?.props.disabled, false);
    assert.equal(cancel((await ocrModels("list", { ppocr: downloading }, { endpoint: "/run/start_model_download" })).draw({ missing: ["ppocr"] }))?.props.disabled, true);
    assert.equal(cancel((await ocrModels("list", { ppocr: { ...downloading, phase: "cancelling" } })).draw({ missing: ["ppocr"] }))?.props.disabled, true);
    // A failed job is not running: nothing to cancel, and the review is offered again.
    const failed = (await ocrModels("list", { ppocr: { job_id: "job", phase: "failed", error_code: "download_failed" } })).draw({ missing: ["ppocr"] });
    assert.equal(cancel(failed), null);
    assert.equal(find(card(failed), node => node.type === kitStandIns.Progress), null, "a job that does not run has no bar");
    assert.ok(find(card(failed), node => node.type === kitStandIns.Button && node.props.children === "model_downloads.review"));
});

// The review is the kit's Dialog (D-23): its title and facts in the header, the consent under them,
// Back and Start in the footer in that order, Back with the first focus and Start the primary
// Button (#462). It is named by its title alone, as before (D-43).
test("the review is the kit's Dialog, with Back and the primary Start in its footer", async () => {
    const files = [{ filename: "det.onnx", size: 9_880_512 }, { filename: "rec.yml", size: 150_579 }];
    const s = await ocrModels("list", {}, null, { ...MODEL, artifacts: files });
    const review = findIn(card(s.draw({ missing: ["ppocr"] })), node => node.type === kitStandIns.Button && node.props.children === "model_downloads.review");
    review.props.onClick();
    const dialog = findIn(s.draw({ missing: ["ppocr"] }), node => node.type === kitStandIns.Dialog);
    assert.deepEqual([dialog.props.open, "aria-describedby" in dialog.props, dialog.props["aria-describedby"]], [true, true, undefined]);
    const header = findIn(dialog, node => node.type === kitStandIns.DialogHeader);
    assert.equal(findIn(header, node => node.type === kitStandIns.DialogTitle).props.children, "model_downloads.warning_title");
    // Where it goes, in a line that breaks anywhere, and each file with its exact size, keyed by its
    // name (the harness reads the keys as React.Children gives them).
    const destination = findIn(header, node => node.type === "code");
    assert.deepEqual([destination.props.children, destination.props.style], ["/models/ocr", { overflowWrap: "anywhere" }]);
    assert.equal(findIn(header, node => node.type === "p" && [node.props.children].flat().some(child => child?.type === "code")).props.children[0], "model_downloads.destination");
    const list = findIn(header, node => node.type === "ul");
    assert.equal(list.props.className, "dialog_files");
    assert.deepEqual(nodesIn(list).filter(node => node.type === "li").map(item => [item.key, [item.props.children].flat().join("")]), [
        [".$det.onnx", 'det.onnx · model_downloads.exact_bytes:{"bytes":"9,880,512"}'], [".$rec.yml", 'rec.yml · model_downloads.exact_bytes:{"bytes":"150,579"}']]);
    const consent = findIn(dialog, node => node.type === "label");
    assert.deepEqual([consent.props.className, [consent.props.children].flat().at(-1)], ["checkLabel", "model_downloads.consent"]);
    const footer = findIn(dialog, node => node.type === kitStandIns.DialogFooter);
    const buttons = nodesIn(footer).filter(node => node.type === kitStandIns.Button).map(node => [node.props.children, node.props.tone, node.props.autoFocus]);
    assert.deepEqual(buttons, [["model_downloads.back", undefined, true], ["model_downloads.start", "primary", undefined]]);
    // The consent stays a native checkbox (D-16), between the facts and the buttons.
    const parts = [dialog.props.children].flat(2).filter(Boolean).map((child: TreeNode) => child.type);
    assert.deepEqual(parts, [kitStandIns.DialogHeader, "label", kitStandIns.DialogFooter]);
    // Escape: the kit's Dialog asks its owner to close it.
    dialog.props.onOpenChange(false);
    assert.equal(find(s.draw({ missing: ["ppocr"] }), node => node.type === kitStandIns.Dialog), null);
});

// In the chat reading fix (#1241): the models in a list under their heading, without the part's fold
// or the layout buttons, whatever layout the catalogs have; a download started after its review is
// reported to the dialog, which waits for it.
test("in the fix the models are a plain list, and a download started there is told to the dialog", async () => {
    const s = await ocrModels("grid");
    const started: string[] = [];
    const draw = () => s.draw({ missing: ["ppocr"], inFix: true, onStart: id => started.push(id) });
    let tree = draw();
    assert.equal(part(tree).fold, false);
    assert.equal(find(tree, node => node.type === "catalog-layout-switch"), null);
    assert.equal(findIn(tree, node => node.type === "ul").props.layout, "list");
    findIn(card(tree), node => node.type === kitStandIns.Button && node.props.children === "model_downloads.review").props.onClick();
    tree = draw();
    const dialog = findIn(tree, node => node.type === kitStandIns.Dialog);
    // The start waits for the consent, as everywhere.
    findIn(dialog, node => node.type === "input").props.onChange({ target: { checked: true } });
    const start = findIn(draw(), node => node.type === kitStandIns.Button && node.props.children === "model_downloads.start");
    start.props.onClick();
    assert.deepEqual(s.sent.at(-1), ["/run/start_model_download", { id: "ppocr", consent: true, catalog_version: "1" }]);
    assert.deepEqual(started, ["ppocr"]);
});
