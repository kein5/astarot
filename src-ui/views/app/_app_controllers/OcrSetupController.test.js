import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import yaml from "js-yaml";
import { hooks, loadModule, find } from "../../../logics/test/hookHarness.js";

async function fixture(context) {
    const runtime = hooks(), events = [];
    const setup = await loadModule(new URL("../../../logics/ocr/useOcrSetup.ts", import.meta.url), runtime);
    const { OcrSetupController } = await loadModule(new URL("./OcrSetupController.jsx", import.meta.url), runtime, {
        "@store": {
            useStore_IsOpenedConfigPage: () => ({ updateIsOpenedConfigPage: value => events.push(["config_page", value]) }),
            useStore_SelectedConfigTabId: () => ({ updateSelectedConfigTabId: value => events.push(["tab", value]) }),
        },
        "../../../logics/ocr/useOcrSetup": { ...setup, focusOcrModels: () => events.push(["focus_models"]) },
        "../../../logics/common/useConsentDialog": { useConsentDialog: () => ({ dialog: { current: null }, close: () => events.push(["close"]) }) },
    });
    context.after(() => runtime.unmount());
    const render = () => runtime.render(OcrSetupController);
    const click = key => find(render(), node => node.type === "button" && node.props.children === `ocr_setup.${key}`).props.onClick();
    const show = () => { runtime.render(setup.useOcrSetup).show(); return render(); };
    return { render, click, show, events };
}

test("the guide is hidden until chat reading is turned on without its models", async context => {
    const s = await fixture(context);
    assert.equal(s.render(), null);
    const tree = s.show();
    assert.ok(find(tree, node => node.type === "dialog"));
    assert.equal(find(tree, node => node.props?.autoFocus).props.children, "ocr_setup.close", "initial focus is the safe action");
});

test("going to the models opens the OCR settings tab and focuses the models; nothing is downloaded", async context => {
    const s = await fixture(context);
    s.show();
    s.click("review");
    assert.equal(s.render(), null);
    assert.deepEqual(s.events, [["close"], ["tab", "ocr"], ["config_page", true], ["focus_models"]]);
});

test("closing, or Escape, leaves everything as it was", async context => {
    const s = await fixture(context);
    s.show();
    s.click("close");
    assert.equal(s.render(), null);
    let prevented = false;
    find(s.show(), node => node.type === "dialog").props.onCancel({ preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(s.render(), null);
    assert.deepEqual(s.events, [["close"], ["close"]]);
});

test("focusing the models waits for the section and lands on its first enabled action", async () => {
    const { focusOcrModels } = await loadModule(new URL("../../../logics/ocr/useOcrSetup.ts", import.meta.url), hooks());
    const focused = [], timers = [];
    const button = (disabled, inDialog = false) => ({ disabled, closest: () => inDialog ? {} : null, focus: () => focused.push(disabled ? "disabled" : "review") });
    let section = null;
    const doc = { querySelector: selector => selector === '[data-setting-id="ocr_models"]' ? section : null };
    focusOcrModels({ doc, wait: callback => timers.push(callback) });
    timers.shift()();
    assert.equal(focused.length, 0);
    section = { querySelectorAll: () => [button(true), button(false, true), button(false)], scrollIntoView: () => focused.push("scrolled"),
        focus: () => focused.push("section") };
    timers.shift()();
    assert.deepEqual(focused, ["scrolled", "review"]);
});

for (const language of ["en", "ja"]) test(`${language}: the guide says chat reading stayed off and that downloading asks first`, async () => {
    const messages = yaml.load(await readFile(new URL(`../../../../locales/${language}.yml`, import.meta.url), "utf8"));
    for (const key of ["title", "body", "next", "close", "review"]) assert.ok(messages.ocr_setup[key], key);
    assert.match(messages.ocr_setup.next, language === "ja" ? /ライセンス/ : /license/);
});
