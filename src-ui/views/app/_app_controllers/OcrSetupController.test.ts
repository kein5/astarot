import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { hooks, loadModule, find, unchecked } from "../../../logics/test/hookHarness.ts";
import { localeAt, readLocale } from "../../../logics/test/locales.ts";
import type { FocusOcrModelsOptions } from "../../../logics/ocr/useOcrSetup.ts";

type OcrSetupModule = typeof import("../../../logics/ocr/useOcrSetup.ts");

async function fixture(context: TestContext) {
    const runtime = hooks(), events: unknown[][] = [];
    const setup = await loadModule<OcrSetupModule>(new URL("../../../logics/ocr/useOcrSetup.ts", import.meta.url), runtime);
    const { OcrSetupController } = await loadModule<typeof import("./OcrSetupController.tsx")>(new URL("./OcrSetupController.tsx", import.meta.url), runtime, {
        "@store": {
            useStore_IsOpenedConfigPage: () => ({ updateIsOpenedConfigPage: (value: unknown) => events.push(["config_page", value]) }),
            useStore_SelectedConfigTabId: () => ({ updateSelectedConfigTabId: (value: unknown) => events.push(["tab", value]) }),
        },
        "../../../logics/ocr/useOcrSetup": { ...setup, focusOcrModels: () => events.push(["focus_models"]) },
        "../../../logics/common/useConsentDialog": { useConsentDialog: () => ({ dialog: { current: null }, close: () => events.push(["close"]) }) },
    });
    context.onTestFinished(() => runtime.unmount());
    const render = () => runtime.render(OcrSetupController);
    const click = (key: string) => {
        const button = find(render(), node => node.type === "button" && node.props.children === `ocr_setup.${key}`);
        assert.ok(button);
        return button.props.onClick();
    };
    const show = () => { runtime.render(setup.useOcrSetup).show(); return render(); };
    return { render, click, show, events };
}

test("the guide is hidden until chat reading is turned on without its models", async context => {
    const s = await fixture(context);
    assert.equal(s.render(), null);
    const tree = s.show();
    assert.ok(find(tree, node => node.type === "dialog"));
    const focused = find(tree, node => node.props?.autoFocus);
    assert.ok(focused);
    assert.equal(focused.props.children, "ocr_setup.close", "initial focus is the safe action");
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
    const dialog = find(s.show(), node => node.type === "dialog");
    assert.ok(dialog);
    dialog.props.onCancel({ preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(s.render(), null);
    assert.deepEqual(s.events, [["close"], ["close"]]);
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

for (const language of ["en", "ja"]) test(`${language}: the guide says chat reading stayed off and that downloading asks first`, async () => {
    const messages = readLocale(language);
    for (const key of ["title", "body", "next", "close", "review"]) assert.ok(localeAt(messages, `ocr_setup.${key}`), key);
    const next = localeAt(messages, "ocr_setup.next");
    assert.ok(typeof next === "string");
    assert.match(next, language === "ja" ? /ライセンス/ : /license/);
    // Where the models are is the name of the button under it (#614): the sentence says what to
    // do there and that chat reading is turned on again by hand.
    assert.doesNotMatch(next, language === "ja" ? /設定の「/ : /settings/i);
    assert.match(next, language === "ja" ? /もう一度.*オンにしてください/ : /on again/);
});
