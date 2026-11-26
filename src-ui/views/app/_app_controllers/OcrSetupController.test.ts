import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { hooks, kitStandIns, loadModule, find, nodesIn, unchecked } from "../../../logics/test/hookHarness.ts";
import { localeAt, readLocale } from "../../../logics/test/locales.ts";
import type { FocusOcrModelsOptions } from "../../../logics/ocr/useOcrSetup.ts";

type OcrSetupModule = typeof import("../../../logics/ocr/useOcrSetup.ts");

// What the dialog reads: the models the reading language needs and those missing, and the
// downloads' jobs.
interface FixtureState {
    readiness: { required_models: string[]; missing_models: string[] } | null;
    jobs: Record<string, { job_id?: string; phase: string }>;
}

async function fixture(context: TestContext, readiness: FixtureState["readiness"] = { required_models: ["base", "korean"], missing_models: ["base", "korean"] }) {
    const runtime = hooks(), events: unknown[][] = [];
    const state: FixtureState = { readiness, jobs: {} };
    const setup = await loadModule<OcrSetupModule>(new URL("../../../logics/ocr/useOcrSetup.ts", import.meta.url), runtime);
    const { OcrSetupController } = await loadModule<typeof import("./OcrSetupController.tsx")>(new URL("./OcrSetupController.tsx", import.meta.url), runtime, {
        "@store": {
            useStore_IsOpenedConfigPage: () => ({ updateIsOpenedConfigPage: (value: unknown) => events.push(["config_page", value]) }),
            useStore_SelectedConfigTabId: () => ({ updateSelectedConfigTabId: (value: unknown) => events.push(["tab", value]) }),
        },
        "@logics_common": { useNotificationStatus: () => ({ showNotification_Success: (message: unknown) => events.push(["success", message]) }) },
        "@logics_configs": { useOcr: () => ({ currentOcrModelReadiness: { data: state.readiness },
            getOcrModelReadiness: () => events.push(["readiness"]) }) },
        "@logics_main": { useMainFunction: () => ({ setOcrCapture: (on: unknown) => events.push(["chat reading", on]) }) },
        "../../../logics/voice/useModelDownloads": { useModelDownloads: () => ({ state: { jobs: state.jobs } }) },
        "../config_page/setting_section/setting_box/ocr/OcrModels": { OcrModels: "ocr-models" },
        "../../../logics/ocr/useOcrSetup": { ...setup, focusOcrModels: () => events.push(["focus_models"]) },
        "../../../logics/common/useConsentDialog": { useConsentDialog: () => ({ dialog: { current: null }, close: () => events.push(["close"]) }) },
    });
    context.onTestFinished(() => runtime.unmount());
    const render = () => runtime.render(OcrSetupController);
    const click = (key: string) => {
        const button = find(render(), node => node.type === kitStandIns.Button && node.props.children === `ocr_setup.${key}`);
        assert.ok(button);
        return button.props.onClick();
    };
    const show = () => { runtime.render(setup.useOcrSetup).show(); return render(); };
    const models = () => find(render(), node => node.type === "ocr-models")?.props;
    const waiting = () => runtime.render(setup.useOcrSetup).waiting;
    return { render, click, show, models, waiting, events, state };
}

test("the dialog is hidden until chat reading is turned on without its models", async context => {
    const s = await fixture(context);
    assert.equal(s.render(), null);
    const tree = s.show();
    // In the forms' section (the words) and the shared host, which takes no room of its own.
    assert.deepEqual(String(tree?.props.className).split(" ").sort(), ["container", "host"]);
    // The kit's Dialog, shown while the dialog is open and named by its title alone, as before (D-43).
    const dialog = find(tree, node => node.type === kitStandIns.Dialog);
    assert.ok(dialog);
    assert.deepEqual([dialog.props.open, "aria-describedby" in dialog.props, dialog.props["aria-describedby"]], [true, true, undefined]);
    assert.equal(find(dialog, node => node.type === kitStandIns.DialogTitle)?.props.children, "ocr_setup.title");
    assert.deepEqual(nodesIn(find(dialog, node => node.type === kitStandIns.DialogHeader)).filter(node => node.type === "p").map(node => node.props.children),
        ["ocr_setup.body", "ocr_setup.next"]);
    const focused = find(tree, node => node.props?.autoFocus);
    assert.ok(focused);
    assert.equal(focused.props.children, "ocr_setup.close", "initial focus is the safe action");
    // Close, then the way to the settings, in the footer in that order (D-24). The download is the
    // models' own action, after its review, so no footer button is the primary one.
    const footer = find(dialog, node => node.type === kitStandIns.DialogFooter);
    assert.deepEqual(nodesIn(footer).filter(node => node.type === kitStandIns.Button).map(node => [node.props.children, node.props.tone]),
        [["ocr_setup.close", undefined], ["ocr_setup.review", undefined]]);
});

// #1241: the models in the dialog, as the speech recognition fix offers its model (#1232).
test("the dialog offers the models the language needs, each with its review, and asks which are missing", async context => {
    const s = await fixture(context, { required_models: ["base", "korean"], missing_models: ["korean"] });
    s.show();
    s.render();
    const models = s.models();
    assert.ok(models);
    assert.deepEqual([models.inFix, models.ids, models.missing], [true, ["base", "korean"], ["korean"]]);
    assert.deepEqual([models.title, models.note], ["config_page.ocr.models.title", "config_page.ocr.models.required"]);
    // Asked once as it opens, and again by the models' part when one is ready, with the same function.
    assert.deepEqual(s.events, [["readiness"]]);
    assert.equal(s.models()?.onChanged, models.onChanged);
    // Nothing is downloaded by the dialog itself, and nothing is waited for until a download starts.
    assert.equal(s.waiting(), null);
});

test("once every missing model started from the dialog is here, chat reading turns on and the dialog closes", async context => {
    const s = await fixture(context);
    s.show();
    s.events.length = 0;
    s.models()?.onStart("base");
    assert.deepEqual(s.waiting(), ["base", "korean"]);
    s.state.jobs = { base: { job_id: "1", phase: "ready" }, korean: { job_id: "2", phase: "downloading" } };
    s.render();
    assert.deepEqual(s.events, [], "one of them is still on its way");
    s.state.jobs.korean = { job_id: "2", phase: "ready" };
    s.render();
    s.render();
    assert.deepEqual(s.events, [["close"], ["success", "ocr_setup.models_ready"], ["chat reading", true]]);
    assert.equal(s.waiting(), null);
    assert.equal(s.render(), null, "done, the dialog closed");
});

test("a failed or cancelled download ends the wait and leaves chat reading off", async context => {
    for (const phase of ["failed", "cancelled"]) {
        const s = await fixture(context);
        s.show();
        s.models()?.onStart("base");
        s.state.jobs = { base: { job_id: "1", phase } };
        s.render();
        s.render();
        assert.equal(s.waiting(), null, phase);
        assert.equal(s.events.some(event => event[0] === "chat reading"), false, phase);
    }
});

test("closing waits on only while every missing model is on its way", async context => {
    // A model not started: closing ends the wait, so a download started later elsewhere does not turn chat reading on.
    const left = await fixture(context);
    left.show();
    left.models()?.onStart("base");
    left.state.jobs = { base: { job_id: "1", phase: "downloading" } };
    left.click("close");
    assert.equal(left.waiting(), null);
    // Both on their way: the wait outlives the dialog, and chat reading turns on when they are here.
    const both = await fixture(context);
    both.show();
    both.models()?.onStart("base");
    both.state.jobs = { base: { job_id: "1", phase: "downloading" }, korean: { job_id: "2", phase: "queued" } };
    both.click("close");
    assert.deepEqual(both.waiting(), ["base", "korean"]);
    assert.equal(both.render(), null);
    both.state.jobs = { base: { job_id: "1", phase: "ready" }, korean: { job_id: "2", phase: "ready" } };
    both.render();
    both.render();
    assert.deepEqual(both.events.filter(event => event[0] !== "close" && event[0] !== "readiness"), [["success", "ocr_setup.models_ready"], ["chat reading", true]]);
});

test("the way to the settings opens the chat reading tab and focuses the models; nothing is downloaded", async context => {
    const s = await fixture(context);
    s.show();
    s.events.length = 0;
    s.click("review");
    assert.equal(s.render(), null);
    assert.deepEqual(s.events, [["close"], ["tab", "ocr"], ["config_page", true], ["focus_models"]]);
});

test("closing, or Escape, leaves everything as it was", async context => {
    const s = await fixture(context);
    s.show();
    s.events.length = 0;
    s.click("close");
    assert.equal(s.render(), null);
    // Escape: the kit's Dialog asks its owner to close it (Dialog.test.ts).
    const dialog = find(s.show(), node => node.type === kitStandIns.Dialog);
    assert.ok(dialog);
    dialog.props.onOpenChange(false);
    assert.equal(s.render(), null);
    assert.deepEqual(s.events.filter(event => event[0] !== "readiness"), [["close"], ["close"]]);
    assert.equal(s.waiting(), null);
});

test("focusing the models waits for the section, opens its part and lands on a model's first enabled action", async () => {
    const { focusOcrModels } = await loadModule<OcrSetupModule>(new URL("../../../logics/ocr/useOcrSetup.ts", import.meta.url), hooks());
    const focused: string[] = [], timers: (() => void)[] = [];
    // The models' part, closed at first as every catalog's part: open by the time the focus lands.
    const part = { open: false };
    const button = (disabled: boolean) => ({ disabled, focus: () => focused.push(disabled ? "disabled" : `review, part ${part.open ? "open" : "closed"}`) });
    // The section's other buttons (the catalog's layout above the cards, the dialog's) are not where
    // the download starts.
    const layout = { disabled: false, focus: () => focused.push("layout") };
    let section: object | null = null;
    const doc = { querySelector: (selector: string) => selector === '[data-setting-id="ocr_models"]' ? section : null };
    // Test data: a page with only the section the code looks for, standing in for the document.
    focusOcrModels({ doc: unchecked<FocusOcrModelsOptions["doc"]>(doc), wait: callback => timers.push(callback) });
    const first = timers.shift();
    assert.ok(first);
    first();
    assert.equal(focused.length, 0);
    const found: Record<string, object[]> = { "details[data-catalog-fold]": [part], "[data-model-download] button": [button(true), button(false)] };
    section = { querySelectorAll: (selector: string) => found[selector] ?? [layout, button(false)],
        scrollIntoView: () => focused.push("scrolled"),
        focus: () => focused.push("section") };
    const second = timers.shift();
    assert.ok(second);
    second();
    assert.deepEqual(focused, ["scrolled", "review, part open"]);
});

for (const language of ["en", "ja"]) test(`${language}: the dialog says chat reading stayed off, that downloading asks first, and that it turns on`, async () => {
    const messages = readLocale(language);
    for (const key of ["title", "body", "next", "close", "review", "models_ready"]) assert.ok(localeAt(messages, `ocr_setup.${key}`), key);
    const next = localeAt(messages, "ocr_setup.next");
    assert.ok(typeof next === "string");
    assert.match(next, language === "ja" ? /ライセンス/ : /license/);
    // Where the settings are is the name of the button under it (#614): the sentence says what the
    // models below ask and that chat reading then turns on by itself (#1241).
    assert.doesNotMatch(next, language === "ja" ? /設定の「/ : /settings/i);
    assert.match(next, language === "ja" ? /同意したときだけ/ : /only when you agree/);
    assert.match(next, language === "ja" ? /オンにします/ : /turns on/);
});
