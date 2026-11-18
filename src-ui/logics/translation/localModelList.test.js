import assert from "node:assert/strict";
import { test } from "vitest";
import { ctranslate2_weight_type_status } from "../ui_configs.ts";
import { needsLicenseConfirmation } from "../configs/ctranslate2License.ts";
import { localModelList } from "./localModelList.ts";

const DEFAULT = "m2m100_418M-ct2-int8";
const NLLB = "nllb-200-distilled-600M-ct2-int8";
const weights = (downloaded = []) => [
    ...ctranslate2_weight_type_status.map(weight => ({ ...weight, is_downloaded: downloaded.includes(weight.id) })),
    { id: "custom:my-model", is_custom: true, is_downloaded: true },
    { id: "user:tr-1", is_custom: true, is_downloaded: false },
];
const published = (...ids) => ({ legacy_models: [], models: ids.map(id => ({ id, target: "translation" })) });
const ids = list => list.rows.map(row => row.id);

test("with nothing published only the selected built-in model and the user's models are listed", () => {
    const list = localModelList(weights(), DEFAULT, published());
    assert.deepEqual(ids(list), [DEFAULT, "custom:my-model", "user:tr-1"]);
    // The selected row stays for the line above the list, marked: it has no download button.
    assert.equal(list.rows[0].download_unavailable, true);
    assert.equal(list.rows[1].download_unavailable, undefined);
    assert.equal(list.unavailable, true);
});

test("a published weight is listed with its download, the others are not", () => {
    const list = localModelList(weights(), NLLB, published("m2m100-418m-onnx-int8"));
    assert.deepEqual(ids(list), [DEFAULT, NLLB, "custom:my-model", "user:tr-1"]);
    assert.equal(list.rows.find(row => row.id === DEFAULT).download_unavailable, undefined);
    assert.equal(list.rows.find(row => row.id === NLLB).download_unavailable, true);
    // A model can be had: the note that points to other engines is not needed.
    assert.equal(list.unavailable, false);
});

test("a listed NLLB row keeps what its license confirmation reads", () => {
    const list = localModelList(weights(), DEFAULT, published("nllb-200-distilled-600m-onnx-int8"));
    const nllb = list.rows.find(row => row.id === NLLB);
    assert.equal(nllb.license, "CC-BY-NC-4.0");
    assert.equal(needsLicenseConfirmation(nllb, DEFAULT), true);
    assert.equal(nllb.download_unavailable, undefined);
});

test("downloaded built-in models stay listed, and a usable selection needs no note", () => {
    const list = localModelList(weights(["m2m100_1.2B-ct2-int8"]), "m2m100_1.2B-ct2-int8", published());
    assert.deepEqual(ids(list), ["m2m100_1.2B-ct2-int8", "custom:my-model", "user:tr-1"]);
    assert.equal(list.unavailable, false);
    // The user's own model in use: the local translation works.
    assert.equal(localModelList(weights(), "custom:my-model", published()).unavailable, false);
    // Their model is gone, and nothing can be downloaded: other engines are the way.
    assert.equal(localModelList(weights(), "user:tr-1", published()).unavailable, true);
});

test("before the catalog arrives nothing is marked, and nothing that may not be offered is listed", () => {
    const list = localModelList(weights(), DEFAULT, null);
    assert.deepEqual(ids(list), [DEFAULT, "custom:my-model", "user:tr-1"]);
    assert.equal(list.rows[0].download_unavailable, undefined);
    assert.equal(list.unavailable, false);
});

test("a download on its way keeps its row", () => {
    const rows = weights().map(row => row.id === NLLB ? { ...row, is_pending: true } : row);
    assert.ok(ids(localModelList(rows, DEFAULT, published())).includes(NLLB));
});

test("an empty or missing list is an empty list", () => {
    assert.deepEqual(localModelList(null, DEFAULT, published()), { rows: [], unavailable: true });
    assert.deepEqual(localModelList([], "", null), { rows: [], unavailable: false });
});
