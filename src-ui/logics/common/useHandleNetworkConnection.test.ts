import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule } from "../test/hookHarness.ts";
import { localeAt, readLocale } from "../test/locales.ts";
import * as endpointPrivacy from "./endpointPrivacy.ts";

test("a lost network connection is told in the UI language, and only when it is known to be lost", async () => {
    const runtime = hooks(), shown: [unknown, unknown][] = [];
    const { useHandleNetworkConnection } = await loadModule<typeof import("./useHandleNetworkConnection.ts")>(new URL("./useHandleNetworkConnection.ts", import.meta.url), runtime, {
        "./endpointPrivacy": endpointPrivacy,
        "@logics_common": { useNotificationStatus: () => ({ showNotification_Error: (message: unknown, options: unknown) => shown.push([message, options]) }) },
        "@useI18n": { useI18n: () => ({ t: (key: string) => `t:${key}` }) },
    });
    const { handleNetworkConnection } = runtime.render(useHandleNetworkConnection);
    handleNetworkConnection(null);
    handleNetworkConnection(true);
    assert.deepEqual(shown, []);
    handleNetworkConnection(false);
    assert.deepEqual(shown, [["t:network_privacy.disconnected", { hide_duration: 8000 }]]);
    for (const language of ["en", "ja"]) {
        // A missing level fails here, as reading through it did.
        assert.equal(typeof localeAt(readLocale(language), "network_privacy.disconnected"), "string", language);
    }
});
