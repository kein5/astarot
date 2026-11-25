import assert from "node:assert/strict";
import { test, vi } from "vitest";
import type { TestContext } from "vitest";
import { componentName, componentOf, find, findIn, hooks, kitStandIns, loadModule, nodesIn, treeNode } from "../../../../../../logics/test/hookHarness.ts";
import type { HookRuntime, TreeNode } from "../../../../../../logics/test/hookHarness.ts";
import { ui_configs } from "../../../../../../logics/ui_configs.ts";

// The VR settings page (Vr.tsx) drawn part by part, each part with hook memory of its own, and
// with the real limits and defaults of the overlay logs (ui_configs). The VR settings hook is a
// stand-in that holds the values the test gives and records every action; the shared rows are
// stand-ins that keep their props.

const t = (key: string, variables?: object) => variables ? `${key} ${JSON.stringify(variables)}` : key;
type Setting = { state: string; data: unknown };
const ok = (data: unknown): Setting => ({ state: "ok", data });
const limits = ui_configs.overlay_small_log;
const smallDefaults = ui_configs.overlay_small_log_default_settings;
const largeDefaults = ui_configs.overlay_large_log_default_settings;
const saved = { ...smallDefaults, x_pos: 0.1, opacity: 0.8, ui_scaling: 1.2, display_duration: 7, fadeout_duration: 3 };

interface PageOptions { values?: Record<string, unknown>; open?: boolean; answer?: (value: unknown) => unknown }

async function vrPage(context: TestContext, options: PageOptions = {}) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const calls: unknown[][] = [], picks: unknown[][] = [], loading = hooks(), runtimes = new Set<HookRuntime>([loading]);
    let active: HookRuntime = loading;
    context.onTestFinished(() => { for (const runtime of runtimes) runtime.unmount(); });
    // The module's React is the hooks of the runtime drawing at the time.
    const react = new Proxy(loading.api, { get: (_, key) => Reflect.get(active.api, key) });
    const values: Record<string, unknown> = { currentOverlaySmallLogSettings: ok(saved), currentOverlayLargeLogSettings: ok(largeDefaults),
        currentIsEnabledOverlaySmallLog: ok(true), currentIsEnabledOverlayLargeLog: ok(false), ...options.values };
    const page = { open: options.open ?? true };
    const vr = new Proxy({}, { get: (_, key) => {
        const name = String(key);
        if (name in values) return values[name];
        if (name.startsWith("current")) return ok(null);
        return (...args: unknown[]) => { calls.push([name, ...args]); return options.answer ? options.answer(args[0]) : { status: 200, result: args[0] }; };
    } });
    const module = await loadModule<typeof import("./Vr.tsx")>(new URL("./Vr.tsx", import.meta.url), { ...loading, api: react }, {
        "@useI18n": { useI18n: () => ({ t }) },
        "@ui_configs": { ui_configs },
        "../_components": { Slider: "slider", SectionLabelComponent: "section-label" },
        "../_components/form_row/FormRow": { FormRow: "form-row" },
        "../_templates/Templates": { RadioButtonContainer: "radio", SwitchContainer: "switch" },
        "../_components/page_pointer/PagePointer": { PagePointer: "page-pointer" },
        "../_components/advanced_section/AdvancedSection": { AdvancedSection: "advanced" },
        "../_components/hint/Hint": { HintDescriptions: "hints" },
        "@common_components": { ResetButton: "reset" },
        "@logics_configs": { useVr: () => vr },
        "@logics_common": { useIsOpenedConfigPage: () => ({ currentIsOpenedConfigPage: { data: page.open } }) },
        "@utils": { randomIntMinMax: (min: number, max: number) => { picks.push([min, max]); return 2; } },
        "./DesktopCaptionOverlay": { DesktopCaptionOverlay: "desktop-caption" },
        "./OverlayFontFamily": { OverlayFontFamily: "overlay-font" },
        "../../../../../common_components/stable_words/StableWords": { StableWords: "stable-words" },
    });
    // Draws one of the module's components with the runtime given (a new one unless given).
    const draw = (type: unknown, props: object = {}, runtime: HookRuntime = hooks()) => {
        runtimes.add(runtime);
        active = runtime;
        const node = treeNode({ type, props });
        assert.ok(node);
        return runtime.render(componentOf(node), props);
    };
    const pageRuntime = hooks();
    const drawPage = () => draw(module.Vr, {}, pageRuntime);
    return { module, calls, picks, values, page, draw, drawPage, pageRuntime };
}
type Page = Awaited<ReturnType<typeof vrPage>>;

// The words a part of the tree shows.
const textOf = (value: unknown): string => {
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (Array.isArray(value)) return value.map(textOf).join("");
    const node = treeNode(value);
    return node ? textOf(node.props.children) : "";
};
const ofType = (tree: unknown, type: unknown) => nodesIn(tree).filter(node => node.type === type);
const part = (tree: unknown, name: string) => findIn(tree, node => componentName(node) === name, name);
const classesOf = (node: TreeNode) => String(node.props.className ?? "").split(" ").filter(Boolean);
// The editor of the log shown on the page, drawn with its own runtime.
function editor(p: Page, props: Record<string, unknown> = {}) {
    const element = part(p.drawPage(), "OverlaySettingsContainer");
    const runtime = hooks();
    let current = { ...element.props, ...props };
    return {
        get props() { return current; },
        draw: (next: Record<string, unknown> = {}) => { current = { ...current, ...next }; return p.draw(element.type, current, runtime); },
        runtime,
    };
}

test("the page turns each caption overlay on, and its advanced line says whether only translations and voice typing are on", async context => {
    const p = await vrPage(context, { values: { currentOverlayShowOnlyTranslatedMessages: ok(true), currentVoiceTypingMode: ok("true") } });
    const tree = p.drawPage();
    assert.equal(tree.type, "hints");
    assert.deepEqual(ofType(tree, "section-label").map(node => [node.props.label, node.props.sub]), [["config_page.vr.section_label_overlay", undefined],
        ["config_page.vr.section_label_overlay_look", true]]);
    const boxes = ofType(tree, "switch").map(node => node.props);
    assert.deepEqual(boxes.map(box => [box.setting_id, box.label]), [["overlay_small_log", "config_page.vr.overlay_enable_single"], ["overlay_large_log", "config_page.vr.overlay_enable_multi"]]);
    assert.deepEqual([boxes[0].variable, boxes[1].variable], [p.values.currentIsEnabledOverlaySmallLog, p.values.currentIsEnabledOverlayLargeLog]);
    boxes[0].toggleFunction();
    boxes[1].toggleFunction();
    assert.deepEqual(p.calls, [["toggleIsEnabledOverlaySmallLog"], ["toggleIsEnabledOverlayLargeLog"]]);
    assert.deepEqual(ofType(tree, "desktop-caption").map(node => node.props.part), ["enable", "details"]);
    // Only a true from the backend counts as on.
    assert.equal(findIn(tree, node => node.type === "advanced").props.status,
        `config_page.advanced_status.vr {"only":"config_page.advanced_status.on","typing":"config_page.advanced_status.off"}`);
    assert.equal(findIn(tree, node => node.props?.["data-setting-id"] === "vr_overlay").type, "div");
    const pointer = findIn(tree, node => node.type === "page-pointer").props;
    assert.deepEqual([pointer.label, pointer.description, pointer.tab, pointer.action], ["config_page.vr.vr_panel_pointer.label", "config_page.vr.vr_panel_pointer.desc",
        "experimental_features", "config_page.vr.vr_panel_pointer.action"]);
    const quiet = await vrPage(context, { values: { currentOverlayShowOnlyTranslatedMessages: ok(false), currentVoiceTypingMode: ok(true) } });
    assert.equal(findIn(quiet.drawPage(), node => node.type === "advanced").props.status,
        `config_page.advanced_status.vr {"only":"config_page.advanced_status.off","typing":"config_page.advanced_status.on"}`);
});

test("the overlay's look is edited for the single line log or the multi-line one, one at a time", async context => {
    const p = await vrPage(context);
    let tree = p.drawPage();
    const switcher = () => findIn(p.drawPage(), node => componentName(node) === "PageSwitcherContainer" && node.props.label_1 === "config_page.vr.single_line");
    assert.deepEqual([switcher().props.label_2, switcher().props.is_selected], ["config_page.vr.multi_lines", true]);
    let shown = part(tree, "OverlaySettingsContainer");
    const keyOf = (node: TreeNode) => String(node.key).replace(/^\.\$/, "");
    assert.deepEqual([keyOf(shown), shown.props.id, shown.props.state, shown.props.current_overlay_settings, shown.props.ui_configs, shown.props.default_ui_configs],
        ["small", "overlay_settings_small", "ok", saved, limits, smallDefaults]);
    shown.props.setOverlaySettings({ x: 1 });
    assert.deepEqual(p.calls.at(-1), ["setOverlaySmallLogSettings", { x: 1 }]);
    p.draw(switcher().type, switcher().props).props.onValueChange("second");
    tree = p.drawPage();
    assert.equal(switcher().props.is_selected, false);
    shown = part(tree, "OverlaySettingsContainer");
    assert.deepEqual([keyOf(shown), shown.props.id, shown.props.current_overlay_settings, shown.props.default_ui_configs, shown.props.ui_configs],
        ["large", "overlay_settings_large", largeDefaults, largeDefaults, ui_configs.overlay_large_log]);
    shown.props.setOverlaySettings({ y: 2 });
    assert.deepEqual(p.calls.at(-1), ["setOverlayLargeLogSettings", { y: 2 }]);
});

test("a switch of what is shown is the kit's ToggleGroup: two radios, the half shown on, each a stop of the Tab key; choosing the other switches", async context => {
    const p = await vrPage(context);
    let toggled = 0;
    const group = (selected: boolean) => p.draw(part(p.drawPage(), "PageSwitcherContainer").type,
        { toggleFunction: () => { toggled++; }, is_selected: selected, label_1: "First", label_2: "Second" });
    const shown = group(true);
    assert.equal(shown.type, kitStandIns.ToggleGroup);
    assert.deepEqual([shown.props.type, shown.props.rovingFocus, shown.props.value, shown.props.className], ["single", false, "first", "controller_type_switch"]);
    const items = ofType(shown, kitStandIns.ToggleGroupItem);
    assert.deepEqual(items.map(item => [item.props.value, textOf(item)]), [["first", "First"], ["second", "Second"]]);
    // Choosing the half shown, or pressing it again (an empty value), changes nothing.
    shown.props.onValueChange("first");
    shown.props.onValueChange("");
    assert.equal(toggled, 0, "choosing the half shown changes nothing");
    shown.props.onValueChange("second");
    assert.equal(toggled, 1);
    const other = group(false);
    assert.equal(other.props.value, "second", "the second half shown");
    other.props.onValueChange("second");
    other.props.onValueChange("");
    assert.equal(toggled, 1);
    other.props.onValueChange("first");
    assert.equal(toggled, 2);
});

test("restoring the defaults puts both logs and the open editor back", async context => {
    const p = await vrPage(context);
    const e = editor(p);
    e.draw();
    findIn(e.draw(), node => componentName(node) === "PositionControls").props.onChangeFunction("x_pos", 0.3);
    const button = findIn(p.drawPage(), node => node.type === kitStandIns.Button && node.props["data-setting-id"] === "restore_default_settings");
    assert.equal(textOf(button), "config_page.vr.restore_default_settings");
    assert.deepEqual([button.props.tone, button.props.className], [undefined, "restore_default_settings_button"], "the kit's plain button, placed by the page");
    button.props.onClick();
    assert.deepEqual(p.calls, [["setOverlaySmallLogSettings", smallDefaults], ["setOverlayLargeLogSettings", largeDefaults]]);
    assert.deepEqual(findIn(e.draw(), node => componentName(node) === "PositionControls").props.settings, smallDefaults);
    vi.advanceTimersByTime(100);
    assert.equal(p.calls.length, 2, "the edit waiting to be sent is dropped");
    // The reset uses the defaults the editor has now, and the editor lets go of it when it closes.
    const other = { ...smallDefaults, tracker: "RightHand", x_pos: 0.25 };
    e.draw({ default_ui_configs: other });
    e.props.resetRef.current();
    assert.deepEqual(findIn(e.draw(), node => componentName(node) === "PositionControls").props.settings, other);
    e.runtime.unmount();
    assert.equal(e.props.resetRef.current, null);
});

test("the editor follows the saved settings while nothing of its own is on its way", async context => {
    let answer: (value: unknown) => void = () => {};
    const p = await vrPage(context, { answer: () => new Promise(resolve => { answer = resolve; }) });
    const e = editor(p);
    const shown = () => findIn(e.draw(), node => componentName(node) === "PositionControls").props.settings;
    assert.deepEqual(shown(), saved);
    const newer = { ...saved, x_pos: 0.2 };
    e.draw({ current_overlay_settings: newer });
    assert.deepEqual(shown(), newer);
    // Not while the saved value is pending.
    e.draw({ current_overlay_settings: { ...saved, x_pos: 0.3 }, state: "pending" });
    assert.equal(shown().x_pos, 0.2);
    e.draw({ state: "ok" });
    assert.equal(shown().x_pos, 0.3);
    // Not while an edit waits to be sent.
    findIn(e.draw(), node => componentName(node) === "PositionControls").props.onChangeFunction("y_pos", 0.4);
    e.draw({ current_overlay_settings: { ...saved, x_pos: 0.35 } });
    assert.deepEqual([shown().x_pos, shown().y_pos], [0.3, 0.4]);
    // Not while it is being sent; once the answer is in, the next saved value is followed.
    vi.advanceTimersByTime(50);
    e.draw({ current_overlay_settings: { ...saved, x_pos: 0.45 } });
    assert.equal(shown().y_pos, 0.4);
    answer(null);
    await Promise.resolve();
    await Promise.resolve();
    e.draw({ current_overlay_settings: { ...saved, x_pos: 0.5 } });
    assert.deepEqual([shown().x_pos, shown().y_pos], [0.5, 0]);
});

test("a save shows what the backend kept, goes back to the saved settings when refused, and keeps the edit without an answer", async context => {
    for (const [reply, expected] of [[{ status: 200, result: { ...saved, x_pos: 0.15 } }, 0.15], [false, 0.1], [{ status: 400, result: null }, 0.1],
        [null, 0.3], [{ status: 0 }, 0.3]] as const) {
        const p = await vrPage(context, { answer: () => reply });
        const e = editor(p);
        findIn(e.draw(), node => componentName(node) === "PositionControls").props.onChangeFunction("x_pos", 0.3);
        vi.advanceTimersByTime(50);
        await Promise.resolve();
        await Promise.resolve();
        assert.equal(findIn(e.draw(), node => componentName(node) === "PositionControls").props.settings.x_pos, expected, JSON.stringify(reply));
        assert.deepEqual(p.calls.at(-1), ["setOverlaySmallLogSettings", { ...saved, x_pos: 0.3 }]);
    }
});

test("the editor's rows: the axes with their switch, the sample text, the other sliders and the tracker", async context => {
    const p = await vrPage(context);
    const e = editor(p);
    let tree = e.draw();
    const rows = ofType(tree, "form-row").map(node => [node.props.label, node.props.description, node.props.group]);
    assert.deepEqual(rows, [["config_page.vr.position_rotation.label", "config_page.vr.position_rotation.desc", true],
        ["config_page.vr.sample_text_button.label", "config_page.vr.sample_text_button.desc", true]]);
    const axes = part(tree, "PageSwitcherContainer").props;
    assert.deepEqual([axes.label_1, axes.label_2, axes.is_selected], ["config_page.vr.position", "config_page.vr.rotation", true]);
    assert.equal(find(tree, node => componentName(node) === "RotationControls"), null);
    axes.toggleFunction();
    tree = e.draw();
    assert.equal(find(tree, node => componentName(node) === "PositionControls"), null);
    const rotation = part(tree, "RotationControls").props;
    assert.deepEqual([rotation.settings, rotation.ui_configs, rotation.default_ui_configs], [saved, limits, smallDefaults]);
    assert.deepEqual([part(tree, "OtherControls").props.settings, part(tree, "OtherControls").props.ui_configs], [saved, limits]);
    const radio = findIn(tree, node => node.type === "radio").props;
    assert.deepEqual([radio.label, radio.name, radio.options, radio.checked_variable, radio.column], ["config_page.vr.tracker", "overlay_settings_small",
        [{ id: "HMD", label: "config_page.vr.hmd" }, { id: "LeftHand", label: "config_page.vr.left_hand" }, { id: "RightHand", label: "config_page.vr.right_hand" }],
        { data: "HMD" }, true]);
    radio.selectFunction("RightHand");
    assert.deepEqual(p.calls.at(-1), ["setOverlaySmallLogSettings", { ...saved, tracker: "RightHand" }], "a tracker is sent at once");
    assert.deepEqual(findIn(e.draw(), node => node.type === "radio").props.checked_variable, { data: "RightHand" });
});

// The sliders of the position or the rotation, drawn with their own runtime.
function axes(p: Page, name: "PositionControls" | "RotationControls", settings: Record<string, unknown>) {
    const changes: unknown[][] = [], selects: unknown[][] = [], runtime = hooks();
    const type = name === "PositionControls" ? p.module.PositionControls : p.module.RotationControls;
    let current = settings;
    const draw = (next?: Record<string, unknown>) => {
        if (next) current = next;
        return p.draw(type, { settings: current, ui_configs: limits, default_ui_configs: smallDefaults,
            onChangeFunction: (...args: unknown[]) => { changes.push(args); }, selectFunction: (...args: unknown[]) => { selects.push(args); } }, runtime);
    };
    return { changes, selects, runtime, draw };
}
const sliderOf = (tree: unknown, label: string) => findIn(tree, node => node.type === "slider" && node.props["aria-label"] === label, `the slider ${label}`).props;
// An axis's step buttons, from the part drawn: [upper, lower].
const stepsOf = (p: Page, tree: unknown, label: string) => {
    const container = findIn(tree, node => componentName(node) === "AdjustButtonContainer" && node.props.label === label);
    return ofType(p.draw(container.type, container.props), "div").filter(node => node.props.role === "button");
};

test("each position axis has its slider within its limits, a reset to its default, and step buttons that stop at the ends", async context => {
    const p = await vrPage(context);
    const a = axes(p, "PositionControls", { ...smallDefaults, x_pos: 0.45, y_pos: -0.8, z_pos: 0 });
    let tree = a.draw();
    for (const [axis, key, orientation, location] of [["x_pos", "x_position", undefined, "top"], ["y_pos", "y_position", "vertical", "right"], ["z_pos", "z_position", "vertical", "left"]] as const) {
        const label = `config_page.vr.${key}`;
        const slider = sliderOf(tree, label);
        assert.deepEqual([slider.no_padding, slider.step, slider.min, slider.max, slider.setter_timing, slider.debounce_ms, slider.orientation,
            slider.valueLabelDisplay, slider.valueLabelDisplayLocation], [true, limits[axis].step, limits[axis].min, limits[axis].max, "on_change", 0, orientation, "auto", location], axis);
        slider.setterFunction(0.2);
        assert.deepEqual(a.changes.at(-1), [axis, 0.2]);
        const heading = findIn(tree, node => node.type === "p" && [node.props.children].flat()[0] === label);
        const reset = findIn(heading, node => node.type === "reset").props;
        assert.equal(reset.label, `${label}: common.reset_to_default`);
        reset.onClickFunction();
        assert.deepEqual(a.selects.at(-1), [axis, smallDefaults[axis]]);
    }
    assert.deepEqual([sliderOf(tree, "config_page.vr.x_position").variable, sliderOf(tree, "config_page.vr.y_position").variable], [0.45, -0.8]);
    // X is one step from its upper end: up once, then no more. Y is at its lower end.
    let [up, down] = stepsOf(p, tree, "config_page.vr.x_position");
    assert.deepEqual([up.props["aria-label"], up.props["aria-disabled"], down.props["aria-label"], down.props["aria-disabled"]],
        [`vr_panel.settings.increase {"label":"config_page.vr.x_position"}`, undefined, `vr_panel.settings.decrease {"label":"config_page.vr.x_position"}`, undefined]);
    up.props.onClick();
    assert.deepEqual(a.changes.at(-1), ["x_pos", 0.5]);
    assert.equal(sliderOf(a.draw(), "config_page.vr.x_position").valueLabelDisplay, "on", "the value shows while stepping");
    vi.advanceTimersByTime(2000);
    assert.equal(sliderOf(a.draw(), "config_page.vr.x_position").valueLabelDisplay, "auto");
    // The ends are found again once the new settings are drawn.
    a.draw({ ...smallDefaults, x_pos: 0.5, y_pos: -0.8, z_pos: 0 });
    tree = a.draw();
    [up, down] = stepsOf(p, tree, "config_page.vr.x_position");
    assert.equal(up.props["aria-disabled"], true);
    const before = a.changes.length;
    up.props.onClick();
    assert.equal(a.changes.length, before, "nothing above the upper end");
    down.props.onClick();
    assert.deepEqual(a.changes.at(-1), ["x_pos", 0.45]);
    assert.equal(sliderOf(a.draw(), "config_page.vr.x_position").valueLabelDisplay, "on", "a step down shows the value too");
    // A second step soon after keeps the value in sight for the full two seconds again.
    vi.advanceTimersByTime(1500);
    stepsOf(p, a.draw(), "config_page.vr.x_position")[1].props.onClick();
    vi.advanceTimersByTime(1000);
    assert.equal(sliderOf(a.draw(), "config_page.vr.x_position").valueLabelDisplay, "on");
    vi.advanceTimersByTime(1000);
    assert.equal(sliderOf(a.draw(), "config_page.vr.x_position").valueLabelDisplay, "auto");
    const [yUp, yDown] = stepsOf(p, tree, "config_page.vr.y_position");
    assert.deepEqual([yUp.props["aria-disabled"], yDown.props["aria-disabled"]], [undefined, true]);
    yDown.props.onClick();
    assert.equal(a.changes.at(-1)?.[0], "x_pos", "nothing below the lower end");
    yUp.props.onClick();
    assert.deepEqual(a.changes.at(-1), ["y_pos", -0.75]);
    // Steps add up without the binary fraction's noise.
    const z = axes(p, "PositionControls", { ...smallDefaults, z_pos: 0.1 });
    stepsOf(p, z.draw(), "config_page.vr.z_position")[0].props.onClick();
    assert.deepEqual(z.changes.at(-1), ["z_pos", 0.15]);
    // Leaving clears the timer that hides the value again.
    stepsOf(p, z.draw(), "config_page.vr.z_position")[0].props.onClick();
    const timers = vi.getTimerCount();
    z.runtime.unmount();
    assert.equal(vi.getTimerCount(), timers - 1);
});

test("the rotation's X slider runs the other way, and its upper button lowers the value", async context => {
    const p = await vrPage(context);
    const a = axes(p, "RotationControls", { ...smallDefaults, x_rotation: 30, y_rotation: 180, z_rotation: -180 });
    const tree = a.draw();
    const x = sliderOf(tree, "config_page.vr.x_rotation");
    assert.deepEqual([x.variable, x.valueLabelFunction(25), x.orientation, x.valueLabelDisplayLocation, x.step, x.min, x.max], [-30, -25, "vertical", "right", 5, -180, 180]);
    x.setterFunction(40);
    assert.deepEqual(a.changes.at(-1), ["x_rotation", -40]);
    const y = sliderOf(tree, "config_page.vr.y_rotation"), z = sliderOf(tree, "config_page.vr.z_rotation");
    assert.deepEqual([y.variable, y.orientation, y.valueLabelDisplayLocation, z.variable, z.orientation, z.valueLabelDisplayLocation], [180, undefined, "top", -180, "vertical", "left"]);
    y.setterFunction(10);
    z.setterFunction(-10);
    assert.deepEqual(a.changes.slice(-2), [["y_rotation", 10], ["z_rotation", -10]]);
    for (const axis of ["x_rotation", "y_rotation", "z_rotation"] as const) {
        const heading = findIn(tree, node => node.type === "p" && [node.props.children].flat()[0] === `config_page.vr.${axis}`);
        const reset = findIn(heading, node => node.type === "reset").props;
        assert.equal(reset.label, `config_page.vr.${axis}: common.reset_to_default`);
        reset.onClickFunction();
        assert.deepEqual(a.selects.at(-1), [axis, smallDefaults[axis]]);
        assert.equal(sliderOf(tree, `config_page.vr.${axis}`).no_padding, true);
    }
    const [up, down] = stepsOf(p, tree, "config_page.vr.x_rotation");
    assert.deepEqual([up.props["aria-label"], down.props["aria-label"]], [`vr_panel.settings.decrease {"label":"config_page.vr.x_rotation"}`,
        `vr_panel.settings.increase {"label":"config_page.vr.x_rotation"}`]);
    up.props.onClick();
    assert.deepEqual(a.changes.at(-1), ["x_rotation", 25]);
    down.props.onClick();
    assert.deepEqual(a.changes.at(-1), ["x_rotation", 35]);
    // Y at its upper end and Z at its lower one.
    const [yUp] = stepsOf(p, tree, "config_page.vr.y_rotation");
    const [, zDown] = stepsOf(p, tree, "config_page.vr.z_rotation");
    assert.deepEqual([yUp.props["aria-disabled"], zDown.props["aria-disabled"]], [true, true]);
    // X at its lowest: its upper button, which lowers it, stops.
    const low = axes(p, "RotationControls", { ...smallDefaults, x_rotation: -180 });
    const [lowUp, lowDown] = stepsOf(p, low.draw(), "config_page.vr.x_rotation");
    assert.deepEqual([lowUp.props["aria-disabled"], lowDown.props["aria-disabled"]], [true, undefined]);
});

test("a step button is pressed with a click, Space or Enter, is marked when it cannot go further, and names its axis only when given one", async context => {
    const p = await vrPage(context);
    const tree = axes(p, "PositionControls", smallDefaults).draw();
    const container = findIn(tree, node => componentName(node) === "AdjustButtonContainer");
    const runs: string[] = [];
    const draw = (props: object) => ofType(p.draw(container.type, { countUp: () => { runs.push("up"); }, countDown: () => { runs.push("down"); }, ...props }), "div")
        .filter(node => node.props.role === "button");
    const [up, down] = draw({ is_max: false, is_min: true, label: "Height" });
    assert.deepEqual([up.props.tabIndex, up.props["aria-disabled"], down.props["aria-disabled"]], [0, undefined, true]);
    assert.equal(classesOf(down).length, classesOf(up).length, "the lower one, marked as at its end, and the upper one, marked as the upper");
    let prevented = 0;
    const press = (key: string) => { up.props.onKeyDown({ key, preventDefault: () => { prevented++; } }); return [runs.length, prevented]; };
    assert.deepEqual(press(" "), [1, 1]);
    assert.deepEqual(press("Enter"), [2, 2]);
    assert.deepEqual(press("ArrowUp"), [2, 2], "other keys do nothing");
    down.props.onClick();
    assert.deepEqual(runs, ["up", "up", "down"]);
    const [plainUp, plainDown] = draw({ is_max: false, is_min: false });
    assert.deepEqual([plainUp.props["aria-label"], plainDown.props["aria-label"]], [undefined, undefined]);
    assert.equal(classesOf(plainUp).length, classesOf(plainDown).length + 1, "the upper one is marked as such");
    const wrapper = p.draw(container.type, { countUp() {}, countDown() {}, is_max: false, is_min: false, wrapper_class_name: "given" });
    assert.equal(wrapper.props.className, "given");
});

test("the other sliders: opacity and size in percent, how long a message stays and how long it fades, in seconds", async context => {
    const p = await vrPage(context);
    const changes: unknown[][] = [];
    const tree = p.draw(part(editor(p).draw(), "OtherControls").type, { settings: saved, ui_configs: limits, onChangeFunction: (...args: unknown[]) => { changes.push(args); } });
    const headings = ofType(tree, "p").map(node => [[node.props.children].flat()[0], textOf(findIn(node, inner => inner.type === "span"))]);
    assert.deepEqual(headings, [["config_page.vr.opacity", "80%"], ["config_page.vr.ui_scaling", "120%"],
        ["config_page.vr.display_duration", `config_page.common.duration_seconds {"count":7}`], ["config_page.vr.fadeout_duration", `config_page.common.duration_seconds {"count":3}`]]);
    const opacity = sliderOf(tree, "config_page.vr.opacity");
    assert.deepEqual([opacity.no_padding, opacity.variable, opacity.valueLabelFunction(79.6), opacity.valueLabelFormat, opacity.step, opacity.min, opacity.max, opacity.setter_timing,
        opacity.debounce_ms], [true, 80, "80", "value %", 5, 10, 100, "on_change", 0]);
    opacity.setterFunction(55);
    const scaling = sliderOf(tree, "config_page.vr.ui_scaling");
    assert.deepEqual([scaling.no_padding, scaling.variable, scaling.valueLabelFunction(120.4), scaling.valueLabelFormat, scaling.step, scaling.min, scaling.max],
        [true, 120, "120", "value %", limits.ui_scaling.step, limits.ui_scaling.min, limits.ui_scaling.max]);
    scaling.setterFunction(150);
    const duration = sliderOf(tree, "config_page.vr.display_duration");
    assert.deepEqual([duration.no_padding, duration.variable, duration.valueLabelFormat("12"), duration.step, duration.min, duration.max, duration.debounce_ms],
        [true, 7, `config_page.common.duration_seconds {"count":12}`, 1, 1, 60, 0]);
    duration.setterFunction(9);
    const fadeout = sliderOf(tree, "config_page.vr.fadeout_duration");
    assert.deepEqual([fadeout.no_padding, fadeout.variable, fadeout.valueLabelFormat(4), fadeout.step, fadeout.min, fadeout.max, fadeout.setter_timing],
        [true, 3, `config_page.common.duration_seconds {"count":4}`, 1, 0, 5, "on_change"]);
    fadeout.setterFunction(1);
    assert.deepEqual(changes, [["opacity", 0.55], ["ui_scaling", 1.5], ["display_duration", 9], ["fadeout_duration", 1]]);
});

test("the common settings show only translations, voice typing and the font, each with its own switch", async context => {
    const p = await vrPage(context, { values: { currentOverlayShowOnlyTranslatedMessages: ok(true), currentVoiceTypingMode: ok(false) } });
    const common = p.draw(part(p.drawPage(), "CommonSettingsContainer").type);
    assert.deepEqual(ofType(common, "section-label").map(node => [node.props.label, node.props.sub]), [["config_page.vr.common_settings", true]]);
    const boxes = ofType(common, "switch").map(node => node.props);
    assert.deepEqual(boxes.map(box => [box.label, box.desc, box.variable]), [
        ["config_page.vr.overlay_show_only_translated_messages.label", undefined, p.values.currentOverlayShowOnlyTranslatedMessages],
        ["config_page.vr.voice_typing_mode.label", "config_page.vr.voice_typing_mode.desc", p.values.currentVoiceTypingMode]]);
    boxes[0].toggleFunction();
    boxes[1].toggleFunction();
    assert.deepEqual(p.calls, [["toggleOverlayShowOnlyTranslatedMessages"], ["toggleVoiceTypingMode"]]);
    assert.ok(find(common, node => node.type === "overlay-font"));
});

test("sample text needs an overlay turned on: without one the button waits and says why, and turning them off stops the samples", async context => {
    const p = await vrPage(context, { values: { currentIsEnabledOverlaySmallLog: ok(false), currentIsEnabledOverlayLargeLog: ok(false) } });
    const runtime = hooks();
    const sample = part(editor(p).draw(), "SendSampleTextToggleButton");
    const draw = () => p.draw(sample.type, {}, runtime);
    let tree = draw();
    let button = findIn(tree, node => node.type === kitStandIns.Button);
    const note = findIn(tree, node => node.type === "p");
    assert.deepEqual([button.props.disabled, button.props["aria-describedby"], note.props.id, textOf(note)],
        [true, note.props.id, note.props.id, "config_page.vr.sample_text_button.needs_overlay"]);
    button.props.onClick();
    assert.equal(findIn(draw(), node => node.type === kitStandIns.Button).props["aria-label"], "config_page.vr.sample_text_button.start", "pressed anyway, nothing starts");
    // The multi-line log alone is enough.
    p.values.currentIsEnabledOverlayLargeLog = ok(true);
    tree = draw();
    button = findIn(tree, node => node.type === kitStandIns.Button);
    assert.deepEqual([button.props.disabled, button.props["aria-describedby"], find(tree, node => node.type === "p")], [false, undefined, null]);
    const idleIcon = [button.props.children].flat()[0].type;
    // The kit's plain button, Lilac (primary) while it sends.
    assert.equal(button.props.tone, "plain");
    button.props.onClick();
    button = findIn(draw(), node => node.type === kitStandIns.Button);
    assert.deepEqual([button.props["aria-label"], button.props.tone], ["config_page.vr.sample_text_button.stop", "primary"]);
    assert.notEqual([button.props.children].flat()[0].type, idleIcon, "a stop square while it sends");
    vi.advanceTimersByTime(1000);
    assert.deepEqual(p.calls.at(-1), ["sendTextToOverlay", "config_page.vr.sample_text_button.sample_text config_page.vr.sample_text_button.sample_text"]);
    assert.deepEqual(p.picks.at(-1), [1, 5], "one to five samples");
    // Both logs off: the samples stop, and turning one on again does not restart them.
    p.values.currentIsEnabledOverlayLargeLog = ok(false);
    draw();
    const sent = p.calls.length;
    vi.advanceTimersByTime(3000);
    assert.equal(p.calls.length, sent);
    p.values.currentIsEnabledOverlaySmallLog = ok(true);
    button = findIn(draw(), node => node.type === kitStandIns.Button);
    assert.equal(button.props["aria-label"], "config_page.vr.sample_text_button.start");
    // The step buttons' triangle is the start icon.
    assert.equal([button.props.children].flat()[0].type, idleIcon);
    // Closing settings stops the samples; opening them again does not restart them.
    findIn(draw(), node => node.type === kitStandIns.Button).props.onClick();
    assert.equal(findIn(draw(), node => node.type === kitStandIns.Button).props["aria-label"], "config_page.vr.sample_text_button.stop");
    p.page.open = false;
    draw();
    p.page.open = true;
    assert.equal(findIn(draw(), node => node.type === kitStandIns.Button).props["aria-label"], "config_page.vr.sample_text_button.start");
    const quietCalls = p.calls.length;
    vi.advanceTimersByTime(3000);
    assert.equal(p.calls.length, quietCalls);
    // Without either setting known yet, there is no overlay to send to.
    const unknown = await vrPage(context, { values: { currentIsEnabledOverlaySmallLog: undefined, currentIsEnabledOverlayLargeLog: undefined } });
    const quiet = part(editor(unknown).draw(), "SendSampleTextToggleButton");
    assert.equal(findIn(unknown.draw(quiet.type), node => node.type === kitStandIns.Button).props.disabled, true);
});
