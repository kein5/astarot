import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import { hooks, loadModule, find } from "../../../logics/test/hookHarness.js";
import * as searchTargets from "../../../logics/configs/config_page_setter/_aux/configSearchTargets.ts";

// Where each setting lives after the information architecture review (#554,
// docs/design/information-architecture/README.md and the decisions on the Issue).

const box = path => new URL(`./setting_section/setting_box/${path}`, import.meta.url);
const read = path => readFileSync(box(path), "utf8");
const locales = Object.fromEntries(["en", "ja"].map(language =>
    [language, yaml.load(readFileSync(new URL(`../../../../locales/${language}.yml`, import.meta.url), "utf8"))]));
const loadSearch = runtime => loadModule(new URL("../../../logics/configs/config_page_setter/_aux/useConfigSearch.js", import.meta.url), runtime, {
    "@store": {}, "@logics_configs": {}, "@ui_configs": {}, "@root/locales/config.js": {},
    "../../../transcription/useRealtimeASR": {}, "../../../common/languageNames.ts": {}, "../../../voice/settingsNavigation": {},
    "./configSearchTargets.ts": searchTargets,
});

test("Q-06: the OSC address and port are under Advanced; the VRChat page leads there", async () => {
    const advanced = read("advanced_settings/AdvancedSettings.jsx");
    const page = advanced.split("export const AdvancedSettings = () => {")[1].split("\n};")[0];
    assert.match(page, /section_label_osc[\s\S]*<OscIpAddressContainer \/>\s*<OscPortContainer \/>/);

    const vrchat = read("vrchat/Vrchat.jsx");
    assert.doesNotMatch(vrchat, /OscIpAddressContainer|OscPortContainer/);
    assert.match(vrchat, /<VrchatPresence \/>/, "the page still says whether VRChat is found, with the step that turns OSC on");

    const runtime = hooks(), opened = [];
    const pointer = await loadModule(box("_components/page_pointer/PagePointer.jsx"), runtime, {
        "@store": { useStore_SelectedConfigTabId: () => ({ updateSelectedConfigTabId: id => opened.push(id) }) },
        "../form_row/FormRow": { FormRow: props => ({ type: "row", props }) },
    });
    const row = runtime.render(pointer.PagePointer, { label: "OSC", description: "", tab: "advanced_settings", button: "Open Advanced" });
    const button = find(row, node => node.type === "button");
    assert.equal(button.props.children, "Open Advanced");
    button.props.onClick();
    assert.deepEqual(opened, ["advanced_settings"]);
    assert.match(vrchat, /<PagePointer [^>]*tab="advanced_settings"/);

    const search = await loadSearch(hooks());
    for (const key of ["section_label_osc", "osc_ip_address", "osc_port"]) assert.deepEqual(search.settingTabs("advanced_settings", key), ["advanced_settings"]);
    for (const language of ["en", "ja"]) {
        const vrchatTexts = locales[language].config_page.vrchat;
        assert.equal(typeof vrchatTexts.osc_pointer.label, "string");
        assert.equal(typeof vrchatTexts.open_advanced_settings, "string");
    }
});
