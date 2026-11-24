import assert from "node:assert/strict";
import { test, vi } from "vitest";
import type { TestContext } from "vitest";
import { readFile } from "node:fs/promises";
import { hooks, loadModule, find, findIn, drawWith, unchecked, kitStandIns } from "../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../logics/test/hookHarness.ts";
import * as helpers from "../../../../../../logics/configs/ocrReadiness.ts";

const windowRegion = { x: 0.6, y: 0.1, width: 0.2, height: 0.2 };
const vrRegion = { x: 0.1, y: 0.5, width: 0.3, height: 0.4 };
const prefix = "config_page.ocr.";

// The capture status the page reads, as far as the tests give it.
interface CaptureStatus {
    active?: boolean;
    source?: string | null;
    available_sources?: string[];
    state?: string;
    stage?: string;
}
type OcrStatusProps = Parameters<typeof import("./OcrStatus.tsx").OcrStatus>[0];

async function setup(t: TestContext, status: CaptureStatus | null, hints = false) {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const runtime = hooks(), sent: [string, unknown][] = [], polled: string[] = [];
    const value = <T>(data: T) => ({ data, state: "ok" });
    const ocr = {
        currentOcrCaptureStatus: value(status),
        getOcrCaptureStatus: () => polled.push("initial"),
        currentOcrCaptureRegion: value(windowRegion),
        currentOcrVrCaptureRegion: value(vrRegion),
        setOcrCaptureRegion: (region: unknown) => sent.push(["window", region]),
        setOcrVrCaptureRegion: (region: unknown) => sent.push(["vr", region]),
    };
    const imports = {
        "@logics_configs": { useOcr: () => ocr },
        "@useI18n": { useI18n: () => ({ t: (key: string, params?: { status?: string }) => params?.status ? `${key} ${params.status}` : key }) },
        "../../../../../../logics/configs/ocrReadiness": helpers,
        "../_templates/Templates": { SliderContainer: "slider" },
        "../_components/env_readout/EnvReadout": { EnvReadout: "readout" },
        "../_components/hint/Hint": { HintDescriptions: "hints", Hint: "hint", useHintDescriptions: () => hints },
    };
    const components = await loadModule<typeof import("./OcrRegions.tsx")>(new URL("./OcrRegions.tsx", import.meta.url), runtime, imports);
    const { OcrStatus } = await loadModule<typeof import("./OcrStatus.tsx")>(new URL("./OcrStatus.tsx", import.meta.url), runtime, imports);
    t.onTestFinished(() => runtime.unmount());
    const isEditor = (source: string) => (node: TreeNode) => node.type === components.OcrRegionEditor && node.props.source === source;
    return { ...components, runtime, ocr, sent, polled,
        render: () => runtime.render(components.OcrRegions),
        // Test data: only the props each test gives; the status reads the others as missing.
        status: (props: Partial<OcrStatusProps> = {}) => runtime.render(OcrStatus, unchecked<OcrStatusProps>(props)),
        editor: (source: string, tree: unknown) => find(tree, isEditor(source)),
        // The editor the test reads next: one that is not there fails here, as reading it did.
        editorIn: (source: string, tree: unknown) => findIn(tree, isEditor(source), `${source} editor`),
    };
}

test("region editors share capture status without polling or adding a second readout", async t => {
    const s = await setup(t, { active: true, source: "window", available_sources: ["window", "vr"] });
    for (const source of ["window", "vr", null]) {
        const status = s.ocr.currentOcrCaptureStatus.data;
        assert.ok(status);
        status.source = source;
        const tree = s.render();
        assert.equal(find(tree, node => node.type === "readout"), null);
        assert.deepEqual(s.editorIn("window", tree).props.variable.data, windowRegion);
        assert.deepEqual(s.editorIn("vr", tree).props.variable.data, vrRegion);
    }
    vi.advanceTimersByTime(3000);
    assert.deepEqual(s.polled, []);
    assert.deepEqual(s.sent, []);
});

test("one live readout combines the source and runtime, including failure and recovery", async t => {
    const s = await setup(t, null);
    const readiness = { engine: true, language_supported: true, missing_models: [], capture: "ok" };
    const render = () => { const status = s.status({ readiness }); assert.ok(status); return status; };
    assert.equal(render().props.children.props.children, `${prefix}capture_source.checking`);
    for (const source of ["window", "vr", null]) {
        for (const state of ["waiting", "reading", "retrying", "reading"]) {
            s.ocr.currentOcrCaptureStatus.data = { active: true, source, state, stage: "detector" };
            const tree = render();
            assert.equal(tree.type, "readout");
            assert.equal(tree.props.children.props.role, "status");
            const message = `${prefix}runtime.${state === "retrying" ? "failed_detector" : state}`;
            assert.equal(tree.props.children.props.children, source ? `${prefix}capture_source.${source} ${message}` : message);
            assert.equal(tree.props.tone, state === "retrying" ? "failed" : state === "reading" ? "active" : "warning");
        }
    }
    s.ocr.currentOcrCaptureStatus.data = { active: false, state: "stopped", source: null };
    assert.equal(render().props.children.props.children, `${prefix}capture_source.stopped ${prefix}readiness.ready`);
    readiness.capture = "window_not_found";
    assert.equal(render().props.children.props.children, `${prefix}capture_source.stopped ${prefix}readiness.window_not_found`);
    assert.deepEqual(s.sent, []);
});

test("edits and reset use the source's own setter, including when that source is inactive", async t => {
    const s = await setup(t, { active: true, source: "vr", available_sources: ["window", "vr"] });
    const tree = s.render();
    for (const source of ["window", "vr"]) {
        const region = source === "window" ? windowRegion : vrRegion;
        const editor = s.runtime.render(s.OcrRegionEditor, s.editorIn(source, tree).props);
        assert.equal(editor.props["aria-label"], `${prefix}region.${source}_label`);
        findIn(editor, node => node.type === "slider" && node.props.label === `${prefix}region.width`)
            .props.setterFunction(10);
        assert.deepEqual(s.sent.at(-1), [source, { ...region, width: 0.1 }]);
        // Reset, the kit's plain Button, says what the whole area of its source is.
        const reset = findIn(editor, node => node.type === kitStandIns.Button);
        assert.equal(reset.props.children, `${prefix}region.${source === "vr" ? "vr_reset" : "reset"}`);
        reset.props.onClick();
        assert.deepEqual(s.sent.at(-1), [source, helpers.FULL_REGION]);
        const preview = findIn(editor, node => node.props?.role === "img");
        assert.deepEqual(preview.props.children.props.style, {
            left: `${region.x * 100}%`, top: `${region.y * 100}%`,
            width: `${region.width * 100}%`, height: `${region.height * 100}%`,
        });
    }
});

test("Linux shows only the window region, even if a VR region was saved on Windows", async t => {
    const s = await setup(t, { active: true, source: "window", available_sources: ["window"] });
    const tree = s.render();
    assert.ok(s.editor("window", tree));
    assert.equal(s.editor("vr", tree), null);
    assert.equal(find(tree, node => node.props?.children === `${prefix}region.source_switch`), null);
    s.ocr.currentOcrCaptureStatus.data = null;
    assert.equal(s.editor("vr", s.render()), null);
});

test("status polling uses the current getter, starts once, and stops when the page closes", async t => {
    const s = await setup(t, null);
    s.status();
    s.render(); // The sibling region editor shares the reply without another poll.
    assert.deepEqual(s.polled, ["initial"]);
    s.ocr.getOcrCaptureStatus = () => s.polled.push("new");
    s.status();
    vi.advanceTimersByTime(1000);
    assert.deepEqual(s.polled, ["initial", "new"]);
    vi.advanceTimersByTime(2000);
    assert.deepEqual(s.polled, ["initial", "new", "new", "new"]);
    s.runtime.unmount();
    vi.advanceTimersByTime(5000);
    assert.deepEqual(s.polled, ["initial", "new", "new", "new"]);
    assert.deepEqual(s.sent, []);
});

test("the refresh button still requests readiness without changing settings", async t => {
    const s = await setup(t, null);
    const refreshed: boolean[] = [];
    const tree = s.status({ onRefresh: () => refreshed.push(true) });
    assert.ok(tree);
    // Refresh, the kit's plain Button, beside the readout.
    assert.deepEqual([tree.props.actions.type, tree.props.actions.props.children], [kitStandIns.Button, "config_page.ocr.models.refresh"]);
    tree.props.actions.props.onClick();
    assert.deepEqual(refreshed, [true]);
    assert.deepEqual(s.polled, ["initial"]);
    assert.deepEqual(s.sent, []);
});

test("reset is disabled while pending or already full", async t => {
    const s = await setup(t, null);
    const variables: Parameters<typeof s.OcrRegionEditor>[0]["variable"][] = [{ data: windowRegion, state: "pending" }, { data: helpers.FULL_REGION, state: "ok" }];
    for (const variable of variables) {
        const tree = s.runtime.render(s.OcrRegionEditor, { source: "vr", variable, setRegion: () => {} });
        assert.equal(findIn(tree, node => node.type === kitStandIns.Button).props.disabled, true);
    }
});

test("English and Japanese have source status and separate region labels", async () => {
    for (const language of ["en", "ja"]) {
        const text = await readFile(new URL(`../../../../../../../locales/${language}.yml`, import.meta.url), "utf8");
        const ocr = text.slice(text.indexOf("    ocr:"));
        assert.match(ocr, /^\s+capture_source:\n/m);
        for (const key of ["checking", "stopped", "window", "vr", "window_label",
            "vr_label", "source_switch", "vr_desc", "vr_reset", "vr_preview_label"]) {
            assert.match(ocr, new RegExp(`^\\s+${key}: \\S`, "m"), `${language}: ${key}`);
        }
    }
});

test("on a page reviewed against #614 a region's lines are its name's hint, the switching note with the first", async t => {
    const s = await setup(t, { active: true, source: "vr", available_sources: ["window", "vr"] }, true);
    const tree = s.render();
    assert.ok(!find(tree, node => node.type === "p"), "no line of text over the regions");
    const titleOf = (source: string) => {
        const editor = s.runtime.render(s.OcrRegionEditor, s.editorIn(source, tree).props);
        const title = findIn(editor, node => node.type === s.RegionTitle);
        // The region's title, a component of the page's own, drawn as React would.
        return drawWith(s.runtime, title);
    };
    const first = findIn(titleOf("window"), node => node.type === "hint");
    assert.equal(first.props.text, `${prefix}region.source_switch\n${prefix}region.desc`);
    assert.equal(first.props.focusable, true, "no single field stands for the region: the mark takes focus");
    assert.equal(findIn(titleOf("vr"), node => node.type === "hint").props.text, `${prefix}region.vr_desc`);
});
