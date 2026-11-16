import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { hooks, loadModule } from "../../../../../../logics/test/hookHarness.js";
import * as registry from "../../../../../../logics/configs/experimentalFeatures.ts";

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
        "@logics_configs": { useExperimentalFeatures: () => ({
            currentExperimentalFeatures: current,
            setExperimentalFeatures: value => { writes.push(value); },
        }) },
        [REGISTRY_PATH]: registryModule,
        "../_templates/Templates": { SwitchBoxContainer: "switch" },
    });
    const render = props => runtime.render(module.ExperimentalFeatureList, props);
    return { module, runtime, render, writes, current };
}

const children = tree => [tree.props.children].flat(Infinity).filter(Boolean);

test("the page says there is nothing to try while no feature is listed", async context => {
    const s = await load(context);
    const list = s.render({ features: [], current: s.current, setValues: () => {} });
    const [notice, empty] = children(list);
    assert.equal(notice.props.children, "config_page.experimental_features.notice");
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
    const writes = [];
    const tree = s.render({ features: FAKE_IDS.map(id => ({ id })), current: { state: "pending", data: { second_trial: true } },
        setValues: value => writes.push(value) });
    const [first, second] = children(tree).filter(item => item.type === "switch");
    first.props.toggleFunction();
    second.props.toggleFunction();
    assert.deepEqual(writes, [{ first_trial: true }, { second_trial: false }]);
    // While a request is out the switch shows it is busy (the switch ignores presses then).
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
    const switches = children(list).filter(item => item.type === "switch");
    assert.deepEqual(switches.map(item => item.props.setting_id), ["experimental_features.tray_companion"]);
    assert.equal(switches[0].props.label, "config_page.experimental_features.items.tray_companion.label");
    assert.equal(switches[0].props.variable.data, false);
    switches[0].props.toggleFunction();
    assert.deepEqual(s.writes, [{ tray_companion: true }]);
});