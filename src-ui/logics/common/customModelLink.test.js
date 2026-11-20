import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, find } from "../test/hookHarness.ts";
import * as uiConfigs from "../ui_configs.ts";

const HOME = "https://kein5.github.io/astarot";
const translations = language => ({ useI18n: () => ({ t: key => key, i18n: { language } }) });

test("the guide to your own models opens in the display language", () => {
    assert.equal(uiConfigs.generateLocalizedDocumentUrl("ja").vrct_document_custom_models_url, `${HOME}/ja/guide/custom-models`);
    assert.equal(uiConfigs.generateLocalizedDocumentUrl("en").vrct_document_custom_models_url, `${HOME}/en/guide/custom-models`);
    // The site has Japanese and English pages; other display languages get the English one.
    assert.equal(uiConfigs.generateLocalizedDocumentUrl("ko").vrct_document_custom_models_url, `${HOME}/en/guide/custom-models`);
});

const loadLink = async (runtime, language, openUrl) => (await loadModule(
    new URL("../../views/app/config_page/setting_section/setting_box/_components/custom_model_link/CustomModelLink.tsx", import.meta.url),
    runtime, {
        "@useI18n": translations(language), "@ui_configs": uiConfigs,
        "@tauri-apps/api/core": { isTauri: () => true }, "@tauri-apps/plugin-opener": { openUrl },
    })).CustomModelLink;

test("the link opens its section of the guide in the browser, and does nothing else", async () => {
    const runtime = hooks(), opened = [];
    const CustomModelLink = await loadLink(runtime, "ja", async url => { opened.push(url); });
    const link = find(runtime.render(CustomModelLink, { section: "rvc" }), node => node.type === "a");
    assert.equal(link.props.href, `${HOME}/ja/guide/custom-models#rvc`);
    assert.equal(link.props.children, "config_page.custom_model_link");
    let prevented = false;
    await link.props.onClick({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.deepEqual(opened, [`${HOME}/ja/guide/custom-models#rvc`]);
    assert.equal(find(runtime.render(CustomModelLink, { section: "rvc" }), node => node.props?.role === "alert"), null);
});

test("when the browser cannot be opened, the link says so and shows the address", async () => {
    const runtime = hooks();
    const CustomModelLink = await loadLink(runtime, "en", async () => { throw new Error("denied"); });
    const link = find(runtime.render(CustomModelLink, { section: "tts" }), node => node.type === "a");
    await link.props.onClick({ preventDefault() {} });
    const alert = find(runtime.render(CustomModelLink, { section: "tts" }), node => node.props?.role === "alert");
    assert.ok(find(alert, node => node.props?.children === "model_downloads.link_error"));
    assert.ok(find(alert, node => node.props?.children === `${HOME}/en/guide/custom-models#tts`));
});
