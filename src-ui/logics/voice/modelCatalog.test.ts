import { test } from "vitest";
import assert from "node:assert/strict";
import { catalogFamilies, downloadStatus, familyLabel, firstVariant, variantLabel } from "./modelCatalog.ts";
import type { CatalogEntry, CatalogProfile } from "./modelCatalog.ts";
import { unchecked } from "../test/hookHarness.ts";
import { localeAt, readLocale } from "../test/locales.ts";

const profile = (summary: string, extra: Partial<CatalogProfile> = {}): CatalogProfile => ({ summary, languages: ["ja"], recommended_for: [], memory_bytes: null,
    memory_measured_on: null, tier: null, cpu: "unverified", gpu: "recommended", ...extra });
const tts = (id: string, name: string, summary: string, extra?: Partial<CatalogProfile>): CatalogEntry =>
    ({ id, target: "japanese", name, total_bytes: 1, profile: profile(summary, extra), speech: null });
const asr = (id: string, type: string, isDefault: boolean): CatalogEntry => ({ id, target: "asr", name: `Haas-ja v1.0 · ${type.toUpperCase()}`, total_bytes: 1,
    profile: profile("haas"), speech: { name: "haas-ja-v1.0", label: "Haas-ja v1.0", type, default: isDefault } });

test("rows of one model become one card, in catalog order", () => {
    const rows = [tts("irodori-v41-f16", "Irodori-TTS v4.1 Small MF · F16", "irodori_mf", { recommended_for: ["ja"] }),
        tts("irodori-v41-small-f16", "Irodori-TTS v4.1 Small · F16", "irodori_small"),
        tts("irodori-v41-q8", "Irodori-TTS v4.1 Small MF · Q8_0", "irodori_mf")];
    const families = catalogFamilies(rows);
    assert.deepEqual(families.map(family => [family.key, family.rows.map(row => row.id)]),
        [["irodori_mf", ["irodori-v41-f16", "irodori-v41-q8"]], ["irodori_small", ["irodori-v41-small-f16"]]]);
    assert.equal(familyLabel(rows[2]), "Irodori-TTS v4.1 Small MF");
    assert.equal(variantLabel(rows[2]), "Q8_0");
});

test("recognizers are grouped by speech.cpp's name and labelled by its file type", () => {
    const rows = [asr("haas-ja-q8", "q8_0", true), asr("haas-ja-q4", "q4_k", false)];
    const [family] = catalogFamilies(rows);
    assert.equal(family.key, "haas-ja-v1.0");
    assert.equal(familyLabel(rows[1]), "Haas-ja v1.0");
    assert.equal(variantLabel(rows[1]), "Q4_K");
    // A row without a profile (RVC) is its own card, named as the catalog names it.
    const rvc: CatalogEntry = { id: "rvc-saisho", target: "rvc", name: "Saisho Utane · RVC v2", total_bytes: 1, profile: null, speech: null };
    assert.equal(catalogFamilies([rvc])[0].key, "rvc-saisho");
    assert.equal(variantLabel(rvc), "RVC v2");
});

test("the first file shown is in use, then fits the memory, then is the default", () => {
    const rows = [asr("haas-ja-q4", "q4_k", false), asr("haas-ja-q8", "q8_0", true)];
    assert.equal(firstVariant(rows, null, () => false).id, "haas-ja-q8");
    assert.equal(firstVariant(rows, "haas-ja-q4", () => false).id, "haas-ja-q4");
    assert.equal(firstVariant(rows, null, row => row.id === "haas-ja-q4").id, "haas-ja-q4");
    assert.equal(firstVariant(rows, "haas-ja-q4", row => row.id === "haas-ja-q8").id, "haas-ja-q8");
});

test("download status after a restart comes from the files on disk, in use only when the saved path is the file", () => {
    // Test data: downloadStatus reads only the entry's id.
    const entry = unchecked<CatalogEntry>({ id: "haas-ja-q8" });
    const downloaded = { "haas-ja-q8": { model: "C:/models/haas-ja-q8/rev/model.gguf" } };
    assert.equal(downloadStatus(entry, undefined, {}, { model: "" }), "not_downloaded");
    assert.equal(downloadStatus(entry, undefined, undefined, undefined), "not_downloaded");
    assert.equal(downloadStatus(entry, undefined, downloaded, { model: "" }), "downloaded");
    assert.equal(downloadStatus(entry, undefined, downloaded, { model: "D:/other.gguf" }), "downloaded");
    assert.equal(downloadStatus(entry, undefined, downloaded, { model: "C:/models/haas-ja-q8/rev/model.gguf" }), "in_use");
    assert.equal(downloadStatus(entry, { phase: "downloading" }, downloaded, undefined), "working");
    assert.equal(downloadStatus(entry, { phase: "ready" }, downloaded, undefined), "ready");
    assert.equal(downloadStatus(entry, { phase: "failed" }, {}, undefined), "not_downloaded");
    // An answer from an older backend has no `downloaded`; an applied job still counts.
    assert.equal(downloadStatus(entry, { phase: "applied", paths: { model: "/m.gguf" } }, undefined, { model: "/m.gguf" }), "in_use");
});

test("every catalog group a settings page shows has its heading and help in en and ja", async () => {
    // SpeechServers (japanese, multilingual, asr, vad, diarization), DirectVoiceSettings (rvc),
    // LegacyModelDownloadDialog (translation), and the speech engines group.
    const groups = ["japanese", "multilingual", "asr", "vad", "diarization", "rvc", "translation", "engines"];
    for (const language of ["en", "ja"]) {
        const strings = readLocale(language);
        for (const group of groups) {
            assert.equal(typeof localeAt(strings, `model_catalog.group.${group}`), "string", `${language}: model_catalog.group.${group}`);
            assert.equal(typeof localeAt(strings, `model_catalog.group_help.${group}`), "string", `${language}: model_catalog.group_help.${group}`);
        }
    }
});
