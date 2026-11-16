import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { hooks, loadModule } from "../../../../../../logics/test/hookHarness.js";
import { flush } from "../../../../../../logics/test/bridgeHarness.js";
import * as registry from "../../../../../../logics/configs/experimentalFeatures.ts";
import * as hexagram from "../../../../../../logics/companion/hexagram.ts";

const REGISTRY_PATH = "../../../../../../logics/configs/experimentalFeatures.ts";

// The real list is empty until a feature graduates, so the tests list made-up ones.
const FAKE_IDS = ["first_trial", "second_trial"];
const fakeRegistry = { ...registry,
    isExperimentalFeatureEnabled: (values, id) => FAKE_IDS.includes(id) && values?.[id] === true };

async function load(context, registryModule = registry) {
    const runtime = hooks();
    context.after(() => runtime.unmount());
    const writes = [];
    const current = { state: "ok", data: {} };
    const module = await loadModule(new URL("./ExperimentalFeatures.tsx", import.meta.url), runtime, {
        "@tauri-apps/api/core": { invoke: async () => [] },
        "@logics_configs": { useExperimentalFeatures: () => ({
            currentExperimentalFeatures: current,
            setExperimentalFeatures: value => { writes.push(value); },
        }) },
        [REGISTRY_PATH]: registryModule,
        "../_templates/Templates": { CheckboxContainer: "checkbox", DropdownMenuContainer: "dropdown" },
        "../../../../../../logics/companion/hexagram.ts": hexagram,
    });
    const render = props => runtime.render(module.ExperimentalFeatureList, props);
    return { module, runtime, render, writes, current };
}

const flat = tree => [tree.props.children].flat(Infinity).filter(Boolean);
// Each feature is a group: its checkbox, and below it any setting of its own.
const children = tree => flat(tree).flatMap(item => (item.type === "div" ? flat(item) : [item]));

test("the page says there is nothing to try while no feature is listed", async context => {
    const s = await load(context);
    const list = s.render({ features: [], current: s.current, setValues: () => {} });
    const [notice, empty] = children(list);
    assert.equal(notice.props.children, "config_page.experimental_features.notice");
    assert.equal(empty.props.children, "config_page.experimental_features.empty");
    assert.equal(children(list).some(item => item.type === "checkbox"), false);
});

test("each listed feature gets a checkbox with its name and description, off until confirmed on", async context => {
    const s = await load(context, fakeRegistry);
    const features = FAKE_IDS.map(id => ({ id }));
    const tree = s.render({ features, current: { state: "ok", data: { second_trial: true, first_trial: "yes" } },
        setValues: () => {} });
    const switches = children(tree).filter(item => item.type === "checkbox");
    assert.deepEqual(switches.map(item => item.props.setting_id),
        ["experimental_features.first_trial", "experimental_features.second_trial"]);
    assert.equal(switches[0].props.label, "config_page.experimental_features.items.first_trial.label");
    assert.equal(switches[0].props.desc, "config_page.experimental_features.items.first_trial.desc");
    assert.deepEqual(switches.map(item => item.props.variable.data), [false, true]);
});

test("a checkbox asks the backend for that one feature only, and turns an on feature off", async context => {
    const s = await load(context, fakeRegistry);
    const writes = [];
    const tree = s.render({ features: FAKE_IDS.map(id => ({ id })), current: { state: "pending", data: { second_trial: true } },
        setValues: value => writes.push(value) });
    const [first, second] = children(tree).filter(item => item.type === "checkbox");
    first.props.toggleFunction();
    second.props.toggleFunction();
    assert.deepEqual(writes, [{ first_trial: true }, { second_trial: false }]);
    // While a request is out the checkbox shows it is busy (it ignores presses then).
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
            assert.match(text, new RegExp(`^ {12}${id}:\\n {16}label: ".+"\\n {16}desc: ".+"`, "m"), `${language}: ${id}`);
        }
    }
});

test("the tray companion is listed and stays off until the user turns it on", async context => {
    const s = await load(context);
    const tree = s.runtime.render(s.module.ExperimentalFeatures, {});
    const list = tree.type(tree.props);
    const switches = children(list).filter(item => item.type === "checkbox");
    assert.deepEqual(switches.map(item => item.props.setting_id), ["experimental_features.tray_companion"]);
    assert.equal(switches[0].props.label, "config_page.experimental_features.items.tray_companion.label");
    assert.equal(switches[0].props.variable.data, false);
    switches[0].props.toggleFunction();
    assert.deepEqual(s.writes, [{ tray_companion: true }]);
});

test("while the tray companion is on, the edge its hexagram hides at can be chosen under its checkbox", async context => {
    const s = await load(context);
    const edges = [];
    const edge = { current: { state: "ok", data: "right" }, set: value => { edges.push(value); } };
    const features = [{ id: "tray_companion" }];
    const off = s.render({ features, current: { state: "ok", data: { tray_companion: false } }, setValues: () => {}, edge });
    assert.equal(children(off).some(item => typeof item.type === "function"), false, "off: no edge to choose");
    const on = s.render({ features, current: { state: "ok", data: { tray_companion: true } }, setValues: () => {}, edge });
    const chooser = children(on).find(item => typeof item.type === "function");
    const dropdown = chooser.type(chooser.props);
    assert.equal(dropdown.type, "dropdown");
    assert.equal(dropdown.props.selected_id, "right");
    assert.deepEqual(Object.keys(dropdown.props.list), ["right", "left", "top", "bottom"]);
    assert.equal(dropdown.props.list.top, "config_page.experimental_features.items.tray_companion.edge.top");
    dropdown.props.selectFunction({ selected_id: "top" });
    assert.deepEqual(edges, ["top"]);
});

test("the monitor is chosen under the edge: the primary one by default, one connected now, or one unplugged", async context => {
    context.mock.timers.enable({ apis: ["setInterval"] });
    const s = await load(context);
    const saved = [];
    let reads = 0;
    const connected = [
        { id: "\\\\.\\DISPLAY2", number: 1, width: 1920, height: 1080, primary: false },
        { id: "\\\\.\\DISPLAY1", number: 2, width: 2560, height: 1600, primary: true },
    ];
    const monitor = (data) => ({ current: { state: "ok", data }, set: value => { saved.push(value); },
        list: async () => { reads++; return connected; } });
    const features = [{ id: "tray_companion" }];
    const on = { state: "ok", data: { tray_companion: true } };
    const chooser = props => {
        const list = s.render({ features, current: on, setValues: () => {}, edge: undefined, monitor: props });
        return children(list).find(item => typeof item.type === "function");
    };
    // Rendered twice: the first render reads the list, the second shows it.
    let item = chooser(monitor(""));
    s.runtime.render(item.type, item.props);
    await flush();
    let dropdown = s.runtime.render(item.type, item.props);
    assert.equal(dropdown.type, "dropdown");
    assert.equal(dropdown.props.selected_id, "@primary", "nothing chosen: the primary monitor");
    assert.deepEqual(Object.keys(dropdown.props.list), ["@primary", "\\\\.\\DISPLAY2", "\\\\.\\DISPLAY1"]);
    assert.match(dropdown.props.list["\\\\.\\DISPLAY1"], /is_primary/);
    dropdown.props.selectFunction({ selected_id: "\\\\.\\DISPLAY2" });
    dropdown.props.selectFunction({ selected_id: "@primary" });
    assert.deepEqual(saved, ["\\\\.\\DISPLAY2", ""], "the primary option saves an empty name");
    // The list is read again while the page is open.
    const before = reads;
    context.mock.timers.tick(3000);
    assert.equal(reads, before + 1);
    // A chosen monitor that is unplugged stays chosen, listed as not connected.
    item = chooser(monitor("\\\\.\\DISPLAY3"));
    dropdown = s.runtime.render(item.type, item.props);
    assert.equal(dropdown.props.selected_id, "\\\\.\\DISPLAY3");
    assert.equal(dropdown.props.list["\\\\.\\DISPLAY3"], "config_page.experimental_features.items.tray_companion.monitor.missing");
});
