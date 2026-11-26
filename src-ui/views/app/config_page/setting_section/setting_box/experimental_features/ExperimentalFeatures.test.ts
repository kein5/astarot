import assert from "node:assert/strict";
import { test, vi } from "vitest";
import type { TestContext } from "vitest";
import { readFileSync } from "node:fs";
import { hooks, loadModule, draw, drawWith } from "../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../logics/test/hookHarness.ts";
import { flush } from "../../../../../../logics/test/bridgeHarness.ts";
import * as registry from "../../../../../../logics/configs/experimentalFeatures.ts";
import * as hexagram from "../../../../../../logics/companion/hexagram.ts";

const REGISTRY_PATH = "../../../../../../logics/configs/experimentalFeatures.ts";

// The real list is empty until a feature graduates, so the tests list made-up ones.
const FAKE_IDS = ["first_trial", "second_trial"];
const fakeRegistry = { ...registry,
    isExperimentalFeatureEnabled: (values: unknown, id: string) => FAKE_IDS.includes(id)
        && typeof values === "object" && values !== null && Reflect.get(values, id) === true };

type ListProps = Parameters<typeof import("./ExperimentalFeatures.tsx").ExperimentalFeatureList>[0];
interface Monitor {
    id: string;
    number: number;
    width: number;
    height: number;
    primary: boolean;
}

// The page shows its descriptions as hints (#614): the list is drawn inside HintDescriptions.
const inside = (page: TreeNode): TreeNode => {
    assert.equal(page.type, "hints");
    return page.props.children;
};

async function load(context: TestContext, registryModule: typeof registry = registry) {
    const runtime = hooks();
    context.onTestFinished(() => runtime.unmount());
    const writes: unknown[] = [], vrPanelToggles: boolean[] = [], sent: string[] = [];
    const current = { state: "ok", data: {} };
    const vrPanel = { state: "ok", data: false };
    const module = await loadModule<typeof import("./ExperimentalFeatures.tsx")>(new URL("./ExperimentalFeatures.tsx", import.meta.url), runtime, {
        "@tauri-apps/api/core": { invoke: async () => [] },
        "@logics_configs": { useExperimentalFeatures: () => ({
            currentExperimentalFeatures: current,
            setExperimentalFeatures: (value: unknown) => { writes.push(value); },
            currentReleaseChannel: { state: "ok", data: "stable" },
            setReleaseChannel: (value: unknown) => { writes.push(value); },
        }), useVr: () => ({
            currentIsEnabledOverlayVrPanel: vrPanel,
            toggleIsEnabledOverlayVrPanel: () => { vrPanelToggles.push(!vrPanel.data); },
        }) },
        "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython: async (endpoint: string) => { sent.push(endpoint); } }) },
        [REGISTRY_PATH]: registryModule,
        "../_templates/Templates": { SwitchContainer: "switch", DropdownMenuContainer: "dropdown", ActionButtonContainer: "action" },
        "../_components": { SectionLabelComponent: "heading" },
        "../_components/hint/Hint": { HintDescriptions: "hints" },
        "../../../../../../logics/companion/hexagram.ts": hexagram,
    });
    const render = (props: ListProps): TreeNode => inside(runtime.render(module.ExperimentalFeatureList, props));
    return { module, runtime, render, writes, current, vrPanel, vrPanelToggles, sent };
}

const flat = (tree: TreeNode | null): TreeNode[] => {
    // The list the test reads next: one that is not drawn fails here, as reading it did.
    assert.ok(tree);
    return [tree.props.children].flat(Infinity).filter(Boolean);
};
// Each feature is a group: its switch, and below it any setting of its own.
const children = (tree: TreeNode | null) => flat(tree).flatMap(item => (item.type === "div" ? flat(item) : [item]));

test("the page says there is nothing to try while no feature is listed", async context => {
    const s = await load(context);
    const list = s.render({ features: [], current: s.current, setValues: () => {} });
    const [heading, empty] = children(list);
    assert.equal(heading.props.label, "config_page.experimental_features.section_label");
    assert.equal(heading.props.desc, "config_page.experimental_features.notice");
    assert.equal(empty.props.children, "config_page.experimental_features.empty");
    assert.equal(children(list).some(item => item.type === "switch"), false);
});

test("each listed feature gets a switch with its name and description, off until confirmed on", async context => {
    const s = await load(context, fakeRegistry);
    const features = FAKE_IDS.map(id => ({ id }));
    const tree = s.render({ features, current: { state: "ok", data: { second_trial: true, first_trial: "yes" } },
        setValues: () => {} });
    const switches = children(tree).filter(item => item.type === "switch");
    assert.deepEqual(switches.map(item => item.props.setting_id),
        ["experimental_features.first_trial", "experimental_features.second_trial"]);
    assert.equal(switches[0].props.label, "config_page.experimental_features.items.first_trial.label");
    assert.equal(switches[0].props.desc, "config_page.experimental_features.items.first_trial.desc");
    assert.deepEqual(switches.map(item => item.props.variable.data), [false, true]);
});

test("a switch asks the backend for that one feature only, and turns an on feature off", async context => {
    const s = await load(context, fakeRegistry);
    const writes: unknown[] = [];
    const tree = s.render({ features: FAKE_IDS.map(id => ({ id })), current: { state: "pending", data: { second_trial: true } },
        setValues: value => writes.push(value) });
    const [first, second] = children(tree).filter(item => item.type === "switch");
    first.props.toggleFunction();
    second.props.toggleFunction();
    assert.deepEqual(writes, [{ first_trial: true }, { second_trial: false }]);
    // While a request is out the switch shows it is busy (it ignores presses then).
    assert.equal(first.props.variable.state, "pending");
});

test("a feature counts as on only when it is listed and the backend said true", () => {
    assert.equal(registry.isExperimentalFeatureEnabled({ anything: true }, "anything"), false);
    assert.equal(registry.isExperimentalFeatureEnabled(null, "anything"), false);
    assert.equal(registry.isExperimentalFeatureEnabled(undefined, "anything"), false);
    assert.deepEqual(registry.experimentalFeatureRequest("x", true), { x: true });
    assert.deepEqual(registry.experimentalFeatureRequest("x", "yes"), { x: false });
});

test("every listed feature has a name and a description in English and Japanese", () => {
    const root = new URL("../../../../../../../locales/", import.meta.url);
    for (const language of ["en", "ja"]) {
        const text = readFileSync(new URL(`${language}.yml`, root), "utf8");
        assert.match(text, /^ {8}experimental_features: ".+"$/m, `${language}: side menu label`);
        assert.match(text, /^ {4}experimental_features:\n {8}notice: ".+"\n {8}empty: ".+"/m, `${language}: page text`);
        for (const { id } of registry.EXPERIMENTAL_FEATURES) {
            // A feature that changes something beyond itself has a lead between the two (#614).
            const lead = registry.experimentalFeatureLeadKey(id) ? ' {16}lead: ".+"\\n' : "";
            assert.match(text, new RegExp(`^ {12}${id}:\\n {16}label: ".+"\\n${lead} {16}desc: ".+"`, "m"), `${language}: ${id}`);
        }
    }
});

test("the tray companion and Talk AI are listed and stay off until the user turns them on", async context => {
    const s = await load(context);
    const tree = s.runtime.render(s.module.ExperimentalFeatures, {});
    const list = inside(draw(tree));
    const switches = children(list).filter(item => item.type === "switch");
    assert.deepEqual(switches.map(item => item.props.setting_id), ["experimental_features.tray_companion", "experimental_features.talk_ai"]);
    assert.equal(switches[0].props.label, "config_page.experimental_features.items.tray_companion.label");
    assert.equal(switches[1].props.label, "config_page.experimental_features.items.talk_ai.label");
    assert.deepEqual(switches.map(item => item.props.variable.data), [false, false]);
    switches[0].props.toggleFunction();
    switches[1].props.toggleFunction();
    // Each switch asks for its own feature only; the core keeps the others as they are.
    assert.deepEqual(s.writes, [{ tray_companion: true }, { talk_ai: true }]);
});

test("while the tray companion is on, the edge its hexagram hides at can be chosen under its switch", async context => {
    const s = await load(context);
    const edges: unknown[] = [];
    const edge = { current: { state: "ok", data: "right" }, set: (value: string) => { edges.push(value); } };
    const features = [{ id: "tray_companion" }];
    const off = s.render({ features, current: { state: "ok", data: { tray_companion: false } }, setValues: () => {}, edge });
    assert.equal(children(off).some(item => typeof item.type === "function"), false, "off: no edge to choose");
    const on = s.render({ features, current: { state: "ok", data: { tray_companion: true } }, setValues: () => {}, edge });
    const chooser = children(on).find(item => typeof item.type === "function");
    assert.ok(chooser);
    const dropdown = draw(chooser);
    assert.equal(dropdown.type, "dropdown");
    assert.equal(dropdown.props.selected_id, "right");
    assert.deepEqual(Object.keys(dropdown.props.list), ["right", "left", "top", "bottom"]);
    assert.equal(dropdown.props.list.top, "config_page.experimental_features.items.tray_companion.edge.top");
    dropdown.props.selectFunction({ selected_id: "top" });
    assert.deepEqual(edges, ["top"]);
});

test("the monitor is chosen under the edge: the primary one by default, one connected now, or one unplugged", async context => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const s = await load(context);
    const saved: unknown[] = [];
    let reads = 0;
    const connected = [
        { id: "\\\\.\\DISPLAY2", number: 1, width: 1920, height: 1080, primary: false },
        { id: "\\\\.\\DISPLAY1", number: 2, width: 2560, height: 1600, primary: true },
    ];
    const monitor = (data: string) => ({ current: { state: "ok", data }, set: (value: string) => { saved.push(value); },
        list: async () => { reads++; return connected; } });
    const features = [{ id: "tray_companion" }];
    const on = { state: "ok", data: { tray_companion: true } };
    const chooser = (props: ListProps["monitor"]) => {
        const list = s.render({ features, current: on, setValues: () => {}, edge: undefined, monitor: props });
        const item = children(list).find(item => typeof item.type === "function");
        // The chooser the test draws next: one that is not there fails here, as drawing it did.
        assert.ok(item);
        return item;
    };
    // Rendered twice: the first render reads the list, the second shows it.
    let item = chooser(monitor(""));
    drawWith(s.runtime, item);
    await flush();
    let dropdown = drawWith(s.runtime, item);
    assert.equal(dropdown.type, "dropdown");
    assert.equal(dropdown.props.selected_id, "@primary", "nothing chosen: the primary monitor");
    assert.deepEqual(Object.keys(dropdown.props.list), ["@primary", "\\\\.\\DISPLAY2", "\\\\.\\DISPLAY1"]);
    assert.match(dropdown.props.list["\\\\.\\DISPLAY1"], /is_primary/);
    dropdown.props.selectFunction({ selected_id: "\\\\.\\DISPLAY2" });
    dropdown.props.selectFunction({ selected_id: "@primary" });
    assert.deepEqual(saved, ["\\\\.\\DISPLAY2", ""], "the primary option saves an empty name");
    // The list is read again while the page is open.
    const before = reads;
    vi.advanceTimersByTime(3000);
    assert.equal(reads, before + 1);
    // A chosen monitor that is unplugged stays chosen, listed as not connected.
    item = chooser(monitor("\\\\.\\DISPLAY3"));
    dropdown = drawWith(s.runtime, item);
    assert.equal(dropdown.props.selected_id, "\\\\.\\DISPLAY3");
    assert.equal(dropdown.props.list["\\\\.\\DISPLAY3"], "config_page.experimental_features.items.tray_companion.monitor.missing");
});

test("before the monitor list arrives, the chosen monitor is not called unplugged", async context => {
    const s = await load(context);
    const features = [{ id: "tray_companion" }];
    const on = { state: "ok", data: { tray_companion: true } };
    // The list never answers (or is refused) yet.
    const props = { current: { state: "ok", data: "\\\\.\\DISPLAY2" }, set: () => {}, list: () => new Promise<Monitor[]>(() => {}) };
    const list = s.render({ features, current: on, setValues: () => {}, edge: undefined, monitor: props });
    const item = children(list).find(entry => typeof entry.type === "function");
    assert.ok(item);
    drawWith(s.runtime, item);
    await flush();
    const dropdown = drawWith(s.runtime, item);
    assert.equal(dropdown.props.selected_id, "\\\\.\\DISPLAY2");
    assert.equal(dropdown.props.list["\\\\.\\DISPLAY2"], "common.loading");
});

// #563: the errors were dropped, so a list that kept failing showed "Loading" for good.
test("when the monitor list cannot be read, the chosen monitor says so instead of loading for good", async context => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    context.onTestFinished(() => { vi.useRealTimers(); });
    const s = await load(context);
    const features = [{ id: "tray_companion" }];
    const on = { state: "ok", data: { tray_companion: true } };
    let answer: () => Promise<Monitor[]> = () => Promise.reject(new Error("read_failed"));
    const props = { current: { state: "ok", data: "\\\\.\\DISPLAY2" }, set: () => {}, list: () => answer() };
    const list = s.render({ features, current: on, setValues: () => {}, edge: undefined, monitor: props });
    const item = children(list).find(entry => typeof entry.type === "function");
    assert.ok(item);
    drawWith(s.runtime, item);
    await flush();
    let dropdown = drawWith(s.runtime, item);
    assert.equal(dropdown.props.selected_id, "\\\\.\\DISPLAY2", "the choice itself stays");
    assert.equal(dropdown.props.list["\\\\.\\DISPLAY2"], "config_page.experimental_features.items.tray_companion.monitor.unknown");
    // The next read that works shows the list again.
    answer = async () => [{ id: "\\\\.\\DISPLAY2", number: 1, width: 1920, height: 1080, primary: false }];
    vi.advanceTimersByTime(3000);
    await flush();
    dropdown = drawWith(s.runtime, item);
    assert.match(dropdown.props.list["\\\\.\\DISPLAY2"], /monitor\.display/);
});

test("#554 (Q-05): the VR panel is listed with the features on trial and keeps its own saved switch", async context => {
    const s = await load(context);
    const tree = s.runtime.render(s.module.ExperimentalFeatures, {});
    const list = inside(draw(tree));
    const item = flat(list).find(node => typeof node.type === "function" && node.props.current === s.vrPanel);
    assert.ok(item, "the page lists the VR panel");
    const off = drawWith(s.runtime, item);
    const [toggle, ...rest] = flat(off);
    assert.equal(toggle.type, "switch");
    assert.equal(toggle.props.setting_id, "experimental_features.vr_panel");
    assert.equal(toggle.props.label, "config_page.experimental_features.items.vr_panel.label");
    // The value is the VR panel's own (OVERLAY_VR_PANEL): whoever had it on keeps it on.
    assert.equal(toggle.props.variable, s.vrPanel);
    assert.deepEqual(rest, [], "the launcher's reset shows only while the panel is on");
    toggle.props.toggleFunction();
    assert.deepEqual(s.vrPanelToggles, [true]);
    assert.deepEqual(s.writes, [], "the experimental features' dictionary is not written");

    s.vrPanel.data = true;
    const on = drawWith(s.runtime, item);
    const action = flat(on).find(node => node.type === "action");
    assert.ok(action);
    assert.equal(action.props.label, "config_page.experimental_features.items.vr_panel.reset_launcher.label");
    await action.props.onclickFunction();
    assert.deepEqual(s.sent, ["/run/vr_launcher_reset"]);

    // The VR page no longer carries the switch: it leads here.
    const vr = readFileSync(new URL("../vr/Vr.tsx", import.meta.url), "utf8");
    assert.doesNotMatch(vr, /IsEnabledOverlayVrPanel|vr_launcher_reset/);
    assert.match(vr, /<PagePointer [^>]*tab="experimental_features"/);
});

// #466: which releases the in-app update offers. Stable by default; Beta gets the betas too.
test("the update channel is chosen on the page: Stable by default, or Beta", async context => {
    const s = await load(context);
    const chosen: string[] = [];
    const channelOf = (data: unknown) => ({ current: { state: "ok", data }, set: (value: string) => { chosen.push(value); } });
    const dropdownOf = (data: unknown) => {
        const list = s.render({ features: [], current: s.current, setValues: () => {}, channel: channelOf(data) });
        assert.equal(children(list).some(item => item.props?.children === "config_page.experimental_features.empty"), false);
        const chooser = children(list).find(item => typeof item.type === "function");
        assert.ok(chooser);
        return draw(chooser);
    };
    const dropdown = dropdownOf("stable");
    assert.equal(dropdown.type, "dropdown");
    assert.equal(dropdown.props.setting_id, "experimental_features.release_channel");
    assert.deepEqual(Object.keys(dropdown.props.list), ["stable", "beta"]);
    assert.equal(dropdown.props.list.beta, "config_page.experimental_features.items.release_channel.beta");
    assert.equal(dropdown.props.desc, "config_page.experimental_features.items.release_channel.desc");
    assert.equal(dropdown.props.selected_id, "stable");
    // Not known yet, or anything else: Stable, the default.
    assert.equal(dropdownOf(null).props.selected_id, "stable");
    assert.equal(dropdownOf("beta").props.selected_id, "beta");
    dropdown.props.selectFunction({ selected_id: "beta" });
    assert.deepEqual(chosen, ["beta"]);
});

test("the page is not empty while the VR panel is listed", async context => {
    const s = await load(context);
    const vrPanel = { current: { state: "ok", data: false }, toggle: () => {}, resetLauncher: () => {} };
    const list = s.render({ features: [], current: s.current, setValues: () => {}, vrPanel });
    assert.equal(children(list).some(item => item.props?.children === "config_page.experimental_features.empty"), false);
});

// #614: the features' descriptions are their labels' hints. The tray companion keeps one sentence
// on screen: the app starts in the tray from then on, which is read before it is turned on.
test("the features' descriptions are left to become hints; the tray companion keeps the sentence about the next start on screen", async context => {
    const s = await load(context);
    const tray = children(inside(draw(s.runtime.render(s.module.ExperimentalFeatures, {})))).filter(item => item.type === "switch");
    const item = "config_page.experimental_features.items.tray_companion";
    const talk = "config_page.experimental_features.items.talk_ai";
    // Talk AI keeps its sentence on screen too: turning it on adds a settings page (#388).
    assert.deepEqual(tray.map(row => [row.props.setting_id, row.props.lead, row.props.desc, row.props.keep_desc]),
        [["experimental_features.tray_companion", `${item}.lead`, `${item}.desc`, undefined],
            ["experimental_features.talk_ai", `${talk}.lead`, `${talk}.desc`, undefined]]);
    // A feature that changes nothing about the start keeps nothing on screen.
    const fake = await load(context, fakeRegistry);
    const others = children(fake.render({ features: FAKE_IDS.map(id => ({ id })), current: fake.current, setValues: () => {} }))
        .filter(item => item.type === "switch");
    assert.deepEqual(others.map(item => [item.props.lead, item.props.keep_desc]), [[undefined, undefined], [undefined, undefined]]);
    // The VR panel and the settings under a feature that is on: descriptions, and no keep.
    const list = s.render({ features: [{ id: "tray_companion" }], current: { state: "ok", data: { tray_companion: true } }, setValues: () => {},
        edge: { current: { state: "ok", data: "right" }, set: () => {} }, vrPanel: { current: { state: "ok", data: true }, toggle: () => {}, resetLauncher: () => {} } });
    const rows = children(list).filter(item => typeof item.type === "function").flatMap(item => { s.runtime.remount(); return [drawWith(s.runtime, item)].flatMap(drawn => drawn.type === "div" ? flat(drawn) : [drawn]); });
    assert.deepEqual(rows.map(row => [row.props.setting_id, typeof row.props.desc, row.props.keep_desc]), [
        ["experimental_features.tray_companion.edge", "string", undefined],
        ["experimental_features.vr_panel", "string", undefined],
        ["experimental_features.vr_panel.reset_launcher", "string", undefined],
    ]);
});
