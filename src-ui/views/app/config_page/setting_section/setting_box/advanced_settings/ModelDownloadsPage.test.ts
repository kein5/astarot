import assert from "node:assert/strict";
import { createElement } from "react";
import { test, vi } from "vitest";
import type { TestContext } from "vitest";
import { componentName, componentOf, find, findIn, hooks, kitStandIns, loadModule, nodesIn, treeNode } from "../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../logics/test/hookHarness.ts";
import * as languageNames from "../../../../../../logics/common/languageNames.ts";
import * as modelCatalog from "../../../../../../logics/voice/modelCatalog.ts";
import * as modelHardwareAdvice from "../../../../../../logics/voice/modelHardwareAdvice.ts";
import * as modelHardwareWarning from "../../../../../../logics/voice/modelHardwareWarning.ts";
import * as modelRestrictions from "../../../../../../logics/voice/modelRestrictions.ts";

// The model catalog (ModelDownloads.tsx) drawn with the real rules it applies: how rows group into
// cards and which file a card shows, the advice on free GPU memory, the warning for a model too heavy
// for the PC, and the restrictions of a model's license. The downloads hook is a stand-in that
// holds the catalog, the jobs and the hardware reading the test gives and records what the page
// sends; the shared parts are stand-ins that keep their props.

const GiB = 1024 ** 3;

// The words: a key with the values it was given. Of several keys the first in the locale is used,
// and a key not in the locale (one with "absent" in it, or one named) gives its defaultValue, as
// i18next does.
function translator(missing: readonly string[] = []) {
    const absent = (key: string) => key.includes("absent") || missing.includes(key);
    return (key: string | readonly string[], options?: Record<string, unknown>): string => {
        const keys = [key].flat();
        const found = keys.find(item => !absent(item));
        const { defaultValue, ...values } = options ?? {};
        if (found === undefined) return defaultValue === undefined ? String(keys.at(-1)) : String(defaultValue);
        return Object.keys(values).length ? `${found} ${JSON.stringify(values)}` : found;
    };
}

type Row = Record<string, unknown> & { id: string };
// A catalog row with every field the page reads; the test changes what it is about.
const model = (id: string, extra: Record<string, unknown> = {}): Row => ({ id, target: "asr", name: `${id} · Q8_0`, total_bytes: GiB, provider: "Maker", license: "MIT",
    licenses: ["https://example.com/card", "https://huggingface.co/org/repo/blob/main/LICENSE-MIT", "https://example.com/terms"], source: "https://example.com/source",
    repo: "org/repo", destination: "models/asr", notice: "general", artifacts: [{ filename: "model.gguf", size: GiB }], ...extra });
const catalogOf = (models: Row[]) => ({ catalog_version: "v7", models });
const gpu = (name: string, free: number | null, total: number | null, description = "Card") => ({ name, description, kind: "gpu", memory_free: free, memory_total: total });
const measuredAt = Date.now() - 1000;
const readyHardware = (devices: object[], measured: number = measuredAt) => ({ phase: "ready", devices, measured_at_ms: measured, observation_id: "1" });
// A speech model whose measured memory passed its check: the advice can suggest it.
const checked = (bytes: number, extra: Record<string, unknown> = {}) => ({ tier: "medium", reference_memory_bytes: bytes, validation: { state: "passed", ...extra } });

interface Job { job_id: string; phase: string; received_bytes?: number; total_bytes?: number; error_code?: string | null; paths?: Record<string, string> }
interface Downloads {
    catalog: unknown;
    state: { observation_id: string; jobs: Record<string, Job>; downloaded?: Record<string, Record<string, string>> };
    hardware: unknown;
    error: string | null;
    pending: { endpoint: string; id: unknown; job_id: unknown }[] | null;
    userModels: unknown;
    send: (...args: unknown[]) => void;
    ensureHardware: () => void;
}
interface PageOptions { layout?: string; hints?: boolean; i18n?: { language?: string } | null; tauri?: boolean; openUrl?: (url: string) => Promise<void>; missing?: string[] }

async function catalogPage(context: TestContext, given: Partial<Downloads> = {}, options: PageOptions = {}) {
    const sent: unknown[][] = [], opened: string[] = [], counts = { ensured: 0 };
    const consent = { asked: [] as { open: boolean; fallback: unknown }[], closed: 0 };
    const downloads: Downloads = { catalog: null, state: { observation_id: "1", jobs: {} }, hardware: { phase: "unknown", devices: [] }, error: null,
        pending: null, userModels: null, ...given,
        send: (...args: unknown[]) => { sent.push(args); }, ensureHardware: () => { counts.ensured++; } };
    // The hooks of a harness runtime, with every state update recorded: the page's timers only ask
    // for a new drawing, which the harness leaves to the test.
    const base = hooks(), updates: unknown[] = [];
    const recordedState = <S>(initial: S | (() => S)): [S, (value: S | ((previous: S) => S)) => void] => {
        const [value, set] = base.api.useState(initial);
        return [value, next => { updates.push(next); set(next); }];
    };
    const runtime = { ...base, api: { ...base.api, useState: recordedState } };
    context.onTestFinished(() => runtime.unmount());
    const t = translator(options.missing);
    const module = await loadModule<typeof import("./ModelDownloads.tsx")>(new URL("./ModelDownloads.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => options.i18n === null ? { t } : { t, i18n: options.i18n ?? { language: "en" } } },
        "@tauri-apps/api/core": { isTauri: () => options.tauri ?? false },
        "@tauri-apps/plugin-opener": { openUrl: options.openUrl ?? (async (url: string) => { opened.push(url); }) },
        "../../../../../../logics/voice/useModelDownloads": { useModelDownloads: () => downloads },
        "../../../../../../logics/voice/modelHardwareAdvice": modelHardwareAdvice,
        "../../../../../../logics/voice/modelHardwareWarning": modelHardwareWarning,
        "../../../../../../logics/voice/modelRestrictions": modelRestrictions,
        "../../../../../../logics/voice/modelCatalog": modelCatalog,
        "../../../../../../logics/common/languageNames": languageNames,
        "../../../../../../logics/common/useConsentDialog": { useConsentDialog: (open: boolean, fallback: unknown) => {
            consent.asked.push({ open, fallback });
            return { dialog: "dialog", close: () => { consent.closed++; } };
        } },
        "../_components/fold/Fold": { Fold: "fold" },
        "../_components/env_readout/EnvReadout": { EnvReadout: "readout" },
        "../_components/hint/Hint": { Hint: "hint", useHintDescriptions: () => options.hints ?? false },
        "./catalogHeading": { catalogHeading: (...args: unknown[]) => createElement("catalog-heading", { args }) },
        "./catalogLayout": { useCatalogLayout: () => options.layout ?? "list", CatalogList: "catalog-list", CatalogFacts: "catalog-facts",
            CatalogLayoutSwitch: "catalog-layout-switch", CatalogSection: "catalog-section", CatalogState: "catalog-state" },
        "./EngineCatalog": { EngineCatalog: "engine-catalog" },
        "./UserModels": { UserModelCards: "user-model-cards", UserModelRegistration: "user-model-registration" },
        "./VoiceAudition": { AuditionButton: "audition-button", AuditionNote: "audition-note" },
    });
    type Props = Parameters<typeof module.ModelDownloads>[0];
    let props: Props = { targets: ["asr"] };
    // Draws the page with these props (kept for the next drawing), as React would after a change.
    const draw = (next: Partial<Props> = {}) => {
        props = { ...props, ...next };
        return runtime.render(module.ModelDownloads, props);
    };
    return { module, runtime, downloads, sent, opened, consent, counts, updates, draw };
}

// The words a part of the tree shows.
const textOf = (value: unknown): string => {
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (Array.isArray(value)) return value.map(textOf).join("");
    const node = treeNode(value);
    return node ? textOf(node.props.children) : "";
};
// type: an element's tag, or a part of the kit (kitStandIns).
const ofType = (tree: unknown, type: unknown) => nodesIn(tree).filter(node => node.type === type);
const texts = (tree: unknown, type: unknown) => ofType(tree, type).map(textOf);
// The words of a card's badges in the accent tone: what speaks for the model (recommended, fits the memory).
const accentBadges = (tree: unknown) => ofType(tree, kitStandIns.Badge).filter(node => node.props.tone === "accent").map(textOf);
const named = (tree: unknown, name: string) => nodesIn(tree).filter(node => componentName(node) === name);
const cards = (tree: unknown) => nodesIn(tree).filter(node => node.props?.["data-model-download"] === true);
const cardNamed = (tree: unknown, label: string) => findIn(tree, node => node.props?.["data-model-download"] === true && node.props["aria-label"] === label, `the card ${label}`);
// The page's own buttons, or the kit's Button of its review dialog (the kit's Dialog, D-23).
const buttonNamed = (tree: unknown, words: string) => findIn(tree, node => (node.type === "button" || node.type === kitStandIns.Button) && textOf(node) === words, `the button ${words}`);
const isDialog = (node: TreeNode) => node.type === kitStandIns.Dialog;
const ofPart = (tree: unknown, part: unknown) => nodesIn(tree).filter(node => node.type === part);
const classesOf = (node: TreeNode) => String(node.props.className ?? "").split(" ").filter(Boolean);
// A card's line that names the type of its only file: the word and the type.
const variantLines = (card: TreeNode) => ofType(card, "p").filter(node => ofType(node, "span").length === 2).map(node => texts(node, "span"));
// The lines of a part's advice on GPU memory.
const adviceOf = (tree: unknown, target: string) => texts(findIn(tree, node => node.type === "catalog-section" && node.props.id === `model-catalog-${target}`), "p");
// One of the module's own parts drawn with the props the test gives (none of them keeps state).
const drawPart = (tree: unknown, name: string, props: object) => {
    const [node] = named(tree, name);
    assert.ok(node, name);
    return componentOf(node)(props);
};

test("while the catalog is on its way the page says so and offers to ask again; a new connection asks again", async context => {
    const p = await catalogPage(context);
    let tree = p.draw();
    assert.deepEqual(p.sent, [["/get/data/model_download_catalog"], ["/get/data/model_download_state"], ["/get/data/user_models"]]);
    assert.deepEqual([tree.type, tree.props.tabIndex, tree.props["aria-label"]], ["section", -1, "model_downloads.title"]);
    const heading = findIn(tree, node => node.type === "catalog-heading").props.args;
    assert.deepEqual(heading.slice(0, 5), [false, "h3", "model_downloads.title", ["model_downloads.help"], undefined]);
    assert.equal(heading[5].type, "catalog-layout-switch");
    assert.deepEqual(texts(tree, "p"), ["model_downloads.loading"]);
    assert.equal(findIn(tree, node => node.type === "p").props["aria-busy"], "true");
    buttonNamed(tree, "voice.retry").props.onClick();
    assert.deepEqual(p.sent.at(-1), ["/get/data/model_download_catalog"]);

    p.sent.length = 0;
    p.draw();
    assert.deepEqual(p.sent, [], "drawn again, nothing is asked twice");
    p.downloads.send = (...args: unknown[]) => { p.sent.push(["new", ...args]); };
    p.draw();
    assert.deepEqual(p.sent, [["new", "/get/data/model_download_catalog"], ["new", "/get/data/model_download_state"], ["new", "/get/data/user_models"]]);

    p.downloads.catalog = catalogOf([]);
    tree = p.draw();
    assert.deepEqual(texts(tree, "p"), [], "the catalog is there: no loading line");
    assert.deepEqual(texts(tree, "button"), [], "and no retry");
    // One model asked about (the translation review): no layout buttons on the heading's line.
    assert.equal(findIn(p.draw({ only: ["x"] }), node => node.type === "catalog-heading").props.args[5], false);
});

test("the catalog reads the hardware once it is drawn, and again when the reading or the way to read it changes", async context => {
    const p = await catalogPage(context);
    p.draw();
    assert.equal(p.counts.ensured, 1);
    p.draw();
    assert.equal(p.counts.ensured, 1);
    p.downloads.hardware = { phase: "probing", devices: [] };
    p.draw();
    assert.equal(p.counts.ensured, 2);
    p.downloads.ensureHardware = () => { p.counts.ensured += 10; };
    p.draw();
    assert.equal(p.counts.ensured, 12);
});

test("a speech output catalog keeps its GPU reading fresh every five seconds, and stops when it is closed", async context => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const p = await catalogPage(context, { catalog: catalogOf([]) });
    p.draw({ targets: ["asr"] });
    assert.equal(vi.getTimerCount(), 0, "speech recognition alone has no advice to refresh");
    p.draw({ targets: ["asr", "multilingual"] });
    assert.equal(vi.getTimerCount(), 1);
    p.updates.length = 0;
    vi.advanceTimersByTime(5000);
    assert.equal(p.updates.filter(update => typeof update === "number").length, 1, "the page asks to be drawn again with the time");
    p.draw();
    assert.equal(vi.getTimerCount(), 1);
    p.runtime.unmount();
    assert.equal(vi.getTimerCount(), 0);

    const japanese = await catalogPage(context, { catalog: catalogOf([]) });
    japanese.draw({ targets: ["japanese"] });
    assert.equal(vi.getTimerCount(), 1);
});

test("a speech output catalog asks how much memory to keep for VR, and its advice follows the choice", async context => {
    const voice = model("voice-a", { target: "multilingual", name: "Voice A · F16", guidance: checked(GiB) });
    const p = await catalogPage(context, { catalog: catalogOf([voice]), hardware: readyHardware([gpu("GPU0", 3 * GiB, 8 * GiB, "Card")]) });
    const headroom = (tree: unknown) => findIn(tree, node => node.type === kitStandIns.Select && node.props["aria-label"] === "model_downloads.headroom");
    let tree = p.draw({ targets: ["multilingual"] });
    let select = headroom(tree);
    assert.equal(select.props.value, "vr");
    assert.deepEqual(ofType(select, kitStandIns.SelectOption).map(option => [option.props.value, textOf(option)]),
        [["vr", "model_downloads.headroom_vr"], ["alone", "model_downloads.headroom_alone"]]);
    const label = findIn(tree, node => node.type === "label" && find(node, inner => inner.props?.["aria-label"] === "model_downloads.headroom") !== null);
    assert.equal([label.props.children].flat()[0], "model_downloads.headroom");
    const advice = (tree: unknown) => texts(findIn(tree, node => node.type === "catalog-section"), "p");
    const measured = `model_downloads.hardware_measured: ${new Date(measuredAt).toLocaleTimeString("en")}`;
    // 1 GiB and its 25% allowance, with 2 GiB kept for VR, do not fit in 3 GiB free.
    assert.deepEqual(advice(tree).slice(0, 3), ["GPU0: Card · model_downloads.hardware_free: 3.00 GiB / model_downloads.hardware_total: 8.00 GiB", measured,
        "model_downloads.advice_low_memory"]);
    assert.deepEqual(accentBadges(tree), []);
    select.props.onChange({ target: { value: "alone" } });
    tree = p.draw();
    select = headroom(tree);
    assert.equal(select.props.value, "alone");
    // With half a GiB kept they do: the model is suggested by name, and its card says it fits.
    assert.deepEqual(advice(tree).slice(2, 4), ["model_downloads.advice_fits", "model_downloads.recommended: Voice A · F16"]);
    assert.deepEqual(accentBadges(cardNamed(tree, "Voice A")), ["model_catalog.fits_memory"]);

    // The refresh and the memory boundary are the page's own while it reads the GPU itself.
    const refresh = buttonNamed(tree, "model_downloads.hardware_refresh");
    assert.equal(refresh.props.disabled, false);
    refresh.props.onClick();
    assert.deepEqual(p.sent.at(-1), ["/run/refresh_model_download_hardware", {}]);
    const column = findIn(tree, node => node.type === "div" && [node.props.children].flat().some(child => treeNode(child)?.type === "button"
        && textOf(child) === "model_downloads.hardware_refresh"));
    assert.equal(classesOf(column).length, 1, "the refresh sits in its column");
    const fold = findIn(tree, node => node.type === "fold" && node.props.summary === "model_downloads.memory_boundary_summary");
    assert.deepEqual([fold.props.size, fold.props.summary, textOf(fold)], ["link", "model_downloads.memory_boundary_summary", "model_downloads.memory_boundary"]);
    assert.deepEqual(texts(tree, "span").filter(text => text === "model_downloads.hardware_probing"), []);

    p.downloads.hardware = { ...readyHardware([gpu("GPU0", 3 * GiB, 8 * GiB), gpu("GPU1", GiB, 2 * GiB)]), phase: "probing" };
    tree = p.draw();
    assert.equal(buttonNamed(tree, "model_downloads.hardware_refresh").props.disabled, true);
    const probing = findIn(tree, node => node.type === "span" && textOf(node) === "model_downloads.hardware_probing");
    assert.equal(probing.props["aria-busy"], "true");
});

test("a page that reads the GPU once for several catalogs passes its headroom down, and each catalog keeps only its advice", async context => {
    const voice = model("voice-a", { target: "japanese", name: "Voice A · F16", guidance: checked(GiB) });
    const p = await catalogPage(context, { catalog: catalogOf([voice]), hardware: readyHardware([gpu("GPU0", 3 * GiB, 8 * GiB), gpu("GPU1", GiB, 2 * GiB)]) });
    const own = p.draw({ targets: ["japanese"] });
    const lines = texts(findIn(own, node => node.type === "catalog-section"), "p");
    assert.ok(lines.includes("model_downloads.multiple_gpus"), "two GPUs: the reading says which one it used");
    const shared = p.draw({ reserve: "alone" });
    assert.deepEqual(texts(findIn(shared, node => node.type === "catalog-section"), "p").slice(0, 2), ["model_downloads.advice_fits", "model_downloads.recommended: Voice A · F16"]);
    assert.equal(find(shared, node => node.type === kitStandIns.Select), null, "no headroom of its own");
    assert.equal(find(shared, node => node.type === "fold" && node.props.summary === "model_downloads.memory_boundary_summary"), null);
    assert.deepEqual(texts(shared, "button"), ["model_downloads.review"]);
    // Speech recognition has no such advice.
    const asr = await catalogPage(context, { catalog: catalogOf([model("asr-a")]), hardware: readyHardware([gpu("GPU0", 3 * GiB, 8 * GiB)]) });
    const tree = asr.draw();
    assert.equal(find(tree, node => node.type === kitStandIns.Select || node.props?.summary === "model_downloads.memory_boundary_summary"), null);
    assert.equal(texts(tree, "p").some(text => text.startsWith("model_downloads.advice_")), false);
});

test("each use is a part of its own with what it is for, how many models it has and how many are on the PC", async context => {
    const asr = [model("whisper-q8", { name: "Whisper · Q8_0", speech: { name: "whisper", label: "Whisper", type: "q8_0", default: true } }),
        model("whisper-q4", { name: "Whisper · Q4_K", speech: { name: "whisper", label: "Whisper", type: "q4_k", default: false } }),
        model("moon", { name: "Moon · F16" })];
    const rvc = [model("voice", { target: "rvc", name: "Voice" })];
    const tts = [model("j1", { target: "japanese", name: "J1 · F16" }), model("j2", { target: "japanese", name: "J2 · F16" })];
    const own = (id: string, target: string, status = "ok") => ({ id, target, name: id, paths: { model: `/${id}.gguf` }, total_bytes: 1, registered_at: null, status });
    const p = await catalogPage(context, {
        catalog: catalogOf([...asr, ...rvc, ...tts, model("multi", { target: "multilingual", name: "Multi · F16" })]),
        state: { observation_id: "1", jobs: { voice: { job_id: "j", phase: "ready" } }, downloaded: { "whisper-q4": { model: "/q4.gguf" } } },
        userModels: { models: [own("mine", "vad"), own("gone", "vad", "missing"), own("my-asr", "asr"), own("other", "rvc", "changed")] },
    });
    const tree = p.draw({ targets: ["asr", "vad", "rvc", "translation", "diarization", "japanese", "multilingual"], blocked: "edited", expected: { vad: { model: "/mine.gguf" } },
        audition: null });
    const sections = Object.fromEntries(ofType(tree, "catalog-section").map(node => [node.props.id, node.props]));
    // No translation models and no files of one's own for it: no part. Diarization has only the files of one's own.
    assert.deepEqual(Object.keys(sections), ["model-catalog-asr", "model-catalog-vad", "model-catalog-rvc", "model-catalog-diarization", "model-catalog-japanese", "model-catalog-multilingual"]);
    const part = (target: string) => {
        const { level, fold, title, help, readout } = sections[`model-catalog-${target}`];
        return { level, fold, title, help, readout };
    };
    assert.deepEqual(part("asr"), { level: 4, fold: true, title: "model_catalog.group.asr",
        help: ["model_catalog.group_help.asr", "model_downloads.asr_choice", "model_downloads.asr_requirements"],
        readout: `model_catalog.group_readout {"count":3,"obtained":2}` });
    assert.deepEqual(part("vad"), { level: 4, fold: true, title: "model_catalog.group.vad", help: ["model_catalog.group_help.vad", "model_downloads.vad_requirements"],
        readout: `model_catalog.group_readout {"count":2,"obtained":1}` });
    assert.deepEqual(part("rvc").help, ["model_catalog.group_help.rvc", "model_downloads.rvc_requirements"]);
    assert.equal(part("rvc").readout, `model_catalog.group_readout {"count":2,"obtained":2}`, "a ready download and a changed file of one's own");
    assert.deepEqual(part("diarization").help, ["model_catalog.group_help.diarization", "model_downloads.diarization_requirements"]);
    assert.equal(part("diarization").readout, `model_catalog.group_readout {"count":0,"obtained":0}`);
    assert.deepEqual(part("japanese").help, ["model_catalog.group_help.japanese", "model_downloads.choice_japanese"], "two voices to choose from");
    assert.deepEqual(part("multilingual").help, ["model_catalog.group_help.multilingual"], "one voice: nothing to choose");

    const vad = findIn(tree, node => node.type === "catalog-section" && node.props.id === "model-catalog-vad");
    const ownCards = findIn(vad, node => node.type === "user-model-cards").props;
    assert.deepEqual([ownCards.target, ownCards.expected, ownCards.blocked, ownCards.busy, ownCards.layout, ownCards.audition],
        ["vad", { vad: { model: "/mine.gguf" } }, "edited", false, "list", null]);
    assert.deepEqual(findIn(vad, node => node.type === "user-model-registration").props, { target: "vad", busy: false });
    assert.equal(findIn(vad, node => node.type === "catalog-list").props.layout, "list");
    // The translation review asks about one model: the part is not folded.
    assert.equal(findIn(p.draw({ targets: ["asr"], only: ["moon"] }), node => node.type === "catalog-section").props.fold, false);
});

test("a model of several files offers them by type, size and state, and says when the user chose another than the suggested one", async context => {
    const rows = [model("whisper-q8", { name: "Whisper · Q8_0", total_bytes: 2 * GiB, guidance: checked(GiB), profile: { summary: "whisper", recommended_for: ["ja", "en"], tier: null, cpu: "absent", gpu: "absent" },
        speech: { name: "whisper", label: "Whisper", type: "q8_0", default: true } }),
    model("whisper-q4", { name: "Whisper · Q4_K", speech: { name: "whisper", label: "Whisper", type: "q4_k", default: false }, profile: { memory_bytes: 7 * GiB, summary: "whisper", recommended_for: ["ko"], cpu: "absent", gpu: "absent" } })];
    const p = await catalogPage(context, { catalog: catalogOf(rows), hardware: readyHardware([gpu("GPU0", 6 * GiB, 8 * GiB)]),
        state: { observation_id: "1", jobs: {}, downloaded: { "whisper-q8": { model: "/q8.gguf" } } } });
    let tree = p.draw({ targets: ["asr"], expected: { asr: { model: "/other.gguf" } } });
    let card = cardNamed(tree, "Whisper");
    const select = findIn(card, node => node.type === kitStandIns.Select);
    assert.equal(select.props["aria-label"], `model_catalog.variant_of {"model":"Whisper"}`);
    assert.equal([findIn(card, node => node.type === "label").props.children].flat()[0], "model_catalog.variant");
    // The suggested file is shown first. The other is too heavy for an 8 GiB GPU: its option says so.
    assert.equal(select.props.value, "whisper-q8");
    assert.deepEqual(texts(select, kitStandIns.SelectOption), ["Q8_0 · 2.00 GiB · model_downloads.asr_type_default · model_catalog.status.downloaded",
        "Q4_K · 1.00 GiB · model_catalog.hardware_warning.option"]);
    assert.deepEqual(ofType(select, kitStandIns.SelectOption).map(option => option.props.value), ["whisper-q8", "whisper-q4"]);
    // D-14 (decided on 2026-11-25): the choice of the file is the kit's Select; the card draws no list of its own.
    assert.deepEqual([...ofType(card, "select"), ...ofType(card, "option")], []);
    assert.deepEqual([card.props.tabIndex, card.props.role, card.props["data-status"]], [-1, "group", "downloaded"]);
    // Whom the model is for, from all its files; that it fits; its summary.
    assert.deepEqual(accentBadges(card),
        [`model_catalog.recommended_for {"languages":"Japanese, English, and Korean"}`, "model_catalog.fits_memory"]);
    // What the model is: the card's description.
    assert.deepEqual(texts(card, kitStandIns.CardDescription), ["model_downloads.summary.whisper"]);
    assert.equal(texts(card, "p").includes("model_downloads.manual_choice"), false, "the suggested file is not a choice the user made");
    assert.equal(named(card, "WarningBadge").length, 0);

    select.props.onChange({ target: { value: "whisper-q4" } });
    tree = p.draw();
    card = cardNamed(tree, "Whisper");
    assert.equal(findIn(card, node => node.type === kitStandIns.Select).props.value, "whisper-q4");
    assert.ok(texts(card, "p").includes("model_downloads.manual_choice"));
    // The file shown is too heavy: a mark on the head, and the note under it in the list.
    assert.equal(named(card, "WarningBadge").length, 1);
    assert.equal(named(card, "WarningNote").length, 1);
    assert.equal(card.props["data-status"], "not_downloaded");
    findIn(card, node => node.type === kitStandIns.Select).props.onChange({ target: { value: "whisper-q8" } });
    assert.equal(texts(cardNamed(p.draw(), "Whisper"), "p").includes("model_downloads.manual_choice"), false, "back on the suggested file");
});

test("a model of one file names its type unless the name is the type, and a grid card keeps its details in its fold", async context => {
    const rows = [model("moon", { name: "Moon · F16", profile: { summary: "moon", recommended_for: ["ja", "en"], cpu: "absent", gpu: "absent" } }),
        model("plain", { name: "Plain", profile: { summary: "plain", recommended_for: ["ja"], cpu: "absent", gpu: "absent" } }),
        model("heavy", { name: "Heavy · F32", profile: { summary: "heavy", recommended_for: [], memory_bytes: 9 * GiB, cpu: "absent", gpu: "absent" } })];
    const hardware = readyHardware([gpu("GPU0", 6 * GiB, 8 * GiB)]);
    const list = await catalogPage(context, { catalog: catalogOf(rows), hardware });
    let tree = list.draw();
    const variant = variantLines;
    assert.deepEqual(variant(cardNamed(tree, "Moon")), [["model_catalog.variant", "F16"]]);
    assert.deepEqual(variant(cardNamed(tree, "Plain")), []);
    assert.equal(find(cardNamed(tree, "Moon"), node => node.type === kitStandIns.Select), null);
    // In the list: the warning note under the name, and the facts beside the file.
    assert.equal(named(cardNamed(tree, "Heavy"), "WarningNote").length, 1);
    assert.deepEqual(named(cardNamed(tree, "Moon"), "ModelFacts").map(node => node.props.part), [undefined]);
    assert.equal(find(cardNamed(tree, "Moon"), node => node.type === "catalog-facts"), null);

    const grid = await catalogPage(context, { catalog: catalogOf(rows), hardware }, { layout: "grid" });
    tree = grid.draw();
    const moon = cardNamed(tree, "Moon");
    // Two languages are a count in the grid's short badge; one is named.
    assert.deepEqual(accentBadges(moon), [`model_catalog.recommended_for_count {"count":2}`]);
    assert.deepEqual(accentBadges(cardNamed(tree, "Plain")), [`model_catalog.recommended_for {"languages":"Japanese"}`]);
    assert.deepEqual(named(moon, "ModelFacts").map(node => node.props.part), ["key", "rest"]);
    assert.equal(findIn(moon, node => node.type === "catalog-facts").props.summary, `model_catalog.layout.facts_of {"file":"F16"}`);
    assert.equal(findIn(cardNamed(tree, "Plain"), node => node.type === "catalog-facts").props.summary, undefined);
    // The warning: its mark on the head, its note in the fold.
    const heavy = cardNamed(tree, "Heavy");
    assert.equal(named(heavy, "WarningBadge").length, 1);
    const facts = findIn(heavy, node => node.type === "catalog-facts");
    assert.equal(named(facts, "WarningNote").length, 1);
    assert.equal(named(heavy, "WarningNote").length, 1, "only in the fold");
});

test("a model suggested for many languages names three and counts the rest", async context => {
    const p = await catalogPage(context, { catalog: catalogOf([model("many", { name: "Many · F16", profile: { summary: "many", recommended_for: ["ja", "en", "ko", "fr", "de"], cpu: "absent", gpu: "absent" } })]) });
    assert.deepEqual(accentBadges(cardNamed(p.draw(), "Many")),
        [`model_catalog.recommended_for {"languages":"model_catalog.languages_more {\\"languages\\":\\"Japanese, English, and Korean\\",\\"count\\":2}"}`]);
});

test("the facts list the languages, the size, the hardware, the memory a translation needs and the terms, by the part asked for", async context => {
    const p = await catalogPage(context, { catalog: catalogOf([model("x")]) });
    const tree = p.draw();
    const facts = (entry: Row, extra: Record<string, unknown> = {}) => {
        const drawn = drawPart(tree, "ModelFacts", { entry, ...extra });
        return ofType(drawn, "div").map(row => [textOf(findIn(row, node => node.type === "dt")), textOf(findIn(row, node => node.type === "dd"))]);
    };
    const profile = { languages: ["ja", "en"], tier: "heavy", memory_bytes: 3 * GiB, memory_measured_on: "RTX 4070", cpu: "slow", gpu: "recommended", summary: "x", recommended_for: [] };
    const full = model("x", { total_bytes: 2 * GiB, profile, provider: "Maker", license: "Apache-2.0" });
    assert.deepEqual(facts(full), [
        ["model_catalog.languages", "Japanese and English"],
        ["model_catalog.size", "2.00 GiB"],
        // How heavy and how it runs; the measured memory and where are the term's hint (#1266, A-6).
        ["model_catalog.hardware", "model_catalog.tier.heavy · model_catalog.cpu.slow · model_catalog.gpu.recommended"],
        ["model_catalog.terms", "Maker · Apache-2.0"],
    ]);
    assert.deepEqual(facts(full, { part: "key" }).map(row => row[0]), ["model_catalog.size", "model_catalog.hardware"]);
    assert.deepEqual(facts(full, { part: "rest" }).map(row => row[0]), ["model_catalog.languages", "model_catalog.terms"]);
    // Words the locale does not have for a CPU or GPU mark, and no tier or figure: no hardware row.
    assert.deepEqual(facts(model("x", { profile: { ...profile, tier: null, memory_bytes: null, cpu: "absent", gpu: "absent" } })).map(row => row[0]),
        ["model_catalog.languages", "model_catalog.size", "model_catalog.terms"]);
    assert.equal(facts(model("x", { profile: { ...profile, tier: null, memory_bytes: Number.NaN, cpu: "fast", gpu: "absent" } }))[2][1], "model_catalog.cpu.fast");
    // A file under 0.01 GiB in MiB. Without a profile, the speech engine's languages; without either, none.
    assert.deepEqual(facts(model("x", { total_bytes: 5 * 1048576, speech: { name: "x", label: "X", type: "f16", default: false, languages: ["ko"] } })),
        [["model_catalog.languages", "Korean"], ["model_catalog.size", "5.0 MiB"], ["model_catalog.terms", "Maker · MIT"]]);
    assert.equal(facts(model("x", { total_bytes: 0.01 * GiB }))[0][1], "0.01 GiB");
    assert.deepEqual(facts(model("x")).map(row => row[0]), ["model_catalog.size", "model_catalog.terms"]);
    // Thirteen languages: the first twelve and how many more.
    const codes = ["ja", "en", "ko", "fr", "de", "es", "it", "pt", "ru", "zh", "ar", "hi", "th"];
    const many = facts(model("x", { profile: { ...profile, languages: codes } }))[0][1];
    assert.match(many, /^model_catalog\.languages_more \{"languages":"Japanese, English, .*, and Hindi","count":1\}$/);
    // A translation model says the memory it needs while translating, or that it was not measured.
    assert.deepEqual(facts(model("x", { target: "translation", guidance: { reference_memory_bytes: 2 * GiB } }), { part: "key" }),
        [["model_catalog.size", "1.00 GiB"], ["model_catalog.memory_needed", `model_catalog.translation_memory {"memory":"2.00 GiB"}`]]);
    assert.deepEqual(facts(model("x", { target: "translation" }), { part: "key" })[1], ["model_catalog.memory_needed", "model_catalog.translation_memory_unknown"]);
    assert.deepEqual(facts(model("x", { target: "translation", guidance: { reference_memory_bytes: "2" } }), { part: "rest" }).map(row => row[0]), ["model_catalog.terms"]);

    // The measured memory as the hardware term's hint, one line each.
    const hinted = drawPart(tree, "ModelFacts", { entry: full, guidance: ["one", "two"], part: "key" });
    const hint = findIn(hinted, node => node.type === "hint").props;
    assert.deepEqual([hint.text, hint.focusable], ["one\ntwo", true]);
    assert.equal(textOf(findIn(hinted, node => node.props?.["data-hint-host"] === true)), "model_catalog.hardware");
    assert.equal(find(drawPart(tree, "ModelFacts", { entry: full, guidance: [] }), node => node.type === "hint"), null);
    // Its own look, and a part's beside it.
    assert.equal(classesOf(drawPart(tree, "ModelFacts", { entry: full })).length, 1);
    const both = classesOf(drawPart(tree, "ModelFacts", { entry: full, className: "given" }));
    assert.deepEqual([both.length, both.at(-1)], [2, "given"]);
});

test("the languages are named in the UI's language, and in English when the UI has none", async context => {
    const row = model("x", { profile: { languages: ["ja", "en"], cpu: "absent", gpu: "absent", summary: "x", recommended_for: [] } });
    const languagesOf = async (i18n: PageOptions["i18n"]) => {
        const p = await catalogPage(context, { catalog: catalogOf([row]) }, { i18n });
        const tree = p.draw();
        return textOf(findIn(drawPart(tree, "ModelFacts", { entry: row }), node => node.type === "dd"));
    };
    assert.equal(await languagesOf({ language: "ja" }), "日本語、英語");
    assert.equal(await languagesOf(null), "Japanese and English");
    assert.equal(await languagesOf({}), "Japanese and English");
    // A UI language the list formatter does not take: the names joined with commas.
    const names = languageNames.createLanguageNames("x");
    assert.equal(await languagesOf({ language: "x" }), [names.fromCode("ja", "ja"), names.fromCode("en", "en")].join(", "));
});

test("a card's state badge says the state of the file shown", async context => {
    const p = await catalogPage(context, { catalog: catalogOf([model("x")]) });
    const tree = p.draw();
    // The catalogs' state badge (catalogLayout.tsx's CatalogState), which draws each state's look.
    for (const status of ["working", "ready", "in_use", "downloaded", "not_downloaded"]) {
        const badge = drawPart(tree, "StatusBadge", { status });
        assert.deepEqual([badge.type, badge.props.state, textOf(badge)], ["catalog-state", status, `model_catalog.status.${status}`], status);
    }
});

test("a hardware warning says why the model may be too heavy, on the GPU or in the RAM", async context => {
    const p = await catalogPage(context, { catalog: catalogOf([model("x", { profile: { memory_bytes: 99 * GiB, summary: "x", recommended_for: [], cpu: "absent", gpu: "absent" } })]),
        hardware: readyHardware([gpu("GPU0", GiB, 2 * GiB)]) });
    const tree = p.draw();
    const badge = drawPart(tree, "WarningBadge", {});
    // The kit's Badge in amber with the "!" mark, which it hides from assistive technology (kitParts.test.ts).
    assert.deepEqual([badge.type, badge.props.tone, badge.props.variant, badge.props.mark, textOf(badge)],
        [kitStandIns.Badge, "warning", undefined, "alert", "model_catalog.hardware_warning.badge"]);
    const note = (warning: object) => textOf(drawPart(tree, "WarningNote", { warning }));
    const reason = (key: string, values: object) => `model_catalog.hardware_warning.note ${JSON.stringify({ reason: `model_catalog.hardware_warning.${key} ${JSON.stringify(values)}` })}`;
    assert.equal(note({ reason: "low_memory", required: 3 * GiB, available: 2 * GiB, reserve: GiB, device: { kind: "gpu" } }),
        reason("low_memory_gpu", { required: "3.00 GiB", available: "2.00 GiB", reserve: "1.00 GiB" }));
    assert.equal(note({ reason: "low_memory", required: 3 * GiB, available: 2 * GiB, reserve: GiB, device: { kind: "cpu" } }),
        reason("low_memory_cpu", { required: "3.00 GiB", available: "2.00 GiB", reserve: "1.00 GiB" }));
    assert.equal(note({ reason: "low_memory", required: null, available: null, reserve: null, device: null }),
        reason("low_memory_gpu", { required: "0.00 GiB", available: "0.00 GiB", reserve: "0.00 GiB" }));
    assert.equal(note({ reason: "no_gpu", required: GiB, available: null, reserve: null, device: null }),
        reason("no_gpu", { required: "1.00 GiB", available: "0.00 GiB", reserve: "0.00 GiB" }));
    assert.equal(note({ reason: "cpu_setting", required: null, available: null, reserve: null, device: { kind: "cpu" } }),
        reason("cpu_setting", { required: "0.00 GiB", available: "0.00 GiB", reserve: "0.00 GiB" }));
});

// The cards' jobs: [phase, tone, progress, the readout's words].
test("a download's readout follows its phase, with its progress, its error and the step it waits for", async context => {
    const row = model("m", { name: "Model · Q8_0", speech: { name: "m", label: "Model", type: "q8_0", default: true } });
    const p = await catalogPage(context, { catalog: catalogOf([row]) });
    const view = (job: Job, extra: Partial<Downloads> = {}, props: object = {}) => {
        Object.assign(p.downloads, { state: { observation_id: "1", jobs: { m: job } }, pending: null }, extra);
        const card = cardNamed(p.draw({ targets: ["asr"], expected: { asr: { model: "/m.gguf" } }, blocked: false, ...props }), "Model");
        const readout = findIn(card, node => node.type === "readout");
        const progress = find(card, node => node.type === kitStandIns.Progress);
        return { card, tone: readout.props.tone, progress: readout.props.progress, words: textOf(readout),
            bar: progress && [progress.props["aria-label"], progress.props.value, progress.props.max], alerts: texts(card, "p").filter((_, i) => ofType(card, "p")[i].props.role === "alert"),
            buttons: ofType(card, "button").map(node => [textOf(node), node.props.disabled, node.props.className]), notes: texts(card, "p") };
    };
    const half = { job_id: "j1", received_bytes: GiB / 2, total_bytes: GiB };
    for (const phase of ["queued", "downloading", "verifying"]) {
        const shown = view({ ...half, phase });
        assert.deepEqual([shown.tone, shown.progress, shown.words, shown.bar], ["neutral", "working", `model_downloads.phase_${phase} · 0.50 GiB / 1.00 GiB`,
            ["model_downloads.progress", GiB / 2, GiB]], phase);
        assert.deepEqual(shown.buttons, [["model_downloads.cancel", false, undefined], ["model_downloads.review", true, undefined]], phase);
    }
    const cancelling = view({ ...half, phase: "cancelling" });
    assert.deepEqual([cancelling.progress, cancelling.words, cancelling.buttons[0]], [undefined, "model_downloads.phase_cancelling · 0.50 GiB / 1.00 GiB",
        ["model_downloads.cancel", true, undefined]]);
    // Cancel stays open while the only request waiting is this download's Apply.
    assert.equal(view({ ...half, phase: "verifying" }, { pending: [{ endpoint: "/run/apply_model_download", id: "m", job_id: "j1" }] }).buttons[0][1], false);
    for (const other of [{ endpoint: "/run/start_model_download", id: "m", job_id: "j1" }, { endpoint: "/run/apply_model_download", id: "n", job_id: "j1" },
        { endpoint: "/run/apply_model_download", id: "m", job_id: "j0" }]) {
        assert.equal(view({ ...half, phase: "verifying" }, { pending: [other] }).buttons[0][1], true, JSON.stringify(other));
    }
    view({ ...half, phase: "downloading" }).card;
    buttonNamed(cardNamed(p.draw(), "Model"), "model_downloads.cancel").props.onClick();
    assert.deepEqual(p.sent.at(-1), ["/run/cancel_model_download", { id: "m", job_id: "j1" }]);

    const ready = view({ job_id: "j2", phase: "ready", received_bytes: GiB, total_bytes: GiB });
    assert.deepEqual([ready.tone, ready.progress, ready.words, ready.bar], ["active", "done", "model_downloads.phase_ready", null]);
    assert.ok(ready.notes.includes("model_downloads.apply_hint"));
    assert.deepEqual(ready.buttons[0], ["model_downloads.apply", false, "primary"]);
    buttonNamed(ready.card, "model_downloads.apply").props.onClick();
    assert.deepEqual(p.sent.at(-1), ["/run/apply_model_download", { id: "m", job_id: "j2", expected: { model: "/m.gguf" } }]);
    // Apply waits while another download runs, while the page is busy or edited, and without the saved paths it replaces.
    assert.equal(view({ job_id: "j2", phase: "ready" }, { pending: [{ endpoint: "/run/start_model_download", id: "x", job_id: null }] }).buttons[0][1], true);
    assert.equal(view({ job_id: "j2", phase: "ready" }, {}, { expected: {} }).buttons[0][1], true);
    const busy = view({ job_id: "j2", phase: "ready" }, {}, { blocked: "busy" });
    assert.equal(busy.buttons[0][1], true);
    assert.ok(busy.notes.includes("model_downloads.blocked"));
    assert.ok(view({ job_id: "j2", phase: "ready" }, {}, { blocked: "edited" }).notes.includes("model_downloads.blocked_edited"));
    assert.equal(view({ job_id: "j2", phase: "ready" }).notes.some(note => note.startsWith("model_downloads.blocked")), false);
    assert.equal(view({ ...half, phase: "downloading" }, {}, { blocked: "busy" }).notes.some(note => note.startsWith("model_downloads.blocked")), false);

    const failed = view({ job_id: "j3", phase: "failed", error_code: "disk_full", received_bytes: 0, total_bytes: GiB });
    assert.deepEqual([failed.tone, failed.progress, failed.words, failed.bar, failed.alerts], ["failed", undefined, "model_downloads.phase_failed", null, ["model_downloads.errors.disk_full"]]);
    // A failed download is reviewed again, pressed anywhere on its card (#1254).
    assert.deepEqual(failed.buttons, [["model_downloads.review", false, "press"]], "no actions of the job");
    assert.deepEqual(view({ job_id: "j3", phase: "failed", error_code: "absent_reason" }).alerts, ["model_downloads.errors.download_failed"]);
    const applied = view({ job_id: "j4", phase: "applied", paths: { model: "/m.gguf" } });
    assert.deepEqual([applied.tone, applied.progress, applied.alerts], ["neutral", "done", []]);
});

test("a download of another file of the model stays in sight, named, while it runs or waits for Apply", async context => {
    const rows = [model("m-q8", { name: "Model · Q8_0", speech: { name: "m", label: "Model", type: "q8_0", default: true } }),
        model("m-q4", { name: "Model · Q4_K", speech: { name: "m", label: "Model", type: "q4_k", default: false } }),
        model("m-q2", { name: "Model · Q2_K", speech: { name: "m", label: "Model", type: "q2_k", default: false } })];
    const p = await catalogPage(context, { catalog: catalogOf(rows), state: { observation_id: "1", jobs: {
        "m-q4": { job_id: "a", phase: "downloading", received_bytes: GiB / 4, total_bytes: GiB }, "m-q2": { job_id: "b", phase: "failed", error_code: "disk_full" } } } });
    let card = cardNamed(p.draw(), "Model");
    assert.equal(findIn(card, node => node.type === kitStandIns.Select).props.value, "m-q8");
    assert.deepEqual(texts(card, "readout"), ["Model · Q4_K: model_downloads.phase_downloading · 0.25 GiB / 1.00 GiB"]);
    p.downloads.state = { observation_id: "2", jobs: { "m-q4": { job_id: "a", phase: "ready" }, "m-q8": { job_id: "c", phase: "applied" } } };
    card = cardNamed(p.draw(), "Model");
    assert.deepEqual(texts(card, "readout"), ["model_downloads.phase_applied", "Model · Q4_K: model_downloads.phase_ready"]);
});

test("a card offers a download's review, or the use of a model on the PC, and nothing for a model ready to use", async context => {
    const rows = [model("new", { name: "New" }), model("here", { name: "Here" }), model("used", { name: "Used" }),
        model("tr", { target: "translation", name: "Tr" }), model("tr-usable", { target: "translation", name: "Tr usable" })];
    const p = await catalogPage(context, { catalog: catalogOf(rows), state: { observation_id: "1", jobs: {},
        downloaded: { here: { model: "/here.gguf" }, used: { model: "/used.gguf" }, tr: { model: "/tr" }, "tr-usable": { model: "/tru" } } } });
    const tree = p.draw({ targets: ["asr", "translation"], expected: { asr: { model: "/used.gguf" } }, usable: ["tr-usable"], audition: { values: { pitch: 1 }, input: "mic" } as never });
    const buttons = (label: string) => texts(cardNamed(tree, label), "button");
    assert.deepEqual(buttons("New"), ["model_downloads.review"]);
    assert.deepEqual(buttons("Here"), ["model_catalog.use"]);
    assert.deepEqual(buttons("Used"), []);
    assert.deepEqual(buttons("Tr"), ["model_catalog.use"], "a translation model on the PC that the core does not count yet");
    assert.deepEqual(buttons("Tr usable"), []);
    assert.ok(texts(cardNamed(tree, "Here"), "p").includes("model_catalog.use_hint"));
    assert.equal(texts(cardNamed(tree, "New"), "p").includes("model_catalog.use_hint"), false);
    assert.equal(texts(cardNamed(tree, "Used"), "p").includes("model_catalog.use_hint"), false);
    const audition = findIn(cardNamed(tree, "Here"), node => node.type === "audition-button").props;
    assert.deepEqual([audition.target, audition.status, audition.entry, audition.values, audition.input], ["asr", "downloaded", "here", { pitch: 1 }, "mic"]);
    const note = findIn(cardNamed(tree, "Here"), node => node.type === "audition-note").props;
    assert.deepEqual([note.target, note.status, note.entry, note.values, note.input], ["asr", "downloaded", "here", { pitch: 1 }, "mic"]);
});

test("a download in any phase keeps every review closed until it ends", async context => {
    const rows = [model("a", { name: "A" }), model("b", { name: "B" })];
    for (const [phase, busy] of [["queued", true], ["downloading", true], ["verifying", true], ["cancelling", true], ["ready", false], ["failed", false]] as const) {
        const p = await catalogPage(context, { catalog: catalogOf(rows), state: { observation_id: "1", jobs: { b: { job_id: "j", phase } } } });
        assert.equal(buttonNamed(cardNamed(p.draw(), "A"), "model_downloads.review").props.disabled, busy, phase);
    }
});

// #1266 (A-6): the memory speech.cpp measured for a file, and on what, is the hardware term's hint on
// a page that keeps descriptions out of sight, and the card's fold elsewhere, never the value.
test("a file's measured memory and where it was measured go to the hardware's hint or the card's fold", async context => {
    const profile = { languages: ["ja"], tier: "medium", memory_bytes: 3 * GiB, memory_measured_on: "RTX 4070", cpu: "slow", gpu: "recommended", summary: "x", recommended_for: [] };
    const memory = `model_catalog.memory {"memory":"3.00 GiB","device":"RTX 4070"}`;
    const hinted = await catalogPage(context, { catalog: catalogOf([model("m", { name: "M", profile })]) }, { hints: true });
    const facts = named(cardNamed(hinted.draw(), "M"), "ModelFacts").map(node => node.props.guidance);
    assert.ok(facts.some(lines => JSON.stringify(lines) === JSON.stringify([memory])), "the hint's line");
    const plain = await catalogPage(context, { catalog: catalogOf([model("m", { name: "M", profile })]) });
    const fold = findIn(cardNamed(plain.draw(), "M"), node => node.type === "fold");
    assert.deepEqual([fold.props.summary, ...texts(fold, "p")], ["model_downloads.guidance_summary", memory]);
    // Without a figure, no line and no fold.
    const none = await catalogPage(context, { catalog: catalogOf([model("m", { name: "M", profile: { ...profile, memory_bytes: null } })]) });
    assert.equal(find(cardNamed(none.draw(), "M"), node => node.type === "fold"), null);
});

test("a model's guidance lines say the measured memory, where it was checked and what the check covered", async context => {
    const row = (validation: Record<string, unknown>, bytes: unknown = 2 * GiB) => model("m", { name: "M · F16", target: "multilingual",
        guidance: { tier: "heavy", reference_memory_bytes: bytes, validation } });
    const linesOf = async (validation: Record<string, unknown>, options: { bytes?: unknown; missing?: string[]; device?: string } = {}) => {
        const p = await catalogPage(context, { catalog: catalogOf([row(validation, "bytes" in options ? options.bytes : 2 * GiB)]),
            hardware: readyHardware([gpu("GPU0", GiB, 16 * GiB, options.device ?? "RTX")]) },
            { missing: options.missing });
        const fold = findIn(cardNamed(p.draw({ targets: ["multilingual"], reserve: "vr" }), "M"), node => node.type === "fold");
        return [fold.props.summary, ...texts(fold, "p")];
    };
    assert.deepEqual(await linesOf({ state: "passed", device: "RTX", scope: "speech" }), ["model_downloads.guidance_summary",
        "model_downloads.tier_heavy · model_downloads.memory_reference_heavy: 2.00 GiB", "model_downloads.validation_passed_heavy RTX", "model_downloads.scope_speech"]);
    // The tier's own words where the locale has them, else the general ones; a GPU other than the one checked says so.
    assert.deepEqual(await linesOf({ state: "passed", device: "RTX" }, { missing: ["model_downloads.memory_reference_heavy", "model_downloads.validation_passed_heavy"], device: "Other" }),
        ["model_downloads.guidance_summary", "model_downloads.tier_heavy · model_downloads.memory_reference: 2.00 GiB", "model_downloads.validation_passed RTX",
            "model_downloads.gpu_unverified"]);
    // Not measured: where it was checked alone, under its own summary.
    assert.deepEqual(await linesOf({ state: "pending" }, { bytes: null }), ["model_downloads.validation_summary", "model_downloads.validation_pending_heavy"]);
});

test("the review shows what the download is, where it goes and what it needs, and starts only once everything is ticked", async context => {
    const row = model("m", { name: "Model · Q8_0", target: "asr", restrictions: ["non_commercial", "gemma_terms"], license: "CC-BY-NC-4.0",
        artifacts: [{ filename: "model.gguf", size: GiB }, { filename: "vocab.json", size: 2048 }] });
    const p = await catalogPage(context, { catalog: catalogOf([row]) });
    buttonNamed(p.draw(), "model_downloads.review").props.onClick();
    let tree = p.draw();
    let dialog = findIn(tree, isDialog);
    // Shown while a model is under review, named by its title alone, as before (D-43).
    assert.deepEqual([dialog.props.ref, dialog.props.open, "aria-describedby" in dialog.props, dialog.props["aria-describedby"]], ["dialog", true, true, undefined]);
    assert.deepEqual(p.consent.asked.at(-1), { open: true, fallback: tree.props.ref }, "focus goes back to the catalog when it closes");
    assert.deepEqual(ofPart(dialog, kitStandIns.DialogTitle).map(textOf), ["model_downloads.warning_title"]);
    const header = findIn(dialog, node => node.type === kitStandIns.DialogHeader);
    const lines = texts(header, "p");
    // One line: the file, its license and its size (decided on 2026-11-27, #1266).
    assert.equal(lines[0], "Model · Q8_0 · CC-BY-NC-4.0 · 1.00 GiB");
    // The restriction notes are drawn by their own part, between these lines.
    // The VAD's sentence went (M-4): a recognition model takes the VAD with it where one is needed (#1266).
    assert.deepEqual(lines.slice(1, 3), ["model_downloads.notice_general", "model_downloads.connection_notice"]);
    // The provider, the pages, where it goes, each file's exact size and what the download does not
    // do are in the breakdown, closed (#1266).
    const fold = findIn(header, node => node.type === "fold");
    assert.deepEqual([fold.props.summary, fold.props.size, fold.props.open], ["model_downloads.breakdown", "link", undefined]);
    assert.deepEqual(texts(fold, "p"), [`model_downloads.provider {"provider":"Maker"}`, "model_downloads.source: org/repo",
        "model_downloads.license_links:  model_downloads.model_card  LICENSE-MIT  CC-BY-NC-4.0 (2) ", "model_downloads.destination: models/asr", "model_downloads.no_start"]);
    assert.deepEqual(lines.slice(3), texts(fold, "p"), "nothing else follows the breakdown");
    assert.deepEqual(texts(fold, "li"), [`model.gguf · model_downloads.exact_bytes {"bytes":"1,073,741,824"} (1.00 GiB)`,
        `vocab.json · model_downloads.exact_bytes {"bytes":"2,048"} (0.00 GiB)`]);
    assert.deepEqual(ofType(dialog, "code").map(node => [textOf(node), node.props.style]), [["models/asr", { overflowWrap: "anywhere" }]]);
    // Each restriction is a note, and a box of its own that points to it.
    const notes = named(dialog, "RestrictionNote").map(node => node.props);
    assert.deepEqual(notes.map(note => [note.kind, note.license]), [["non_commercial", "CC-BY-NC-4.0"], ["gemma_terms", "CC-BY-NC-4.0"]]);
    const boxes = () => ofType(findIn(p.draw(), isDialog), "input");
    assert.deepEqual(boxes().map(box => [box.props.type, box.props.checked, box.props["aria-describedby"]]),
        [["checkbox", false, undefined], ["checkbox", false, notes[0].id], ["checkbox", false, notes[1].id]]);
    assert.notEqual(notes[0].id, notes[1].id);
    assert.deepEqual(texts(dialog, "label"), ["model_downloads.consent", `model_downloads.restriction.non_commercial.acknowledge {"license":"CC-BY-NC-4.0"}`,
        `model_downloads.restriction.gemma_terms.acknowledge {"license":"CC-BY-NC-4.0"}`]);
    const start = () => buttonNamed(findIn(p.draw(), isDialog), "model_downloads.start");
    assert.deepEqual([start().props.disabled, start().props.tone], [true, "primary"]);
    start().props.onClick();
    assert.equal(p.sent.filter(call => call[0] === "/run/start_model_download").length, 0, "a press of the disabled button does nothing");
    boxes()[0].props.onChange({ target: { checked: true } });
    boxes()[1].props.onChange({ target: { checked: true } });
    assert.equal(start().props.disabled, true, "one restriction still to tick");
    boxes()[2].props.onChange({ target: { checked: true } });
    boxes()[1].props.onChange({ target: { checked: false } });
    assert.equal(start().props.disabled, true, "unticked again");
    boxes()[1].props.onChange({ target: { checked: true } });
    boxes()[1].props.onChange({ target: { checked: true } });
    assert.deepEqual(boxes().map(box => box.props.checked), [true, true, true]);
    assert.equal(start().props.disabled, false);
    // While another download runs, it waits.
    p.downloads.pending = [{ endpoint: "/run/cancel_model_download", id: "x", job_id: "y" }];
    assert.equal(start().props.disabled, true);
    start().props.onClick();
    assert.equal(p.sent.filter(call => call[0] === "/run/start_model_download").length, 0);
    p.downloads.pending = null;
    start().props.onClick();
    assert.deepEqual(p.sent.at(-1), ["/run/start_model_download", { id: "m", consent: true, catalog_version: "v7", acknowledged: ["non_commercial", "gemma_terms"] }]);
    assert.equal(p.consent.closed, 1);
    tree = p.draw();
    assert.equal(find(tree, isDialog), null);
    // Opened again, nothing is ticked.
    buttonNamed(tree, "model_downloads.review").props.onClick();
    dialog = findIn(p.draw(), isDialog);
    assert.deepEqual(boxes().map(box => box.props.checked), [false, false, false]);
    const back = buttonNamed(dialog, "model_downloads.back");
    assert.equal(back.props.autoFocus, true);
    back.props.onClick();
    assert.equal(find(p.draw(), isDialog), null);
    assert.equal(p.consent.closed, 2);
    buttonNamed(p.draw(), "model_downloads.review").props.onClick();
    // Escape: the kit's Dialog asks its owner to close it (Dialog.test.ts).
    findIn(p.draw(), isDialog).props.onOpenChange(false);
    assert.equal(find(p.draw(), isDialog), null, "Escape closes it too");
    assert.equal(p.consent.closed, 3);
});

// #1266 T-3: the translation review asks about one model; the press that opened it asked for its
// review, so the review opens at once rather than after a card's second 「取得内容を確認」.
test("a caller asking about one model of one file gets its review at once, once, and hears whether its download started", async context => {
    const row = model("t-int8", { name: "T · int8", target: "translation", notice: "general" });
    const asked = { targets: ["translation"], only: ["t-int8"], reviewAtOnce: true };
    const done: boolean[] = [];
    const back = await catalogPage(context, { catalog: catalogOf([row]) });
    back.draw({ ...asked, onReviewDone: started => { done.push(started); } });
    let dialog = findIn(back.draw(), isDialog, "the review, at once");
    assert.equal(texts(findIn(dialog, node => node.type === kitStandIns.DialogHeader), "p")[0], "T · int8 · MIT · 1.00 GiB");
    buttonNamed(dialog, "model_downloads.back").props.onClick();
    assert.equal(find(back.draw(), isDialog), null);
    assert.deepEqual(done, [false], "Back is told, so the caller closes too");
    assert.equal(find(back.draw(), isDialog), null, "not opened again");

    const start = await catalogPage(context, { catalog: catalogOf([row]) });
    done.length = 0;
    start.draw({ ...asked, onReviewDone: started => { done.push(started); } });
    dialog = findIn(start.draw(), isDialog);
    ofType(dialog, "input")[0].props.onChange({ target: { checked: true } });
    buttonNamed(findIn(start.draw(), isDialog), "model_downloads.start").props.onClick();
    assert.deepEqual([start.sent.filter(call => call[0] === "/run/start_model_download").length, done], [1, [true]]);
    assert.equal(find(start.draw(), isDialog), null);

    // The card stays first: a model of several files, where the file is chosen; one on the PC or
    // downloading; a caller that did not ask; a catalog of every model.
    const cases: [string, Partial<Downloads>, object][] = [
        ["several files", { catalog: catalogOf([row, model("t-f16", { name: "T · float16", target: "translation" })]) }, { only: ["t-int8", "t-f16"] }],
        ["on the PC", { catalog: catalogOf([row]), state: { observation_id: "1", jobs: {}, downloaded: { "t-int8": { model: "x" } } } }, {}],
        ["downloading", { catalog: catalogOf([row]), state: { observation_id: "1", jobs: { "t-int8": { job_id: "j", phase: "downloading" } } } }, {}],
        ["not asked", { catalog: catalogOf([row]) }, { reviewAtOnce: false }],
        ["every model", { catalog: catalogOf([row]) }, { only: undefined }],
    ];
    for (const [name, given, props] of cases) {
        const p = await catalogPage(context, given);
        p.draw({ ...asked, ...props });
        assert.equal(find(p.draw(), isDialog), null, name);
    }
});

test("a restriction the app has no words for is shown as another one, and keeps the download from starting", async context => {
    const p = await catalogPage(context, { catalog: catalogOf([model("m", { name: "M", restrictions: ["future_terms"] })]) });
    buttonNamed(p.draw(), "model_downloads.review").props.onClick();
    const dialog = findIn(p.draw(), isDialog);
    const [note] = named(dialog, "RestrictionNote");
    const drawn = componentOf(note)(note.props);
    assert.deepEqual([drawn.type, drawn.props.id], ["p", note.props.id]);
    assert.equal(textOf(drawn), `model_downloads.restriction.other.title model_downloads.restriction.other.note {"license":"MIT"}`);
    assert.equal(findIn(drawn, node => node.type === "span" && node.props["aria-hidden"] === "true").props.children, undefined);
    const known = componentOf(note)({ kind: "gemma_terms", license: "Gemma", id: "r" });
    assert.deepEqual(texts(known, "strong"), ["model_downloads.restriction.gemma_terms.title"]);
    assert.equal(textOf(known), `model_downloads.restriction.gemma_terms.title model_downloads.restriction.gemma_terms.note {"license":"Gemma"}`);
    // No box for it: the consent alone never starts the download.
    assert.equal(ofType(dialog, "input").length, 1);
    ofType(dialog, "input")[0].props.onChange({ target: { checked: true } });
    assert.equal(buttonNamed(findIn(p.draw(), isDialog), "model_downloads.start").props.disabled, true);
});

test("the review says what each use needs, and that the files come over the network", async context => {
    const rows = ["rvc", "vad", "diarization", "japanese"].map(target => model(target, { target, name: target, notice: "other" }));
    const p = await catalogPage(context, { catalog: catalogOf(rows), hardware: readyHardware([gpu("GPU0", GiB, GiB)]) });
    p.draw({ targets: ["rvc", "vad", "diarization", "japanese"], reserve: "vr" });
    const review = (label: string) => {
        buttonNamed(cardNamed(p.draw(), label), "model_downloads.review").props.onClick();
        const dialog = findIn(p.draw(), isDialog);
        const lines = texts(findIn(dialog, node => node.type === kitStandIns.DialogHeader), "p");
        buttonNamed(dialog, "model_downloads.back").props.onClick();
        return { lines, start: ofPart(dialog, kitStandIns.Button).map(textOf)[1] };
    };
    const rvc = review("rvc");
    assert.ok(rvc.lines.includes("model_downloads.rvc_requirements"));
    assert.ok(rvc.lines.includes("model_downloads.notice_other"));
    assert.equal(rvc.lines.some(line => /asr_requirements|vad_requirements|diarization_requirements/.test(line)), false);
    const vad = review("vad");
    assert.ok(vad.lines.includes("model_downloads.vad_requirements"));
    assert.ok(vad.lines.includes("model_downloads.connection_notice"));
    assert.equal(vad.start, "model_downloads.start");
    assert.ok(review("diarization").lines.includes("model_downloads.diarization_requirements"));
    const japanese = review("japanese");
    assert.equal(japanese.lines.some(line => line.endsWith("_requirements")), false);
    assert.equal(japanese.start, "model_downloads.start");
});

// #1266 (decided on 2026-11-27): a recognition model taken from the catalog takes the VAD with it
// while no VAD is set, as the first-run setup does: one review and one consent for both, the VAD's
// download after the recognition model's, and the VAD applied once it is ready.
const withVad = (downloaded: Record<string, Record<string, string>> = {}) => ({
    catalog: catalogOf([model("asr", { name: "ASR · Q8_0" }), model("vad", { target: "vad", name: "VAD · F32", total_bytes: 1258291, destination: "models/vad",
        artifacts: [{ filename: "vad.gguf", size: 1258291 }] })]),
    state: { observation_id: "1", jobs: {}, downloaded } });
const runsOf = (sent: unknown[][]) => sent.filter(([endpoint]) => typeof endpoint === "string" && endpoint.startsWith("/run/") && !endpoint.includes("hardware"));

test("a recognition model takes the VAD with it: one review, one consent, then the VAD's download, applied when ready", async context => {
    const p = await catalogPage(context, withVad());
    const props = { targets: ["asr", "vad"], expected: { asr: { model: "" }, vad: { model: "" } } };
    buttonNamed(cardNamed(p.draw(props), "ASR"), "model_downloads.review").props.onClick();
    const dialog = findIn(p.draw(), isDialog);
    const lines = texts(findIn(dialog, node => node.type === kitStandIns.DialogHeader), "p");
    assert.deepEqual(lines.slice(0, 3), ["ASR · Q8_0 · MIT · 1.00 GiB", "VAD · F32 · MIT · 1.2 MiB", "model_downloads.with_vad"]);
    const fold = findIn(dialog, node => node.type === "fold");
    assert.deepEqual(texts(fold, "strong"), ["ASR · Q8_0", "VAD · F32"], "the breakdown names each file");
    assert.equal(ofType(dialog, "input").length, 1, "one consent for both");
    ofType(dialog, "input")[0].props.onChange({ target: { checked: true } });
    buttonNamed(findIn(p.draw(), isDialog), "model_downloads.start").props.onClick();
    assert.deepEqual(runsOf(p.sent), [["/run/start_model_download", { id: "asr", consent: true, catalog_version: "v7" }]]);
    // The recognition model downloads; the VAD waits for it, one download at a time.
    p.downloads.state = { ...p.downloads.state, jobs: { asr: { job_id: "a1", phase: "downloading", received_bytes: 1, total_bytes: 2 } } };
    p.draw();
    assert.equal(runsOf(p.sent).length, 1);
    // Downloaded: the VAD's download starts with the consent given, and only once.
    p.downloads.state = { ...p.downloads.state, jobs: { asr: { job_id: "a1", phase: "ready", received_bytes: 2, total_bytes: 2 } } };
    p.draw(); p.draw();
    assert.deepEqual(runsOf(p.sent).slice(1), [["/run/start_model_download", { id: "vad", consent: true, catalog_version: "v7" }]]);
    // Its progress shows on the recognition model's card, where it was asked for.
    p.downloads.state = { ...p.downloads.state, jobs: { ...p.downloads.state.jobs, vad: { job_id: "v1", phase: "downloading", received_bytes: 1, total_bytes: 2 } } };
    assert.ok(texts(cardNamed(p.draw(), "ASR"), "p").some(line => line.startsWith("VAD · F32: model_downloads.phase_downloading")));
    // Ready: the VAD is applied with the path the page holds; the recognition model keeps its own Apply.
    p.downloads.state = { ...p.downloads.state, jobs: { ...p.downloads.state.jobs, vad: { job_id: "v1", phase: "ready", received_bytes: 2, total_bytes: 2 } } };
    p.draw(); p.draw();
    assert.deepEqual(runsOf(p.sent).slice(2), [["/run/apply_model_download", { id: "vad", job_id: "v1", expected: { model: "" } }]]);
});

test("a VAD on the PC is checked after the recognition model, a set one is left alone, and a stopped download takes none", async context => {
    const props = { targets: ["asr", "vad"], expected: { asr: { model: "" }, vad: { model: "" } } };
    const review = async (given: object, drawn: object = props) => {
        const p = await catalogPage(context, given);
        buttonNamed(cardNamed(p.draw(drawn), "ASR"), "model_downloads.review").props.onClick();
        const dialog = findIn(p.draw(), isDialog);
        ofType(dialog, "input")[0].props.onChange({ target: { checked: true } });
        buttonNamed(findIn(p.draw(), isDialog), "model_downloads.start").props.onClick();
        return { p, lines: texts(findIn(dialog, node => node.type === kitStandIns.DialogHeader), "p") };
    };
    // On the PC, not set: checked, not downloaded again.
    const onPc = await review(withVad({ vad: { model: "/vad.gguf" } }));
    assert.ok(onPc.lines.includes("VAD · F32 · MIT · 1.2 MiB"));
    onPc.p.downloads.state = { ...onPc.p.downloads.state, jobs: { asr: { job_id: "a1", phase: "ready", received_bytes: 2, total_bytes: 2 } } };
    onPc.p.draw(); onPc.p.draw();
    assert.deepEqual(runsOf(onPc.p.sent).slice(1), [["/run/check_model_download", { id: "vad", catalog_version: "v7" }]]);
    // A VAD set already: the review is the recognition model's alone.
    const set = await review(withVad(), { ...props, expected: { asr: { model: "" }, vad: { model: "/mine/vad.gguf" } } });
    assert.ok(!set.lines.some(line => line.startsWith("VAD")) && !set.lines.includes("model_downloads.with_vad"));
    // Stopped or failed: no VAD follows.
    const stopped = await review(withVad());
    stopped.p.downloads.state = { ...stopped.p.downloads.state, jobs: { asr: { job_id: "a1", phase: "cancelled", received_bytes: 1, total_bytes: 2 } } };
    stopped.p.draw(); stopped.p.draw();
    stopped.p.downloads.state = { ...stopped.p.downloads.state, jobs: { asr: { job_id: "a1", phase: "ready", received_bytes: 2, total_bytes: 2 } } };
    stopped.p.draw();
    assert.equal(runsOf(stopped.p.sent).length, 1, "only the recognition model's start");
});

// #1263: a model already on the PC is used from its card. Its files are checked, never downloaded,
// with no review or consent in between, and it is applied once the check is ready.
const onThePc = () => ({ catalog: catalogOf([model("here", { name: "Here" })]),
    state: { observation_id: "1", jobs: {}, downloaded: { here: { model: "/here.gguf" } } } });
const runs = (sent: unknown[][]) => sent.filter(([endpoint]) => typeof endpoint === "string" && endpoint.startsWith("/run/") && !endpoint.includes("hardware"));

test("a model on the PC is checked and applied from its card, with no review in between", async context => {
    const p = await catalogPage(context, onThePc());
    const use = buttonNamed(cardNamed(p.draw({ targets: ["asr"], expected: { asr: { model: "/old.gguf" } } }), "Here"), "model_catalog.use");
    assert.equal(use.props.className, "primary press", "pressed anywhere on its card (#1254)");
    use.props.onClick();
    assert.deepEqual(runs(p.sent), [["/run/check_model_download", { id: "here", catalog_version: "v7" }]]);
    assert.equal(find(p.draw(), isDialog), null, "no review");
    // Checking: nothing is applied yet.
    p.downloads.state = { ...p.downloads.state, jobs: { here: { job_id: "c1", phase: "verifying", received_bytes: 0, total_bytes: 1 } } };
    p.draw();
    assert.equal(runs(p.sent).length, 1);
    // Checked: applied at once, with the path the page holds, and only once.
    p.downloads.state = { ...p.downloads.state, jobs: { here: { job_id: "c1", phase: "ready", received_bytes: 1, total_bytes: 1, paths: { model: "/here.gguf" } } } };
    p.draw();
    p.draw();
    assert.deepEqual(runs(p.sent).slice(1), [["/run/apply_model_download", { id: "here", job_id: "c1", expected: { model: "/old.gguf" } }]]);
});

// #1254: a card's main action is pressed anywhere on it, as the built-in translation models' are
// (#1228): a model on the PC is used, one that is not has its download reviewed. The button that
// does it carries the hit area and names the model; the card in use, and one being downloaded or
// checked, have nothing to press.
test("a model's card is pressed anywhere for its main action, named with the model; in use, downloading or checked, it presses nothing", async context => {
    const p = await catalogPage(context, { catalog: catalogOf(["here", "away", "used", "fetching", "checked"].map(id => model(id, { name: id }))),
        state: { observation_id: "1", downloaded: { here: { model: "/here.gguf" }, used: { model: "/used.gguf" } }, jobs: {
            fetching: { job_id: "f1", phase: "downloading", received_bytes: 1, total_bytes: 2 },
            checked: { job_id: "c1", phase: "ready", received_bytes: 1, total_bytes: 1, paths: { model: "/checked.gguf" } } } } });
    const tree = p.draw({ targets: ["asr"], expected: { asr: { model: "/used.gguf" } } });
    const main = (id: string) => find(cardNamed(tree, id), node => node.type === "button"
        && ["model_catalog.use", "model_downloads.review"].includes(textOf(node)));
    const view = (id: string) => {
        const button = main(id);
        return [cardNamed(tree, id).props.className, button && [textOf(button), button.props.className, button.props["aria-label"]]];
    };
    const named = (key: string, name: string) => `${key} ${JSON.stringify({ name })}`;
    assert.deepEqual(view("here"), ["pressable", ["model_catalog.use", "primary press", named("model_catalog.use_named", "here")]]);
    assert.deepEqual(view("away"), ["pressable", ["model_downloads.review", "press", named("model_catalog.review_named", "away")]]);
    assert.deepEqual(view("used"), [undefined, null], "the card in use");
    assert.equal(view("fetching")[0], undefined, "a download runs: its readout's Cancel is what it offers");
    assert.equal(view("checked")[0], undefined, "checked: its readout's Apply is what it offers");
    for (const id of ["fetching", "checked"]) assert.notEqual((view(id)[1] as unknown[] | null)?.[1], "press", id);
});

test("a check that finds the files changed says so, applies nothing, and offers the download's review", async context => {
    const p = await catalogPage(context, onThePc());
    buttonNamed(cardNamed(p.draw({ targets: ["asr"], expected: { asr: { model: "" } } }), "Here"), "model_catalog.use").props.onClick();
    p.downloads.state = { ...p.downloads.state, jobs: { here: { job_id: "c1", phase: "failed", error_code: "model_files_changed", received_bytes: 0, total_bytes: 1 } } };
    const card = cardNamed(p.draw(), "Here");
    assert.ok(texts(card, "p").includes("model_downloads.errors.model_files_changed"));
    assert.deepEqual(runs(p.sent).map(([endpoint]) => endpoint), ["/run/check_model_download"]);
    // Getting the files again is a download: its review, with the consent.
    buttonNamed(card, "model_downloads.review").props.onClick();
    const dialog = findIn(p.draw(), isDialog);
    assert.ok(texts(findIn(dialog, node => node.type === kitStandIns.DialogHeader), "p").includes("model_downloads.connection_notice"));
    assert.equal(ofPart(dialog, kitStandIns.Button).map(textOf)[1], "model_downloads.start");
});

test("a model on the PC waits to be used while its field is edited, and a caller that goes on applies it itself", async context => {
    const edited = await catalogPage(context, onThePc());
    const card = cardNamed(edited.draw({ targets: ["asr"], expected: { asr: { model: "" } }, blocked: "edited" }), "Here");
    assert.equal(buttonNamed(card, "model_catalog.use").props.disabled, true);
    assert.ok(texts(card, "p").includes("model_downloads.blocked_edited"));
    // The recognition fix (#1232) waits for the model and applies it: the catalog checks it only.
    const started: string[] = [];
    const fix = await catalogPage(context, onThePc());
    buttonNamed(cardNamed(fix.draw({ targets: ["asr"], expected: { asr: { model: "" } }, onStart: id => { started.push(id); } }), "Here"),
        "model_catalog.use").props.onClick();
    fix.downloads.state = { ...fix.downloads.state, jobs: { here: { job_id: "c1", phase: "ready", received_bytes: 1, total_bytes: 1, paths: { model: "/here.gguf" } } } };
    fix.draw();
    assert.deepEqual(started, ["here"]);
    assert.deepEqual(runs(fix.sent).map(([endpoint]) => endpoint), ["/run/check_model_download"]);
});

test("the review warns about a model too heavy for the PC, and says nothing for one that fits", async context => {
    const rows = [model("big", { name: "Big", profile: { memory_bytes: 40 * GiB, summary: "big", recommended_for: [], cpu: "absent", gpu: "absent" } }), model("small", { name: "Small" })];
    const p = await catalogPage(context, { catalog: catalogOf(rows), hardware: readyHardware([gpu("GPU0", 4 * GiB, 8 * GiB)]) });
    const warningsIn = (label: string) => {
        buttonNamed(cardNamed(p.draw(), label), "model_downloads.review").props.onClick();
        const dialog = findIn(p.draw(), isDialog);
        buttonNamed(dialog, "model_downloads.back").props.onClick();
        return named(dialog, "WarningNote").map(node => node.props.warning.reason);
    };
    assert.deepEqual(warningsIn("Big"), ["low_memory"]);
    assert.deepEqual(warningsIn("Small"), []);
});

test("the review's links open in the system browser in the app, and one that fails to open is shown to copy", async context => {
    const row = model("m", { name: "M" });
    const links = async (options: PageOptions) => {
        const p = await catalogPage(context, { catalog: catalogOf([row]) }, options);
        buttonNamed(p.draw(), "model_downloads.review").props.onClick();
        const anchors = ofType(findIn(p.draw(), isDialog), "a");
        assert.deepEqual(anchors.map(a => [a.props.href, a.props.target, a.props.rel]), [["https://example.com/source", "_blank", "noreferrer"],
            ...row.licenses as string[]].map(item => Array.isArray(item) ? item : [item, "_blank", "noreferrer"]));
        return { p, click: async (i: number) => {
            let prevented = 0;
            await ofType(findIn(p.draw(), isDialog), "a")[i].props.onClick({ preventDefault: () => { prevented++; } });
            const alert = find(findIn(p.draw(), isDialog), node => node.props?.role === "alert");
            return { prevented, alert: alert && [texts(alert, "p"), ofType(alert, "code").map(code => [textOf(code), code.props.style])] };
        } };
    };
    const browser = await links({ tauri: false });
    assert.deepEqual(await browser.click(0), { prevented: 0, alert: null });
    assert.deepEqual(browser.p.opened, []);
    const app = await links({ tauri: true });
    assert.deepEqual(await app.click(0), { prevented: 1, alert: null });
    assert.deepEqual(await app.click(2), { prevented: 1, alert: null });
    assert.deepEqual(app.p.opened, ["https://example.com/source", "https://huggingface.co/org/repo/blob/main/LICENSE-MIT"]);

    let fail = true;
    const failing = await links({ tauri: true, openUrl: async (url: string) => { if (fail) throw new Error(url); } });
    assert.deepEqual(await failing.click(1), { prevented: 1, alert: [["model_downloads.link_error"], [["https://example.com/card", { overflowWrap: "anywhere" }]]] });
    fail = false;
    assert.deepEqual(await failing.click(3), { prevented: 1, alert: null }, "a link that opens clears the error");
    fail = true;
    await failing.click(1);
    buttonNamed(findIn(failing.p.draw(), isDialog), "model_downloads.back").props.onClick();
    buttonNamed(failing.p.draw(), "model_downloads.review").props.onClick();
    assert.equal(find(findIn(failing.p.draw(), isDialog), node => node.props?.role === "alert"), null, "closing clears it too");
});

test("an error of the downloads or of the models of one's own is said in their words, or as a failed download", async context => {
    const p = await catalogPage(context, { catalog: catalogOf([]) }, { missing: ["user_models.errors.disk_full"] });
    assert.deepEqual(texts(p.draw(), "p"), []);
    const alert = (error: string) => {
        p.downloads.error = error;
        const node = findIn(p.draw(), item => item.props?.role === "alert");
        return textOf(node);
    };
    assert.equal(alert("name_long"), "user_models.errors.name_long");
    assert.equal(alert("disk_full"), "model_downloads.errors.disk_full");
    assert.equal(alert("absent_code"), "model_downloads.errors.download_failed");
});

test("the local translation's models are warned about on the device the translation uses, not the speech engine's", async context => {
    const row = model("nllb", { target: "translation", name: "NLLB", profile: { memory_bytes: 6 * GiB, summary: "nllb", recommended_for: [], cpu: "absent", gpu: "absent" } });
    const hardware = readyHardware([{ name: "CPU", kind: "cpu", memory_total: 16 * GiB, memory_free: 8 * GiB }, gpu("GPU0", 2 * GiB, 4 * GiB, "NVIDIA RTX")]);
    const warned = async (translationDevice: unknown, deviceMode?: string) => {
        const p = await catalogPage(context, { catalog: catalogOf([row]), hardware });
        return named(cardNamed(p.draw({ targets: ["translation"], translationDevice: translationDevice as never, deviceMode }), "NLLB"), "WarningBadge").length;
    };
    // On the CPU: 6 GiB and the share kept for the OS and VRChat fit in 16 GiB? No: 7.5 + 13 > 16.
    assert.equal(await warned({ device: "cpu", device_index: 0 }, "gpu"), 1);
    // On the NVIDIA GPU: 7.5 + 4 > 4 GiB.
    assert.equal(await warned({ device: "cuda", device_index: 0 }, "cpu"), 1);
    // On a GPU the probe does not list: nothing to compare, nothing said.
    assert.equal(await warned({ device: "cuda", device_index: 3 }), 0);
    // A speech model is warned about on the speech engine's device.
    const speech = model("asr-big", { name: "ASR", profile: { memory_bytes: 6 * GiB, summary: "asr", recommended_for: [], cpu: "slow", gpu: "recommended" } });
    const p = await catalogPage(context, { catalog: catalogOf([speech]), hardware: readyHardware([gpu("GPU0", 30 * GiB, 32 * GiB, "NVIDIA")]) });
    assert.equal(named(cardNamed(p.draw({ targets: ["asr"], translationDevice: { device: "cpu" } }), "ASR"), "WarningBadge").length, 0);
    assert.equal(named(cardNamed(p.draw({ targets: ["asr"], deviceMode: "cpu" }), "ASR"), "WarningBadge").length, 1, "set to the CPU, where it is slow");
});

test("one model asked about is the only card, and the Japanese speech catalog lists the engines a user installs", async context => {
    const rows = [model("a", { target: "translation", name: "A" }), model("b", { target: "translation", name: "B" }), model("j", { target: "japanese", name: "J" })];
    const p = await catalogPage(context, { catalog: catalogOf(rows) }, { layout: "grid" });
    let tree = p.draw({ targets: ["translation"], only: ["b"] });
    assert.deepEqual(cards(tree).map(card => card.props["aria-label"]), ["B"]);
    assert.equal(findIn(tree, node => node.type === "catalog-list").props.layout, "list", "one model stays a list");
    tree = p.draw({ targets: ["translation"], only: undefined });
    assert.deepEqual(cards(tree).map(card => card.props["aria-label"]), ["A", "B"]);
    assert.equal(find(tree, node => node.type === "engine-catalog"), null);
    tree = p.draw({ targets: ["japanese"], engines: true });
    assert.equal(findIn(tree, node => node.type === "engine-catalog").props.layout, "grid");
    assert.equal(find(p.draw({ targets: ["japanese"], engines: false }), node => node.type === "engine-catalog"), null);
    assert.equal(find(p.draw({ targets: ["japanese"], engines: undefined }), node => node.type === "engine-catalog"), null, "only when asked for");
    assert.equal(find(p.draw({ targets: ["translation"], engines: true }), node => node.type === "engine-catalog"), null);
});

test("the shared GPU reading names the device, its free and total memory and when it was measured, and keeps the headroom the page chose", async context => {
    const p = await catalogPage(context, { hardware: readyHardware([gpu("GPU0", 3 * GiB, 8 * GiB, "Card"), gpu("GPU1", null, 2 * GiB, "Small")]) }, { i18n: { language: "ja" } });
    const chosen: string[] = [];
    const readout = (reserve = "vr") => p.runtime.render(p.module.HardwareReadout, { reserve, setReserve: (value: string) => { chosen.push(value); } });
    let tree = readout();
    assert.deepEqual([tree.type, tree.props.role, tree.props["aria-label"]], ["div", "group", "model_downloads.hardware_title"]);
    assert.deepEqual(texts(tree, "h3"), ["model_downloads.hardware_title"]);
    const select = findIn(tree, node => node.type === kitStandIns.Select);
    assert.deepEqual([select.props["aria-label"], select.props.value], ["model_downloads.headroom", "vr"]);
    assert.deepEqual(ofType(select, kitStandIns.SelectOption).map(option => [option.props.value, textOf(option)]),
        [["vr", "model_downloads.headroom_vr"], ["alone", "model_downloads.headroom_alone"]]);
    assert.equal([findIn(tree, node => node.type === "label").props.children].flat()[0], "model_downloads.headroom");
    select.props.onChange({ target: { value: "alone" } });
    assert.deepEqual(chosen, ["alone"]);
    assert.equal(findIn(readout("alone"), node => node.type === kitStandIns.Select).props.value, "alone");
    tree = readout();
    const shown = findIn(tree, node => node.type === "readout");
    assert.equal(shown.props.live, false);
    assert.deepEqual(texts(shown, "p"), ["GPU0: Card · model_downloads.hardware_free: 3.00 GiB / model_downloads.hardware_total: 8.00 GiB",
        `model_downloads.hardware_measured: ${new Date(measuredAt).toLocaleTimeString("ja")}`, "model_downloads.multiple_gpus"]);
    const refresh = buttonNamed(tree, "model_downloads.hardware_refresh");
    assert.equal(refresh.props.disabled, false);
    refresh.props.onClick();
    assert.deepEqual(p.sent, [["/run/refresh_model_download_hardware", {}]]);
    const column = findIn(tree, node => node.type === "div" && [node.props.children].flat().some(child => treeNode(child)?.type === "button"));
    assert.equal(classesOf(column).length, 1);
    assert.equal(find(tree, node => node.props?.["aria-busy"] === "true"), null);
    const fold = findIn(tree, node => node.type === "fold");
    assert.deepEqual([fold.props.size, fold.props.summary, textOf(fold)], ["link", "model_downloads.memory_boundary_summary", "model_downloads.memory_boundary"]);

    // One GPU whose free memory is not known, read while a new reading is on its way.
    p.downloads.hardware = { ...readyHardware([gpu("GPU0", Number.NaN, 8 * GiB, "Card")]), phase: "ready" };
    assert.deepEqual(texts(findIn(readout(), node => node.type === "readout"), "p").slice(0, 1),
        ["GPU0: Card · model_downloads.hardware_free: model_downloads.hardware_unknown / model_downloads.hardware_total: 8.00 GiB"]);
    p.downloads.hardware = { phase: "probing", devices: [], measured_at_ms: null };
    tree = readout();
    assert.equal(buttonNamed(tree, "model_downloads.hardware_refresh").props.disabled, true);
    assert.deepEqual(ofType(tree, "span").map(node => [node.props["aria-busy"], textOf(node)]), [["true", "model_downloads.hardware_probing"]]);
    assert.equal(find(tree, node => node.type === "readout"), null, "nothing measured: no readout");
    // A reading of the CPU only, or one too old to advise on, still says when it was taken.
    p.downloads.hardware = readyHardware([{ name: "CPU", kind: "cpu", memory_total: 16 * GiB, memory_free: 8 * GiB }]);
    assert.deepEqual(texts(findIn(readout(), node => node.type === "readout"), "p"), [`model_downloads.hardware_measured: ${new Date(measuredAt).toLocaleTimeString("ja")}`]);
});

test("the shared GPU reading works without the UI's language, and asks for a reading when its phase changes", async context => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const p = await catalogPage(context, { hardware: readyHardware([gpu("GPU0", 3 * GiB, 8 * GiB)]) }, { i18n: null });
    const readout = () => p.runtime.render(p.module.HardwareReadout, { reserve: "vr", setReserve() {} });
    const tree = readout();
    assert.ok(texts(tree, "p").includes(`model_downloads.hardware_measured: ${new Date(measuredAt).toLocaleTimeString(undefined)}`));
    assert.equal(p.counts.ensured, 1);
    assert.equal(vi.getTimerCount(), 1, "the reading's age is redrawn every five seconds");
    readout();
    assert.equal(p.counts.ensured, 1);
    p.downloads.hardware = { phase: "failed", devices: [] };
    readout();
    assert.equal(p.counts.ensured, 2);
    p.downloads.ensureHardware = () => { p.counts.ensured += 10; };
    readout();
    assert.equal(p.counts.ensured, 12);
    p.updates.length = 0;
    vi.advanceTimersByTime(5000);
    assert.equal(p.updates.filter(update => typeof update === "number").length, 1, "drawn again with the time");
    assert.equal(vi.getTimerCount(), 1);
    p.runtime.unmount();
    assert.equal(vi.getTimerCount(), 0);
});

test("without a device setting, the advice is for the GPU the engine picks itself, also beside a GPU without a name", async context => {
    const voice = model("voice", { target: "multilingual", name: "Voice · F16", guidance: checked(GiB) });
    const p = await catalogPage(context, { catalog: catalogOf([voice]), hardware: readyHardware([gpu("", GiB, 4 * GiB, "Small"), gpu("Big", Number.NaN, 16 * GiB, "Large")]) });
    assert.deepEqual(adviceOf(p.draw({ targets: ["multilingual"] }), "multilingual").slice(0, 1),
        ["Big: Large · model_downloads.hardware_free: model_downloads.hardware_unknown / model_downloads.hardware_total: 16.00 GiB"]);
});

test("each use is advised on its own models, and the local translation gets no GPU advice", async context => {
    const rows = [model("asr", { name: "ASR · Q8_0", guidance: checked(GiB) }), model("voice-1", { target: "japanese", name: "Voice 1 · F16" }),
        model("voice-2", { target: "japanese", name: "Voice 2 · F16", guidance: checked(GiB) }), model("voice-3", { target: "multilingual", name: "Voice 3 · F16" }),
        model("tr", { target: "translation", name: "Tr · int8", guidance: checked(GiB) })];
    const p = await catalogPage(context, { catalog: catalogOf(rows), hardware: readyHardware([gpu("GPU0", 10 * GiB, 16 * GiB)]) });
    const tree = p.draw({ targets: ["japanese", "multilingual", "asr", "translation"] });
    // The suggestion is the model that fits among this use's own, by its name.
    assert.ok(adviceOf(tree, "japanese").includes("model_downloads.recommended: Voice 2 · F16"));
    assert.equal(adviceOf(tree, "multilingual").some(line => line.startsWith("model_downloads.recommended")), false);
    assert.ok(adviceOf(tree, "multilingual").includes("model_downloads.advice_unverified"));
    const fits = (label: string) => accentBadges(cardNamed(tree, label)).includes("model_catalog.fits_memory");
    assert.deepEqual([fits("Voice 1"), fits("Voice 2"), fits("ASR"), fits("Tr")], [false, true, true, false]);
});

test("a model's file in use is shown first; the suggestion and another model's choice leave its card alone", async context => {
    const whisper = (id: string, type: string, extra: Record<string, unknown> = {}) => model(id, { name: `Whisper · ${type}`, speech: { name: "whisper", label: "Whisper", type, default: type === "Q8_0" }, ...extra });
    const moon = (id: string, type: string) => model(id, { name: `Moon · ${type}`, speech: { name: "moon", label: "Moon", type, default: false } });
    const rows = [whisper("w-q8", "Q8_0", { guidance: checked(GiB) }), whisper("w-q4", "Q4_K"), moon("m-a", "A"), moon("m-b", "B")];
    const p = await catalogPage(context, { catalog: catalogOf(rows), hardware: readyHardware([gpu("GPU0", 10 * GiB, 16 * GiB)]),
        state: { observation_id: "1", jobs: {}, downloaded: { "w-q4": { model: "/q4.gguf" } } } });
    let tree = p.draw({ targets: ["asr"], expected: { asr: { model: "/q4.gguf" } } });
    let card = cardNamed(tree, "Whisper");
    const select = findIn(card, node => node.type === kitStandIns.Select);
    assert.equal(select.props.value, "w-q4", "the file in use, before the suggested one");
    assert.deepEqual(texts(select, kitStandIns.SelectOption), ["Q8_0 · 1.00 GiB · model_downloads.asr_type_default", "Q4_K · 1.00 GiB · model_catalog.status.in_use"]);
    assert.equal(texts(card, "p").includes("model_downloads.manual_choice"), false, "the user chose nothing");
    assert.deepEqual(variantLines(card), [], "several files: their type is in the choice");
    assert.equal(findIn(tree, node => node.type === "catalog-section").props.readout, `model_catalog.group_readout {"count":2,"obtained":1}`);
    // The suggested model is Whisper: Moon's card neither fits nor says the user left the suggestion.
    card = cardNamed(tree, "Moon");
    assert.equal(ofType(card, "span").some(node => textOf(node) === "model_catalog.fits_memory"), false);
    findIn(card, node => node.type === kitStandIns.Select).props.onChange({ target: { value: "m-b" } });
    tree = p.draw();
    card = cardNamed(tree, "Moon");
    assert.equal(findIn(card, node => node.type === kitStandIns.Select).props.value, "m-b");
    assert.equal(texts(card, "p").includes("model_downloads.manual_choice"), false);
});

test("a ready download can be applied when the page sets no block, and a failed one keeps only its readout and its error", async context => {
    const row = model("m", { name: "Model · Q8_0" });
    const p = await catalogPage(context, { catalog: catalogOf([row]), state: { observation_id: "1", jobs: { m: { job_id: "j", phase: "ready" } } } });
    let card = cardNamed(p.draw({ targets: ["asr"], expected: { asr: { model: "/m.gguf" } } }), "Model");
    assert.equal(buttonNamed(card, "model_downloads.apply").props.disabled, false);
    assert.equal(texts(card, "p").some(line => line.startsWith("model_downloads.blocked")), false);
    p.downloads.state = { observation_id: "2", jobs: { m: { job_id: "j", phase: "failed", error_code: "disk_full" } } };
    card = cardNamed(p.draw(), "Model");
    const box = findIn(card, node => node.type === "div" && [node.props.children].flat().some(child => treeNode(child)?.type === "readout"));
    assert.deepEqual([box.props.children].flat().filter(child => treeNode(child) !== null).map(child => treeNode(child)?.type), ["readout", "p"]);
    assert.equal(texts(card, "p").includes("model_downloads.apply_hint"), false);
});

test("models of one's own are counted only for the uses that take them, and before they arrive there are none", async context => {
    const own = { id: "mine", target: "translation", name: "Mine", paths: { model: "/x" }, total_bytes: 1, registered_at: null, status: "ok" };
    const p = await catalogPage(context, { catalog: catalogOf([model("tr", { target: "translation", name: "Tr" })]), userModels: { models: [own] } });
    assert.equal(findIn(p.draw({ targets: ["translation"] }), node => node.type === "catalog-section").props.readout, `model_catalog.group_readout {"count":1,"obtained":0}`);
    p.downloads.userModels = null;
    assert.equal(findIn(p.draw({ targets: ["vad"] }), node => node.type === "catalog-section").props.readout, `model_catalog.group_readout {"count":0,"obtained":0}`);
});

test("a speech output catalog's reading says when it was taken also without the UI's language", async context => {
    const p = await catalogPage(context, { catalog: catalogOf([model("v", { target: "japanese", name: "V · F16" })]), hardware: readyHardware([gpu("GPU0", GiB, 2 * GiB)]) },
        { i18n: null });
    assert.ok(adviceOf(p.draw({ targets: ["japanese"] }), "japanese").includes(`model_downloads.hardware_measured: ${new Date(measuredAt).toLocaleTimeString(undefined)}`));
});

test("a translation model on the CPU is compared with the RAM, not with the speech engine's GPU", async context => {
    const row = model("nllb", { target: "translation", name: "NLLB", profile: { memory_bytes: 6 * GiB, summary: "nllb", recommended_for: [], cpu: "absent", gpu: "absent" } });
    const p = await catalogPage(context, { catalog: catalogOf([row]), hardware: readyHardware([{ name: "CPU", kind: "cpu", memory_total: 64 * GiB, memory_free: 32 * GiB },
        gpu("GPU0", 2 * GiB, 4 * GiB, "NVIDIA RTX")]) });
    assert.equal(named(cardNamed(p.draw({ targets: ["translation"], translationDevice: { device: "cpu", device_index: 0 } }), "NLLB"), "WarningBadge").length, 0);
});

test("a card's choice of the file keeps the column's width: the rule sizes the kit Select's wrapper, never the kit's field", async () => {
    // The forms give the kit Select's wrapper a compact width; on a card the file's choice takes the
    // facts' value column instead, as the card's own select did.
    const css = (await import("node:fs")).readFileSync(new URL("./VoiceSettings.css.ts", import.meta.url), "utf8");
    assert.match(css, /globalStyle\(variants\.map\(selector => `\$\{selector\} \[data-slot="native-select-wrapper"\]`\)\.join\(", "\), \{ width: "auto", minWidth: 0, maxWidth: "100%", justifySelf: "auto" \}\);/);
    assert.doesNotMatch(css, /\$\{selector\} select`/);
});
