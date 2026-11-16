import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import i18next from "i18next";
import yaml from "js-yaml";
import { hooks, loadModule, find } from "../../../../logics/test/hookHarness.js";

const load = async (failure, language = "en") => {
    const i18n = i18next.createInstance();
    const translation = yaml.load(readFileSync(new URL(`../../../../../locales/${language}.yml`, import.meta.url), "utf8"));
    await i18n.init({ lng: language, resources: { [language]: { translation } } });
    const t = i18n.t.bind(i18n), calls = [];
    const { StartupFailedDialog } = await loadModule(new URL("./StartupFailedDialog.jsx", import.meta.url), hooks(), {
        "@useI18n": { useI18n: () => ({ t }) },
        "@logics_common": { useWindow: () => ({ asyncQuitApp: () => calls.push("quit") }) },
        "../../../../logics/common/useBackendStartup": { useBackendStartup: () => ({ failure, retryStartup: () => calls.push("retry") }) },
    });
    const tree = StartupFailedDialog();
    const texts = [];
    find(tree, node => { if (typeof node.props?.children === "string") texts.push(node.props.children); return false; });
    return { tree, texts, calls, t };
};

for (const language of ["en", "ja"]) test(`${language}: an engine that ended early is named with its code, then the next step`, async () => {
    const { tree, texts, t } = await load({ kind: "exit", code: 3 }, language);
    assert.deepEqual(texts.slice(0, 3), [t("common_error.backend_startup_title"),
        t("common_error.backend_startup_reason_exit", { code: 3 }), t("common_error.backend_startup_next")]);
    assert.match(texts[1], /3/);
    // The reason and the next step are what the dialog is described by.
    assert.equal(tree.props["aria-describedby"], "startup_failed_reason startup_failed_next");
    assert.ok(find(tree, node => node.props?.id === tree.props["aria-labelledby"]));
});

for (const language of ["en", "ja"]) test(`${language}: a start-up that stopped on an internal error or ran out of time says so`, async () => {
    const internal = await load({ kind: "exit", code: 101 }, language);
    assert.equal(internal.texts[1], internal.t("common_error.backend_startup_reason_internal"));
    const timeout = await load({ kind: "exit", code: 124 }, language);
    assert.equal(timeout.texts[1], timeout.t("common_error.backend_startup_reason_timeout"));
    // Both are worded, not left as their keys.
    for (const text of [internal.texts[1], timeout.texts[1]]) assert.doesNotMatch(text, /common_error\./);
});

test("a program that never ran gets its short message as a detail; with no message, none", async () => {
    const withMessage = await load({ kind: "spawn", message: "program not found" });
    assert.ok(withMessage.texts.includes("Details: program not found"));
    const without = await load({ kind: "spawn", message: null });
    assert.ok(!without.texts.some(text => text.startsWith("Details")));
    // With no recorded reason it still reads as "could not start".
    assert.ok((await load(null)).texts.includes(without.t("common_error.backend_startup_reason_spawn")));
});

test("the two actions retry and quit, and retry takes the first focus", async () => {
    const { tree, calls } = await load({ kind: "exit", code: 1 });
    const buttons = [];
    find(tree, node => { if (node.type === "button") buttons.push(node); return false; });
    assert.equal(buttons.length, 2);
    assert.equal(buttons[0].props.autoFocus, true);
    buttons[0].props.onClick();
    buttons[1].props.onClick();
    assert.deepEqual(calls, ["retry", "quit"]);
});
