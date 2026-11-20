import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, find, unchecked } from "../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../logics/test/hookHarness.ts";

// 「自動選択」 heads the field column of the microphone row and of the speaker row alike, over the
// lists it chooses for, its box where the lists start. It was put beside the lists, between the
// label column and the field column, where it lined up with neither.
const MultiDropdownMenuContainer = () => null, DropdownMenu = () => null, Checkbox = () => null;

// The node the test reads next: one that is not there fails here, as reading it did.
const found = (tree: unknown, predicate: (node: TreeNode) => boolean) => {
    const node = find(tree, predicate);
    assert.ok(node);
    return node;
};
// A row of the page drawn as React would: its type is the page's own row component.
const draw = (node: TreeNode) => unchecked<(props: unknown) => unknown>(node.type)(node.props);

const load = async () => {
    const runtime = hooks();
    const device = await loadModule<typeof import("./Device.tsx")>(new URL("./Device.tsx", import.meta.url), runtime, {
        "./VoiceRouteSettings": { VoiceRouteSettings: () => null },
        "@store": { useStore_IsBreakPoint: () => ({ currentIsBreakPoint: { data: false } }) },
        "@ui_configs": { ui_configs: {} },
        "@logics_configs": { useDevice: () => ({
            currentEnableAutoMicSelect: { data: true }, currentEnableAutoSpeakerSelect: { data: true },
            currentMicDeviceOptions: { data: [] }, currentMicHostList: { data: [] }, currentSpeakerDeviceOptions: { data: [] },
            currentSelectedMicHost: { data: "" }, currentSelectedMicDeviceId: { data: "" }, currentSelectedSpeakerDeviceId: { data: "" },
            currentMicVadFilter: { data: false, state: "ok" }, currentSpeakerVadFilter: { data: false, state: "ok" },
            currentEnableAutomaticMicThreshold: { data: true, state: "ok" }, currentEnableAutomaticSpeakerThreshold: { data: true, state: "ok" },
            currentVadAvailable: { data: true },
        }) },
        "../_templates/Templates": { MultiDropdownMenuContainer },
        "../_components": { SectionLabelComponent: () => null, LabelComponent: () => null, DropdownMenu,
            ThresholdComponent: () => null, RadioButton: () => null },
        "@common_components": { Checkbox },
        "../_components/advanced_section/AdvancedSection": { AdvancedSection: () => null },
        "../_components/page_pointer/PagePointer": { PagePointer: () => null },
        "../_components/hint/Hint": { HintDescriptions: "hints" },
    });
    const page = runtime.render(device.Device).props.children;
    // The device rows come first, before 「詳細設定」.
    const [mic, speaker] = page.props.children.slice(0, 2).map((node: TreeNode) => draw(node));
    return { device, mic, speaker };
};

test("the microphone's 自動選択 is the first part of the column of lists, over the host and the device", async () => {
    const { device, mic } = await load();
    const settings = found(mic, node => node.type === MultiDropdownMenuContainer).props.dropdown_settings;
    assert.equal(settings[0].insert_component, device.AutoSelectCheckbox);
    assert.equal(settings[0].insert_to, undefined, "not beside the lists, but in their column");
    assert.deepEqual(settings.slice(1).map((row: { dropdown_id?: string }) => row.dropdown_id), ["mic_host", "mic_device"]);

    // The shared lists draw an insert without a side in the column of lists, in its order.
    const runtime = hooks();
    const { MultiDropdownMenu } = await loadModule<typeof import("../_components/dropdown_menu/DropdownMenu.tsx")>(new URL("../_components/dropdown_menu/DropdownMenu.tsx", import.meta.url), runtime, {
        "../_atoms/_dropdown_menu/_DropdownMenu": { _DropdownMenu: () => null },
    });
    const drawn = runtime.render(MultiDropdownMenu, { dropdown_settings: settings });
    const column = found(drawn, node => node.props?.className === "wrapper");
    const [first, ...lists] = column.props.children;
    assert.equal(first.type, device.AutoSelectCheckbox);
    assert.equal(lists.length, 2);
    // Nothing before or after the column: the inserts beside it are empty.
    const [before, , after] = drawn.props.children.props.children;
    assert.deepEqual([before.length, after.length], [0, 0], "nothing beside the column");
});

test("the speaker's 自動選択 sits over its list in the same way", async () => {
    const { device, speaker } = await load();
    const contents = found(speaker, node => node.props?.className === "device_contents");
    const [check, list] = contents.props.children;
    assert.equal(check.type, device.AutoSelectCheckbox);
    assert.equal(list.type, DropdownMenu);
    // One over the other, as the microphone's column of lists, with the same space between.
    const scss = (await import("node:fs")).readFileSync(new URL("./Device.module.scss", import.meta.url), "utf8");
    const rule = scss.split(".device_contents {")[1].split("}")[0];
    assert.match(rule, /flex-direction: column;/);
    assert.match(rule, /gap: 1\.2rem;/);
});

test("the box starts where the lists start: the checkbox's padding goes into the gap between the columns", async () => {
    const { device } = await load();
    const runtime = hooks();
    const drawn = runtime.render(device.AutoSelectCheckbox, { secondary_label: "Auto select", variable: { data: true }, toggleFunction() {} });
    assert.equal(drawn.props.className, "auto_select");
    const box = drawn.props.children;
    assert.equal(box.type, Checkbox);
    assert.deepEqual([box.props.show_label, box.props.padding], [true, "0.8rem"]);
    const scss = (await import("node:fs")).readFileSync(new URL("./Device.module.scss", import.meta.url), "utf8");
    const rule = scss.split(".auto_select {")[1].split("}")[0];
    assert.match(rule, /margin-inline-start: -0\.8rem;/, "as wide as the padding given to the checkbox");
});
