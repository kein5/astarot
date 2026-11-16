import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import { hooks, loadModule } from "../test/hookHarness.js";
import * as endpointPrivacy from "./endpointPrivacy.ts";

test("a lost network connection is told in the UI language, and only when it is known to be lost", async () => {
    const runtime = hooks(), shown = [];
    const { useHandleNetworkConnection } = await loadModule(new URL("./useHandleNetworkConnection.js", import.meta.url), runtime, {
        "./endpointPrivacy": endpointPrivacy,
        "@logics_common": { useNotificationStatus: () => ({ showNotification_Error: (message, options) => shown.push([message, options]) }) },
        "@useI18n": { useI18n: () => ({ t: key => `t:${key}` }) },
    });
    const { handleNetworkConnection } = runtime.render(useHandleNetworkConnection);
    handleNetworkConnection(null);
    handleNetworkConnection(true);
    assert.deepEqual(shown, []);
    handleNetworkConnection(false);
    assert.deepEqual(shown, [["t:network_privacy.disconnected", { hide_duration: 8000 }]]);
    for (const language of ["en", "ja"]) {
        const strings = yaml.load(readFileSync(new URL(`../../../locales/${language}.yml`, import.meta.url), "utf8"));
        assert.equal(typeof strings.network_privacy.disconnected, "string", language);
    }
});
