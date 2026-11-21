import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { hooks, loadModule } from "../../../logics/test/hookHarness.ts";
import { flush } from "../../../logics/test/bridgeHarness.ts";

type Listener = (event: { payload: unknown }) => void;

async function setup(context: TestContext) {
    const runtime = hooks();
    const listeners = new Map<string, Listener>(), removed: string[] = [];
    const notices: unknown[][] = [], dismissed: string[] = [];
    const { AppUpdateController, UPDATE_RESTARTING_EVENT } = await loadModule<typeof import("./AppUpdateController.tsx")>(new URL("./AppUpdateController.tsx", import.meta.url), runtime, {
        "@tauri-apps/api/event": { listen: async (name: string, listener: Listener) => {
            listeners.set(name, listener);
            return () => { removed.push(name); };
        } },
        "@logics_common": {
            useIsBackendReady: () => ({ currentIsBackendReady: { data: false } }),
            useNotificationStatus: () => ({
                showNotification_Error: (...args: unknown[]) => notices.push(args),
                dismissNotification: (id: string) => dismissed.push(id),
            }),
        },
        "@logics_configs": { useOthers: () => ({ currentEnableCheckSoftwareUpdates: { data: false } }) },
        "../../../logics/common/useAppUpdate": { useAppUpdate: () => ({ loadAppUpdateInfo: () => {}, checkAppUpdate: () => {} }) },
    });
    context.onTestFinished(() => runtime.unmount());
    runtime.render(AppUpdateController);
    await flush();
    return { runtime, listeners, removed, notices, dismissed, event: UPDATE_RESTARTING_EVENT };
}

// #561: an update that stopped the backend for the installer, which then did not start, restarts
// the app. The user did not ask for that restart, so it is said first, and the notice of the
// backend's stop goes.
test("a restart after an update that could not be installed is said before it comes", async context => {
    const s = await setup(context);
    assert.equal(s.event, "app-update-restarting");
    const listener = s.listeners.get(s.event);
    assert.ok(listener, "nothing listens for the restart");
    assert.deepEqual(s.notices, []);
    listener({ payload: null });
    assert.deepEqual(s.dismissed, ["backend_stopped"]);
    assert.deepEqual(s.notices, [["app_update.restarting_after_failure", { hide_duration: null, category_id: "app_update_restarting" }]]);
});

test("the listener goes with the controller", async context => {
    const s = await setup(context);
    s.runtime.unmount();
    assert.deepEqual(s.removed, ["app-update-restarting"]);
});
