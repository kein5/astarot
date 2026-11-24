import assert from "node:assert/strict";
import { test } from "vitest";
import { atom, createStore } from "jotai/vanilla";
import { hooks, loadModule } from "../test/hookHarness.ts";
import * as sharedWindow from "./ocrSharedWindow.ts";
import type { SharedWindowState } from "./ocrSharedWindow.ts";

// The chat reading's shared window as the page uses it (useOcrSharedWindow.ts): the actions of
// ocrSharedWindow.ts wired to the store's atoms, the Tauri commands and the saved restore token.

const SHARED: SharedWindowState = { supported: true, active: false, busy: false, error: null, restoring: false };

interface Options {
    window?: SharedWindowState;
    // The registry's entry for the restore token: an atom of { data }, or something else.
    token?: unknown;
}

const load = async (options: Options = {}) => {
    const window = options.window ?? SHARED;
    // Without an entry, the registry has no atom for the token at all.
    const token = "token" in options ? options.token : { state: "ok", data: "saved-token" };
    const store = createStore(), runtime = hooks();
    const windowAtom = atom({ state: "ok", data: window });
    const registry: Record<string, unknown> = {};
    if (token !== undefined) registry.Atom_OcrPortalRestoreToken = typeof token === "function" ? token : atom(token);
    const invoked: [string, unknown][] = [], sent: [string, unknown][][] = [[]];
    let sender = 0;
    const module = await loadModule<typeof import("./useOcrSharedWindow.ts")>(new URL("./useOcrSharedWindow.ts", import.meta.url), runtime, {
        jotai: { getDefaultStore: () => store },
        "@tauri-apps/api/core": { invoke: async (command: string, args?: unknown) => {
            invoked.push([command, args]);
            return command === "screencast_start" ? { restore_token: "new-token" } : { supported: true, active: true };
        } },
        "@store": { Atom_OcrSharedWindow: windowAtom, dynamicStoreRegistry: registry,
            useStore_OcrSharedWindow: () => ({ currentOcrSharedWindow: store.get(windowAtom) }) },
        // Each render gets the backend's sender of that moment; the test changes it between renders.
        "@useStdoutToPython": { useStdoutToPython: () => {
            const mine = sender;
            return { asyncStdoutToPython: async (endpoint: string, value: unknown) => { sent[mine].push([endpoint, value]); return true; } };
        } },
        "./ocrSharedWindow.ts": sharedWindow,
    });
    const windowState = (): unknown => store.get<{ state: string; data: unknown }>(windowAtom);
    return { module, store, windowAtom, invoked, sent, windowState,
        hook: () => runtime.render(module.useOcrSharedWindow),
        nextSender: () => { sender = sent.push([]) - 1; } };
};

test("a start error reads differently where a window can be shared", async () => {
    const shared = await load();
    assert.equal(shared.module.ocrStartErrorKey("OCR_DISABLED_WINDOW_NOT_FOUND"), "common_error.ocr_window_not_found_wayland");
    assert.equal(shared.module.ocrStartErrorKey("OCR_DISABLED_OTHER"), null);
    const unsupported = await load({ window: { ...SHARED, supported: false } });
    assert.equal(unsupported.module.ocrStartErrorKey("OCR_DISABLED_WINDOW_NOT_FOUND"), null);
});

test("the remembered window is shared again only with a saved restore token", async () => {
    const restore = async (token: unknown) => (await load({ token })).module.ocrShouldRestoreSharedWindow("OCR_DISABLED_WINDOW_NOT_FOUND");
    assert.equal(await restore({ state: "ok", data: "saved-token" }), true);
    for (const token of [undefined, { state: "ok", data: "" }, { state: "ok", data: 7 }, { state: "ok" }, "saved-token", null, () => "saved-token"]) {
        assert.equal(await restore(token), false, String(typeof token === "function" ? "a function" : JSON.stringify(token)));
    }
    const busy = await load({ window: { ...SHARED, busy: true } });
    assert.equal(busy.module.ocrShouldRestoreSharedWindow("OCR_DISABLED_WINDOW_NOT_FOUND"), false);
});

test("sharing asks the desktop with the saved token, keeps the new one and shows the window shared", async () => {
    const s = await load();
    const first = s.hook();
    assert.deepEqual(first.currentOcrSharedWindow, { state: "ok", data: SHARED });
    await first.share();
    assert.deepEqual(s.invoked, [["screencast_start", { restoreToken: "saved-token" }]]);
    assert.deepEqual(s.windowState(), { state: "ok", data: { ...SHARED, active: true } });
    assert.deepEqual(s.sent[0], [["/set/data/ocr_portal_restore_token", "new-token"]]);
    s.invoked.length = 0;
    await s.hook().share({ choose: true });
    assert.deepEqual(s.invoked, [["screencast_start", { restoreToken: null }]], "choosing another window does not restore the saved one");
});

test("the actions stay the same between renders and send with the backend's sender of the latest render", async () => {
    const s = await load();
    const first = s.hook();
    s.nextSender();
    const second = s.hook();
    assert.equal(second.share, first.share);
    await first.share();
    assert.deepEqual(s.sent, [[], [["/set/data/ocr_portal_restore_token", "new-token"]]]);
});

test("without a saved token the desktop asks which window to share", async () => {
    const s = await load({ token: undefined });
    await s.hook().share();
    assert.deepEqual(s.invoked, [["screencast_start", { restoreToken: null }]]);
});

test("while the desktop is being asked, sharing again asks nothing", async () => {
    const s = await load({ window: { ...SHARED, busy: true } });
    await s.hook().share();
    assert.deepEqual([s.invoked, s.sent[0]], [[], []]);
});
