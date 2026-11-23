import assert from "node:assert/strict";
import { test } from "vitest";
import { componentName, draw, find, findIn, hooks, loadModule, nodesIn, treeNode } from "../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../logics/test/hookHarness.ts";

// The rows of the VR settings window. A setting is changed with a switch, a list opened in place
// of the rows, or − and ＋ (no sliders: the laser shakes). A setting whose change is on its way
// cannot be changed again, and says so. The list itself (VrPickerList) is a stand-in here.

const t = (key: string, variables?: object) => variables ? `${key} ${JSON.stringify(variables)}` : key;

async function rows() {
    const runtime = hooks();
    const module = await loadModule<typeof import("./VrSettingsRows.tsx")>(new URL("./VrSettingsRows.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t }) },
        "./VrPickerList": { VrPickerList: "picker-list" },
    });
    return { ...module, runtime };
}

// The words a part of the tree shows.
const textOf = (value: unknown): string => {
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (Array.isArray(value)) return value.map(textOf).join("");
    const node = treeNode(value);
    return node ? textOf(node.props.children) : "";
};
const classesOf = (node: TreeNode) => String(node.props.className ?? "").split(" ").filter(Boolean);
const statusOf = (tree: unknown) => nodesIn(tree).filter(node => node.props.role === "status").map(textOf);
const ok = (data: unknown) => ({ state: "ok", data });
const pending = (data: unknown) => ({ state: "pending", data });

// A press on a row's button: what it called.
function presses() {
    const calls: unknown[][] = [];
    const record = (name: string) => (...args: unknown[]) => { calls.push([name, ...args]); };
    return { calls, record };
}

// The two step buttons and the value between them, as drawn by the row's stepper.
function stepper(tree: TreeNode) {
    const drawn = draw(findIn(tree, node => componentName(node) === "Stepper", "the stepper"));
    const [decrease, value, increase]: TreeNode[] = drawn.props.children;
    const output = findIn(value, node => node.type === "output", "the value");
    return { drawn, value, output, decrease: draw(decrease), increase: draw(increase) };
}
const enabled = (button: TreeNode) => button.props["aria-disabled"] === false && !classesOf(button).includes("is_disabled");

test("a section starts with its name as a heading", async () => {
    const { SectionLabel } = await rows();
    const heading = SectionLabel({ label: "Microphone" });
    assert.deepEqual([heading.type, heading.props.children], ["h2", "Microphone"]);
});

test("a switch row says whether it is on, and turns it on or off when pressed", async () => {
    const { ToggleRow } = await rows();
    const { calls, record } = presses();
    const on = ToggleRow({ label: "Hiragana", variable: ok(true), onToggle: record("toggle") });
    assert.deepEqual([on.type, on.props.role, on.props["aria-checked"], on.props.disabled, on.props["aria-disabled"], on.props["aria-busy"]],
        ["button", "switch", true, false, false, false]);
    assert.equal(textOf(on), "Hiragana");
    assert.deepEqual(statusOf(on), []);
    assert.equal(classesOf(on).includes("is_disabled"), false);
    on.props.onClick();
    assert.deepEqual(calls, [["toggle"]]);
    // Only true is on: a missing or other value is off.
    for (const data of [false, null, "true", 1]) assert.equal(ToggleRow({ label: "Hiragana", variable: ok(data), onToggle() {} }).props["aria-checked"], false);
    // A line under its name, when it has one.
    const described = ToggleRow({ label: "Tooltips", sub: "What a button does", variable: ok(false), onToggle() {} });
    assert.equal(textOf(described), "TooltipsWhat a button does");
});

test("a switch whose change is on its way says so and cannot be pressed again", async () => {
    const { ToggleRow } = await rows();
    const { calls, record } = presses();
    const row = ToggleRow({ label: "Hiragana", variable: pending(true), onToggle: record("toggle") });
    assert.deepEqual([row.props.disabled, row.props["aria-disabled"], row.props["aria-busy"]], [false, true, true]);
    assert.deepEqual(statusOf(row), ["vr_panel.settings.changing"]);
    row.props.onClick();
    assert.deepEqual(calls, []);
    // Pending and unavailable: still reachable, so that the change can be read out; the wait is what it says.
    const both = ToggleRow({ label: "Mute sync", variable: pending(true), onToggle: record("toggle"), is_disabled: true, disabled_reason: "No OSC" });
    assert.deepEqual([both.props.disabled, both.props["aria-disabled"]], [false, true]);
    assert.equal(textOf(both), "Mute syncvr_panel.settings.changing");
    both.props.onClick();
    assert.deepEqual(calls, []);
});

test("an unavailable switch is greyed out, says why, and does nothing", async () => {
    const { ToggleRow } = await rows();
    const { calls, record } = presses();
    const row = ToggleRow({ label: "Mute sync", variable: ok(false), onToggle: record("toggle"), is_disabled: true, disabled_reason: "No OSC" });
    assert.deepEqual([row.props.disabled, row.props["aria-disabled"], row.props["aria-busy"]], [true, true, false]);
    assert.ok(classesOf(row).includes("is_disabled"));
    assert.equal(textOf(row), "Mute syncNo OSC");
    // The reason is a note, not a status that is read out when it appears.
    assert.deepEqual(statusOf(row), []);
    row.props.onClick();
    assert.deepEqual(calls, []);
    assert.equal(textOf(ToggleRow({ label: "Mute sync", variable: ok(false), onToggle() {}, is_disabled: true })), "Mute syncvr_panel.settings.unavailable");
});

test("a row that opens a list shows the value in use, and opens the list only when it can be changed", async () => {
    const { SelectRow } = await rows();
    const { calls, record } = presses();
    const row = SelectRow({ label: "Font", value: "Noto Sans", onOpen: record("open") });
    assert.equal(row.type, "button");
    assert.deepEqual([row.props.disabled, row.props["aria-disabled"], row.props["aria-busy"]], [false, false, false]);
    const [label, value, chevron]: TreeNode[] = row.props.children;
    assert.deepEqual([textOf(label), textOf(value), textOf(chevron), chevron.props["aria-hidden"]], ["Font", "Noto Sans", "›", "true"]);
    assert.deepEqual(statusOf(row), []);
    row.props.onClick();
    assert.deepEqual(calls, [["open"]]);

    const waiting = SelectRow({ label: "Font", value: "Noto Sans", is_pending: true, is_disabled: true, onOpen: record("open") });
    assert.deepEqual([waiting.props.disabled, waiting.props["aria-disabled"], waiting.props["aria-busy"]], [false, true, true]);
    assert.deepEqual(statusOf(waiting), ["vr_panel.settings.changing"]);
    waiting.props.onClick();
    const none = SelectRow({ label: "Font", value: "", is_disabled: true, disabled_reason: "No fonts", onOpen: record("open") });
    assert.deepEqual([none.props.disabled, none.props["aria-disabled"], none.props["aria-busy"]], [true, true, false]);
    assert.ok(classesOf(none).includes("is_disabled"));
    assert.deepEqual(statusOf(none), ["No fonts"]);
    none.props.onClick();
    assert.deepEqual(statusOf(SelectRow({ label: "Font", is_disabled: true, onOpen() {} })), ["vr_panel.settings.unavailable"]);
    assert.deepEqual(calls, [["open"]]);
    assert.equal(classesOf(row).includes("is_disabled"), false);
});

test("a value longer than 24 characters gets a line of its own", async () => {
    const { SelectRow } = await rows();
    const long = (value: string | number | undefined) => classesOf(SelectRow({ label: "Device", value, onOpen() {} })).includes("select_long");
    assert.deepEqual([long("x".repeat(24)), long("x".repeat(25)), long(undefined), long(1234567890)], [false, true, false, false]);
});

test("a number row steps by its step, keeps to its range and rounds away the float error", async () => {
    const { StepperRow } = await rows();
    const set: number[] = [];
    const row = (data: unknown, step: number, min: number, max: number, format?: (value: number) => string) =>
        StepperRow({ label: "Opacity", variable: ok(data), setValue: value => set.push(value), min, max, step, format });
    const middle = stepper(row(0.2, 0.1, 0.2, 1, value => `${Math.round(value * 100)}%`));
    assert.equal(middle.output.props.children, "20%");
    assert.deepEqual([middle.output.props["aria-live"], middle.output.props["aria-label"]], ["polite", "Opacity"]);
    assert.equal(enabled(middle.decrease), false, "at the lower end");
    assert.equal(enabled(middle.increase), true);
    middle.increase.props.onClick();
    middle.decrease.props.onClick();
    // 0.2 + 0.1 is 0.30000000000000004 in floating point.
    assert.deepEqual(set.splice(0), [0.3]);
    const top = stepper(row(0.95, 0.1, 0.2, 1));
    assert.equal(top.output.props.children, 0.95, "without a format, the number itself");
    top.increase.props.onClick();
    assert.deepEqual(set.splice(0), [1], "no further than the top");
    const bottom = stepper(row(0.25, 0.1, 0.2, 1));
    bottom.decrease.props.onClick();
    assert.deepEqual(set.splice(0), [0.2], "no further than the bottom");
    // The step's decimals decide the rounding: 0.01 keeps two, 1 keeps none.
    const fine = stepper(row(0.5, 0.01, 0.1, 0.99));
    fine.increase.props.onClick();
    fine.decrease.props.onClick();
    const whole = stepper(row("3", 1, 0, 30));
    whole.increase.props.onClick();
    whole.decrease.props.onClick();
    assert.deepEqual(set, [0.51, 0.49, 4, 2]);
    const end = stepper(row(30, 1, 0, 30));
    assert.deepEqual([enabled(end.decrease), enabled(end.increase)], [true, false], "at the upper end");
    end.increase.props.onClick();
    assert.deepEqual(set, [0.51, 0.49, 4, 2]);
});

test("a number row's buttons name what they change, and wait while a change is on its way", async () => {
    const { StepperRow } = await rows();
    const set: number[] = [];
    const tree = StepperRow({ label: "Record timeout", sub: "seconds", variable: pending(3), setValue: value => set.push(value), min: 0, max: 30, step: 1 });
    assert.equal(textOf(findIn(tree, node => node.type === "span")), "Record timeoutseconds");
    const view = stepper(tree);
    assert.deepEqual([view.decrease.props["aria-label"], view.increase.props["aria-label"]],
        ['vr_panel.settings.decrease {"label":"Record timeout"}', 'vr_panel.settings.increase {"label":"Record timeout"}']);
    assert.deepEqual([textOf(view.decrease), textOf(view.increase)], ["−", "＋"]);
    assert.equal(view.drawn.props["aria-busy"], true);
    assert.deepEqual(statusOf(view.value), ["vr_panel.settings.changing_short"]);
    assert.deepEqual([enabled(view.decrease), enabled(view.increase)], [false, false]);
    view.decrease.props.onClick();
    view.increase.props.onClick();
    // The stepper guards the press as well, whatever its buttons do.
    const drawnButtons: TreeNode[] = view.drawn.props.children;
    drawnButtons[0].props.onClick();
    drawnButtons[2].props.onClick();
    assert.equal(set.length, 0);
    // Settled: the buttons step.
    const settled = stepper(StepperRow({ label: "Record timeout", variable: ok(3), setValue: value => set.push(value), min: 0, max: 30, step: 1 }));
    assert.equal(settled.drawn.props["aria-busy"], false);
    assert.deepEqual(statusOf(settled.value), []);
    const settledButtons: TreeNode[] = settled.drawn.props.children;
    settledButtons[0].props.onClick();
    settledButtons[2].props.onClick();
    assert.deepEqual(set, [2, 4]);
});

test("a disabled number row shows its value greyed out and cannot be stepped", async () => {
    const { StepperRow } = await rows();
    const set: number[] = [];
    const view = stepper(StepperRow({ label: "Threshold", variable: ok(300), setValue: value => set.push(value), min: 0, max: 2000, step: 50, is_disabled: true }));
    assert.ok(classesOf(view.value).includes("is_disabled"));
    assert.deepEqual([enabled(view.decrease), enabled(view.increase)], [false, false]);
    const buttons: TreeNode[] = view.drawn.props.children;
    buttons[0].props.onClick();
    buttons[2].props.onClick();
    assert.deepEqual(set, []);
    assert.equal(view.drawn.props["aria-busy"], false);
    const open = stepper(StepperRow({ label: "Threshold", variable: ok(300), setValue() {}, min: 0, max: 2000, step: 50 }));
    assert.equal(classesOf(open.value).includes("is_disabled"), false);
});

test("a choice of two or three is pressed directly; the one in use is filled", async () => {
    const { SegmentRow } = await rows();
    const { calls, record } = presses();
    const options = [{ id: "LeftHand", label: "Left", icon: "L-icon" }, { id: "RightHand", label: "Right" }];
    const row = SegmentRow({ label: "Hand", sub: "for the launcher", variable: ok("LeftHand"), options, onSelect: record("select") });
    assert.equal(row.props["aria-busy"], false);
    assert.equal(textOf(row.props.children[0]), "Handfor the launcher");
    const buttons: TreeNode[] = row.props.children[1].props.children;
    assert.deepEqual(buttons.map(button => [button.key, textOf(button), button.props["aria-pressed"], button.props["aria-disabled"], classesOf(button).includes("is_on")]), [
        ["LeftHand", "L-iconLeft", true, false, true],
        ["RightHand", "Right", false, false, false],
    ]);
    // The one in use does nothing; the other is chosen.
    buttons[0].props.onClick();
    buttons[1].props.onClick();
    assert.deepEqual(calls, [["select", "RightHand"]]);
    assert.deepEqual(statusOf(row), []);
    const waiting = SegmentRow({ label: "Hand", variable: pending("LeftHand"), options, onSelect: record("select") });
    assert.equal(waiting.props["aria-busy"], true);
    assert.deepEqual(statusOf(waiting), ["vr_panel.settings.changing"]);
    const waitingButtons = nodesIn(waiting).filter(node => node.type === "button");
    assert.deepEqual(waitingButtons.map(button => button.props["aria-disabled"]), [true, true]);
    waitingButtons[1].props.onClick();
    assert.deepEqual(calls, [["select", "RightHand"]]);
});

// A threshold row: the microphone's, at 300 of 0 to 2000 in steps of 50, with the meter at the given volume.
async function thresholdRow(options: { threshold?: { state: string; data: unknown }; automatic?: { state: string; data: unknown };
    check?: { state: string; data: unknown }; volume?: unknown } = {}) {
    const { threshold = ok(300), automatic = ok(false), check = ok(false) } = options;
    const volume = "volume" in options ? options.volume : 500;
    const { ThresholdRow } = await rows();
    const { calls, record } = presses();
    const tree = ThresholdRow({ label: "Mic threshold", automatic_label: "Auto", CheckIcon: () => null,
        threshold: { state: threshold.state, data: Number(threshold.data) }, setThreshold: record("set"),
        automatic, toggleAutomatic: record("automatic"), check_status: check, startCheck: record("start"), stopCheck: record("stop"),
        volume, min: 0, max: 2000, step: 50 });
    const [first, second]: TreeNode[] = tree.props.children;
    const [heading, auto]: TreeNode[] = first.props.children;
    const [checkButton, meter]: TreeNode[] = second.props.children;
    const [level, marker]: (TreeNode | false)[] = meter.props.children;
    return { tree, calls, heading, auto, checkButton, level: treeNode(level), marker: treeNode(marker), ...stepper(tree) };
}

test("a threshold row shows the volume against the threshold, and marks a volume over it", async () => {
    const quiet = await thresholdRow({ volume: 250 });
    assert.equal(textOf(quiet.heading), "Mic threshold");
    assert.equal(quiet.level?.props.style.width, "12.5%");
    assert.equal(classesOf(quiet.level ?? quiet.tree).includes("is_over"), false);
    assert.equal(quiet.marker?.props.style.left, "15%");
    assert.equal(quiet.output.props.children, 300);
    const over = await thresholdRow({ volume: 300 });
    assert.ok(classesOf(over.level ?? over.tree).includes("is_over"), "at the threshold counts as over");
    // A level is never drawn past the meter's end, and a missing or unreadable level is none.
    assert.equal((await thresholdRow({ volume: 5000 })).level?.props.style.width, "100%");
    for (const volume of [undefined, "loud", null]) assert.equal((await thresholdRow({ volume })).level?.props.style.width, "0%");
    assert.equal((await thresholdRow({ volume: "1000" })).level?.props.style.width, "50%");
});

test("with the automatic threshold on, the meter has no marker and the threshold cannot be stepped", async () => {
    const view = await thresholdRow({ automatic: ok(true), volume: 1500 });
    assert.equal(view.marker, null);
    assert.equal(classesOf(view.level ?? view.tree).includes("is_over"), false);
    assert.deepEqual([view.auto.props["aria-pressed"], classesOf(view.auto).includes("is_on")], [true, true]);
    assert.deepEqual([enabled(view.decrease), enabled(view.increase)], [false, false]);
    assert.ok(classesOf(view.value).includes("is_disabled"));
    // Pressing the automatic button turns it off.
    view.auto.props.onClick();
    assert.deepEqual(view.calls, [["automatic"]]);
    const manual = await thresholdRow();
    assert.deepEqual([manual.auto.props["aria-pressed"], classesOf(manual.auto).includes("is_on"), manual.auto.props["aria-disabled"]], [false, false, false]);
    assert.equal(manual.auto.props["aria-label"], "Mic threshold: Auto");
    assert.equal(textOf(manual.auto), "Auto");
});

test("the threshold steps by 50 within its range", async () => {
    const view = await thresholdRow();
    assert.deepEqual([enabled(view.decrease), enabled(view.increase)], [true, true]);
    view.increase.props.onClick();
    view.decrease.props.onClick();
    assert.deepEqual(view.calls, [["set", 350], ["set", 250]]);
    const low = await thresholdRow({ threshold: ok(20) });
    assert.equal(enabled(low.decrease), true);
    low.decrease.props.onClick();
    const high = await thresholdRow({ threshold: ok(1990) });
    high.increase.props.onClick();
    assert.deepEqual([...low.calls, ...high.calls], [["set", 0], ["set", 2000]]);
    const ends = [await thresholdRow({ threshold: ok(0) }), await thresholdRow({ threshold: ok(2000) })];
    assert.deepEqual(ends.map(end => [enabled(end.decrease), enabled(end.increase)]), [[false, true], [true, false]]);
});

test("a threshold or automatic change on its way locks both, and says so", async () => {
    for (const changing of [{ threshold: pending(300) }, { automatic: pending(false) }]) {
        const view = await thresholdRow(changing);
        assert.deepEqual(statusOf(view.heading), ["vr_panel.settings.changing"]);
        assert.equal(view.auto.props["aria-disabled"], true);
        view.auto.props.onClick();
        assert.deepEqual([enabled(view.decrease), enabled(view.increase)], [false, false]);
        assert.equal(view.drawn.props["aria-busy"], true);
        assert.deepEqual(view.calls, []);
        // The volume check stays usable.
        assert.equal(view.checkButton.props["aria-disabled"], false);
    }
    assert.deepEqual(statusOf((await thresholdRow()).heading), []);
});

test("the volume check starts and stops the meter, and waits while it is switching", async () => {
    const off = await thresholdRow();
    assert.deepEqual([off.checkButton.props["aria-pressed"], off.checkButton.props["aria-disabled"], classesOf(off.checkButton).includes("is_on")], [false, false, false]);
    assert.equal(off.checkButton.props["aria-label"], "Mic threshold: vr_panel.settings.volume_check");
    assert.equal(findIn(off.checkButton, node => typeof node.type === "function").props["aria-hidden"], "true");
    off.checkButton.props.onClick();
    const on = await thresholdRow({ check: ok(true) });
    assert.deepEqual([on.checkButton.props["aria-pressed"], classesOf(on.checkButton).includes("is_on")], [true, true]);
    on.checkButton.props.onClick();
    assert.deepEqual([...off.calls, ...on.calls], [["start"], ["stop"]]);
    const switching = await thresholdRow({ check: pending(true) });
    assert.equal(switching.checkButton.props["aria-disabled"], true);
    assert.deepEqual(statusOf(switching.heading), ["vr_panel.settings.changing"]);
    switching.checkButton.props.onClick();
    assert.deepEqual(switching.calls, []);
    // The threshold can still be stepped while the check switches.
    assert.deepEqual([enabled(switching.decrease), enabled(switching.increase)], [true, true]);
});

test("a list of choices has a way back, a title, and marks the one in use", async () => {
    const { Picker } = await rows();
    const { calls, record } = presses();
    const options = [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }];
    const scrollRef = { current: null };
    const tree = Picker({ title: "Device › Font", options, selected_id: "b", back_label: "Back", onPick: record("pick"), onBack: record("back"), scrollRef });
    const back = findIn(tree, node => node.type === "button", "the back button");
    assert.equal(textOf(back), "‹ Back");
    back.props.onClick();
    assert.ok(find(tree, node => node.type === "span" && textOf(node) === "Device › Font"));
    const list = findIn(tree, node => node.type === "picker-list", "the list");
    assert.deepEqual([list.props.options, list.props.scrollRef, list.props.stickyHeader, list.props.initialIndex], [options, scrollRef, true, 1]);
    const buttons: TreeNode[] = options.map(option => list.props.children(option));
    assert.deepEqual(buttons.map(button => [button.key, textOf(button), button.props["aria-pressed"], classesOf(button).includes("is_selected")]),
        [["a", "Alpha", false, false], ["b", "Beta", true, true]]);
    buttons[0].props.onClick();
    assert.deepEqual(calls, [["back"], ["pick", "a"]]);
    // A value that is not among the choices: the list starts at the top.
    assert.equal(findIn(Picker({ title: "", options, selected_id: "z", back_label: "", onPick() {}, onBack() {}, scrollRef }),
        node => node.type === "picker-list").props.initialIndex, -1);
});

test("a fold says the values in use while closed, and opens and closes its rows", async () => {
    const { Disclosure, runtime } = await rows();
    const draw = (props: Parameters<typeof Disclosure>[0]) => runtime.render(Disclosure, props);
    const closed = draw({ label: "Processing", summary: "GPU · float16", children: "the rows" });
    const [toggle, content]: TreeNode[] = closed.props.children;
    assert.deepEqual([toggle.props["aria-expanded"], toggle.props["aria-controls"], content.props.id, content.props.hidden],
        [false, content.props.id, toggle.props["aria-controls"], true]);
    assert.ok(content.props.id);
    assert.equal(textOf(content), "the rows");
    const [label, expand]: TreeNode[] = toggle.props.children;
    assert.equal(textOf(label), "ProcessingGPU · float16");
    assert.deepEqual([textOf(expand), expand.props["aria-hidden"]], ["vr_panel.settings.expand ＋", "true"]);
    toggle.props.onClick();
    const open = draw({ label: "Processing", summary: "GPU · float16", children: "the rows" });
    const [openToggle, openContent]: TreeNode[] = open.props.children;
    assert.deepEqual([openToggle.props["aria-expanded"], openContent.props.hidden], [true, false]);
    assert.equal(textOf(openToggle.props.children[1]), "vr_panel.settings.collapse −");
    openToggle.props.onClick();
    assert.equal(draw({ label: "Processing", children: "the rows" }).props.children[0].props["aria-expanded"], false);
    // A change on its way: the fold says so in place of the values.
    const changing = draw({ label: "Processing", summary: "GPU · float16", is_pending: true });
    assert.equal(textOf(changing.props.children[0].props.children[0]), "Processingvr_panel.settings.changing");
});

test("a row without a line under its name draws no empty line", async () => {
    const { ToggleRow, StepperRow, SegmentRow } = await rows();
    const empty = (tree: TreeNode) => nodesIn(tree).filter(node => node.type === "span" && textOf(node) === "" && node.props["aria-hidden"] !== "true");
    const toggle = ToggleRow({ label: "Hiragana", variable: ok(true), onToggle() {} });
    const stepperRow = StepperRow({ label: "Opacity", variable: ok(1), setValue() {}, min: 0, max: 1, step: 0.1 });
    const segment = SegmentRow({ label: "Hand", variable: ok("LeftHand"), options: [], onSelect() {} });
    // The switch's knob is the one empty span a switch row has.
    assert.equal(empty(toggle).length, 1);
    assert.deepEqual([empty(stepperRow), empty(segment)], [[], []]);
});

test("the switch's knob is drawn on while the setting is on", async () => {
    const { ToggleRow } = await rows();
    const knob = (data: unknown) => {
        const [, drawn]: TreeNode[] = ToggleRow({ label: "Hiragana", variable: ok(data), onToggle() {} }).props.children;
        return classesOf(drawn).includes("is_on");
    };
    assert.deepEqual([knob(true), knob(false), knob("true")], [true, false, false]);
});

test("a step button that cannot step is greyed out", async () => {
    const { StepperRow } = await rows();
    const view = stepper(StepperRow({ label: "Timeout", variable: ok(0), setValue() {}, min: 0, max: 30, step: 1 }));
    assert.deepEqual([classesOf(view.decrease).includes("is_disabled"), classesOf(view.increase).includes("is_disabled")], [true, false]);
});

test("a value with more decimals than its step is rounded to the step's", async () => {
    const { StepperRow } = await rows();
    const set: number[] = [];
    const view = stepper(StepperRow({ label: "Timeout", variable: ok(2.5), setValue: value => set.push(value), min: 0, max: 30, step: 1 }));
    view.increase.props.onClick();
    view.decrease.props.onClick();
    assert.deepEqual(set, [4, 2]);
});
