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

async function ocrModels(layout: "grid" | "list", jobs: Record<string, object> = {}, pending: object | null = null) {
    const runtime = hooks();
    const sent: unknown[] = [];
    const { OcrModels } = await loadModule<typeof import("./OcrModels.tsx")>(new URL("./OcrModels.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t }) },
        "@tauri-apps/api/core": { isTauri: () => false },
        "@tauri-apps/plugin-opener": {},
        "../../../../../../logics/voice/useModelDownloads": { useModelDownloads: () => ({ catalog: { catalog_version: "1", models: [MODEL] },
            state: { jobs }, error: null, pending, send: (...request: unknown[]) => sent.push(request) }) },
        "../_components/env_readout/EnvReadout": { EnvReadout: "readout" },
        "../advanced_settings/catalogLayout": { useCatalogLayout: () => layout, CatalogList: "ul", CatalogFacts: "catalog-facts",
            CatalogLayoutSwitch: "catalog-layout-switch", CatalogSection: "catalog-section" },
        "../../../../../../logics/common/useConsentDialog": { useConsentDialog: () => ({ dialog: { current: null }, close() {} }) },
    });
    const draw = (props: { missing: string[]; checking?: boolean; ids?: string[] }) => runtime.render(OcrModels,
        { ids: ["ppocr"], onChanged: () => {}, title: "Recognition models", desc: "What they are", note: "Needed", ...props });
    return { draw, sent };
}

const part = (tree: TreeNode) => findIn(tree, node => node.type === "catalog-section").props;
const card = (tree: TreeNode) => findIn(tree, node => node.props?.["data-model-download"] !== undefined);
const parts = (node: TreeNode) => [node.props.children].flat(2).filter(Boolean)
    .map(child => child.type === "catalog-facts" ? "catalog-facts" : String(child.props.className));
const state = (node: TreeNode) => findIn(node, child => child.props?.className === "badge status").props;

test("the models are a part of a catalog, folded as every catalog's part, with their readout", async () => {
    const s = await ocrModels("list");
    let tree = s.draw({ missing: ["ppocr"] });
    assert.deepEqual([part(tree).title, part(tree).level, part(tree).help], ["Recognition models", 3, ["What they are"]]);
    // Folded like the catalogs' parts (CatalogSection starts them closed), even with a model missing.
    assert.equal(part(tree).fold, undefined);
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
        assert.deepEqual([state(missing)["data-tone"], state(missing).children], ["not_downloaded", "model_catalog.status.not_downloaded"]);
        assert.ok(find(missing, node => node.props?.className === "badge" && node.props.children === "Needed"), "why the page lists it");
        // In the list the size and the terms are one table beside what the model is; in the grid
        // the size is on the card and the terms are in its fold.
        assert.deepEqual(parts(missing), layout === "list" ? ["card_intro", "facts card_spec", "card_foot"]
            : ["card_intro", "facts card_key", "catalog-facts", "card_foot"]);
        const words = nodesIn(missing).filter(node => node.type === "dd").map(node => node.props.children);
        assert.ok(words.includes("30.0 MB"), layout);
        assert.ok(nodesIn(missing).some(node => node.type === "dd" && [node.props.children].flat().join("").includes("PaddlePaddle")), layout);
        findIn(missing, node => node.type === kitStandIns.Button && node.props.children === "model_downloads.review").props.onClick();
        // Downloaded: the filled badge, and nothing left to do.
        const there = card(s.draw({ missing: [] }));
        assert.equal(state(there)["data-tone"], "downloaded");
        assert.equal(find(there, node => node.type === kitStandIns.Button), null);
    }
});

test("a download in progress says so on its card, with its progress and a way to cancel it", async () => {
    const s = await ocrModels("grid", { ppocr: { job_id: "job", phase: "downloading", received_bytes: 10_485_760, total_bytes: 31_457_280 } });
    const running = card(s.draw({ missing: ["ppocr"] }));
    assert.equal(state(running)["data-tone"], "working");
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
