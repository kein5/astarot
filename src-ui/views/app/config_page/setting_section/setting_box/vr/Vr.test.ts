import assert from "node:assert/strict";
import { test, vi } from "vitest";
import type { TestContext } from "vitest";
import { hooks, loadModule, find, findIn, componentName, componentOf, drawWith } from "../../../../../../logics/test/hookHarness.ts";
import type { HookRuntime } from "../../../../../../logics/test/hookHarness.ts";

// The hook of that name in the runtime: one the runtime does not have fails where it is called.
const hookOf = (runtime: HookRuntime, name: string) => {
    const hook: unknown = Reflect.get(runtime.api, name);
    assert.ok(typeof hook === "function", name);
    return hook;
};

async function setup(context: TestContext) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const controls = hooks(), parent = hooks(), writes: Record<string, unknown>[] = [];
    let active: HookRuntime = parent;
    const bindings = { ...controls, api: { ...controls.api,
        useState: <S>(initial: S | (() => S)) => active.api.useState(initial),
        useRef: <T>(initial: T) => active.api.useRef(initial),
    } };
    context.onTestFinished(() => controls.unmount());
    const saved = { tracker: "HMD", x_pos: 0, y_pos: 0 };
    const { Vr } = await loadModule<typeof import("./Vr.tsx")>(new URL("./Vr.tsx", import.meta.url), bindings, {
        "@ui_configs": { ui_configs: {} }, "../_components": { Slider: "slider", SectionLabelComponent: "section" }, "../_components/form_row/FormRow": { FormRow: "form-row" },
        "../_templates/Templates": { RadioButtonContainer: "radio", CheckboxContainer: "checkbox", ActionButtonContainer: "action" },
        "@common_components": { ResetButton: "reset" }, "../../../../../common_components/stable_words/StableWords": { StableWords: "stable-words" }, "../_components/page_pointer/PagePointer": { PagePointer: "pointer" }, "../_components/advanced_section/AdvancedSection": { AdvancedSection: "advanced" }, "@utils": {},
        "../_components/hint/Hint": { HintDescriptions: "hints", Hint: "hint", useHintDescriptions: () => false },
        "./DesktopCaptionOverlay": { DesktopCaptionOverlay: "desktop" },
        "./OverlayFontFamily": { OverlayFontFamily: "font" },
        "@logics_configs": { useVr: () => ({ currentOverlaySmallLogSettings: { data: saved, state: "ok" } }) },
        "@logics_common": { useIsOpenedConfigPage: () => ({ currentIsOpenedConfigPage: { data: true } }) },
    });
    const node = findIn(parent.render(Vr), item => componentName(item) === "OverlaySettingsContainer");
    active = controls;
    // One of the page's own components, which the test draws itself with the runtime.
    const target = componentOf(node);
    const props = { ...node.props, default_ui_configs: saved, setOverlaySettings: (value: Record<string, unknown>) => { writes.push(value); return true; } };
    const render = () => { controls.render(target, props); return controls.render(target, props); };
    const handlers = () => findIn(render(), item => item.props?.selectFunction && item.props?.onChangeFunction).props;
    return { props, handlers, writes, render, unmount: controls.unmount };
}

for (const reset of [false, true]) test(`VR pending position write preserves the newer ${reset ? "axis reset" : "tracker selection"}`, async context => {
    const s = await setup(context);
    s.handlers().onChangeFunction("x_pos", 0.1);
    vi.advanceTimersByTime(10);
    s.handlers().selectFunction(reset ? "x_pos" : "tracker", reset ? 0 : "LeftHand");
    vi.advanceTimersByTime(300);
    assert.equal(s.writes.at(-1)?.tracker, reset ? "HMD" : "LeftHand");
    assert.equal(s.writes.at(-1)?.x_pos, reset ? 0 : 0.1);
    assert.equal(s.writes.length, 1);
    s.handlers().onChangeFunction("y_pos", 0.2);
    vi.advanceTimersByTime(50);
    assert.equal(s.writes.at(-1)?.tracker, reset ? "HMD" : "LeftHand");
    assert.equal(s.writes.at(-1)?.y_pos, 0.2);
});

test("VR editor cancels delayed writes on unmount", async context => {
    const s = await setup(context);
    s.handlers().onChangeFunction("x_pos", 0.1);
    s.unmount(); vi.advanceTimersByTime(300);
    assert.deepEqual(s.writes, []);
});

test("an older VR save response cannot replace the latest tracker draft", async context => {
    const s = await setup(context), requests: { value: unknown; resolve: (answer: unknown) => void }[] = [];
    s.props.setOverlaySettings = (value: unknown) => new Promise(resolve => requests.push({ value, resolve }));
    s.handlers().onChangeFunction("x_pos", 0.1);
    vi.advanceTimersByTime(50);
    s.props.state = "pending";
    s.handlers().selectFunction("tracker", "LeftHand");
    s.props.current_overlay_settings = requests[0].value;
    s.props.state = "ok";
    s.handlers();
    requests[0].resolve({ status: 200, result: requests[0].value });
    await Promise.resolve();
    assert.equal(s.handlers().settings.tracker, "LeftHand");
    requests[1].resolve({ status: 200, result: requests[1].value });
    await Promise.resolve();
    assert.equal(s.handlers().settings.tracker, "LeftHand");
});

test("closing settings stops the overlay sample text, and reopening does not restart it", async context => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    // The settings page stays mounted while closed, so the button sees the
    // closed state instead of unmounting.
    const runtimes = { vr: hooks(), overlay: hooks(), button: hooks() }, sent: string[] = [];
    let active = runtimes.vr, open = true;
    // The hook of that name in whichever runtime is drawing now, called as the page calls it.
    const delegate = (name: string) => (...args: unknown[]): unknown => Reflect.apply(hookOf(active, name), undefined, args);
    const api = { ...runtimes.button.api };
    for (const name of ["useState", "useRef", "useEffect", "useLayoutEffect", "useMemo", "useCallback", "useId"]) Reflect.set(api, name, delegate(name));
    context.onTestFinished(() => Object.values(runtimes).forEach(runtime => { runtime.unmount(); }));
    const saved = { tracker: "HMD" };
    // As react-i18next does, t stays the same function while the UI language does.
    const words = { en: (key: string) => key, ja: (key: string) => `ja:${key}` };
    let language: keyof typeof words = "en";
    const { Vr } = await loadModule<typeof import("./Vr.tsx")>(new URL("./Vr.tsx", import.meta.url), { ...runtimes.button, api }, {
        "@useI18n": { useI18n: () => ({ t: words[language] }) },
        "./DesktopCaptionOverlay": { DesktopCaptionOverlay: "desktop" },
        "./OverlayFontFamily": { OverlayFontFamily: "font" },
        "@ui_configs": { ui_configs: {} }, "../_components": { Slider: "slider", SectionLabelComponent: "section" }, "../_components/form_row/FormRow": { FormRow: "form-row" },
        "../_templates/Templates": { RadioButtonContainer: "radio", CheckboxContainer: "checkbox", ActionButtonContainer: "action" },
        "@common_components": { ResetButton: "reset" }, "../../../../../common_components/stable_words/StableWords": { StableWords: "stable-words" }, "../_components/page_pointer/PagePointer": { PagePointer: "pointer" }, "../_components/advanced_section/AdvancedSection": { AdvancedSection: "advanced" }, "@utils": { randomIntMinMax: () => 1 },
        "../_components/hint/Hint": { HintDescriptions: "hints", Hint: "hint", useHintDescriptions: () => false },
        "@logics_configs": { useVr: () => ({ currentOverlaySmallLogSettings: { data: saved, state: "ok" },
            sendTextToOverlay: (text: string) => sent.push(text) }) },
        "@logics_common": { useIsOpenedConfigPage: () => ({ currentIsOpenedConfigPage: { data: open } }) },
    });
    const overlay = findIn(runtimes.vr.render(Vr), item => componentName(item) === "OverlaySettingsContainer");
    active = runtimes.overlay;
    const sample = findIn(drawWith(runtimes.overlay, overlay), item => componentName(item) === "SendSampleTextToggleButton");
    active = runtimes.button;
    const button = () => findIn(drawWith(runtimes.button, sample, {}), item => item.type === "button");

    const START = "config_page.vr.sample_text_button.start", STOP = "config_page.vr.sample_text_button.stop";
    // #912: the words keep the longer one's width, so the button does not shrink when pressed.
    const shown = () => findIn(button(), item => item.type === "stable-words").props;
    assert.deepEqual([shown().current, shown().words], [START, [START, STOP]]);
    button().props.onClick();
    assert.equal(button().props["aria-label"], STOP);
    assert.deepEqual([shown().current, shown().words], [STOP, [START, STOP]]);
    vi.advanceTimersByTime(2000);
    assert.equal(sent.length, 2);

    open = false;
    // The first render after closing already matches what is being sent.
    assert.equal(button().props["aria-label"], START);
    vi.advanceTimersByTime(5000);
    assert.equal(sent.length, 2);

    // The closed page is inert; even so, nothing can start while it is closed.
    button().props.onClick();
    assert.equal(button().props["aria-label"], START);
    vi.advanceTimersByTime(5000);
    assert.equal(sent.length, 2);

    open = true;
    assert.equal(button().props["aria-label"], START);
    vi.advanceTimersByTime(5000);
    assert.equal(sent.length, 2);

    // Only the button starts it again, and it stops the same way.
    button().props.onClick();
    assert.equal(button().props["aria-label"], STOP);
    vi.advanceTimersByTime(1000);
    assert.equal(sent.length, 3);
    button().props.onClick();
    assert.equal(button().props["aria-label"], START);
    vi.advanceTimersByTime(5000);
    assert.equal(sent.length, 3);

    // #904: the VR panel's settings can change the UI language while this sends. The samples sent
    // after it are in the new language.
    const SAMPLE = "config_page.vr.sample_text_button.sample_text";
    button().props.onClick();
    assert.equal(button().props["aria-label"], STOP);
    vi.advanceTimersByTime(1000);
    assert.deepEqual(sent.slice(3), [SAMPLE]);
    language = "ja";
    button();
    vi.advanceTimersByTime(1000);
    assert.deepEqual(sent.slice(3), [SAMPLE, `ja:${SAMPLE}`]);
});

test("restoring all VR defaults cancels the editor's pending position write", async context => {
    const s = await setup(context);
    s.handlers().onChangeFunction("x_pos", 0.1);
    s.props.resetRef.current();
    vi.advanceTimersByTime(300);
    assert.deepEqual(s.writes, []);
    assert.equal(s.handlers().settings.x_pos, 0);
});

test("the position and rotation diagram and the sample text are rows of the label and field columns (#568)", async context => {
    const rendered = (await setup(context)).render();
    const row = (label: string) => find(rendered, item => item.type === "form-row" && item.props.label === label);
    const axes = row("config_page.vr.position_rotation.label");
    assert.ok(axes, "the axes have a labelled row");
    assert.equal(axes.props.description, "config_page.vr.position_rotation.desc");
    assert.ok(find(axes, item => componentName(item) === "PositionControls"), "the diagram is in the row's field column");
    assert.ok(find(axes, item => componentName(item) === "PageSwitcherContainer"), "so is the position/rotation switch");
    const sample = row("config_page.vr.sample_text_button.label");
    assert.ok(sample && find(sample, item => componentName(item) === "SendSampleTextToggleButton"));
});
