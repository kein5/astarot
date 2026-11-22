import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";
import { hooks, loadModule } from "../test/hookHarness.ts";
import type { HookRuntime } from "../test/hookHarness.ts";
import type { CloseHides } from "./closeBehavior.ts";
import { flush } from "../test/bridgeHarness.ts";

const load = async (runtime: HookRuntime, invoke: (name: string) => Promise<unknown> = async () => true) =>
    loadModule<typeof import("./closeBehavior.ts")>(new URL("./closeBehavior.ts", import.meta.url), runtime, { "@tauri-apps/api/core": { invoke } });

test("the close button is named after what closing does", async () => {
    const { closeButtonLabelKey } = await load(hooks());
    assert.equal(closeButtonLabelKey(true), "studio.close_to_tray");
    assert.equal(closeButtonLabelKey(false), "studio.close");
    assert.equal(closeButtonLabelKey(null), "studio.close_window");
    const read = async (name: string) => await readFile(new URL(`../../../locales/${name}.yml`, import.meta.url), "utf8");
    for (const name of ["en", "ja"]) {
        const text = await read(name);
        for (const key of ["close", "close_to_tray", "close_window"]) assert.match(text, new RegExp(`\\n    ${key}: "`), `${name} ${key}`);
    }
});

test("the answer follows the tray: asked at start and again when the window gets the focus", async context => {
    const listeners = new Map<string, () => void>();
    // A window with only the listeners the hook uses (Node has none).
    Reflect.set(globalThis, "window", {
        addEventListener: (name: string, fn: () => void) => listeners.set(name, fn),
        removeEventListener: (name: string, fn: () => void) => { if (listeners.get(name) === fn) listeners.delete(name); },
    });
    context.onTestFinished(() => { Reflect.deleteProperty(globalThis, "window"); });
    const runtime = hooks(), calls: string[] = [];
    let tray = false;
    const { useCloseHides } = await load(runtime, async name => { calls.push(name); return tray; });
    let value: CloseHides | undefined;
    const Probe = () => { value = useCloseHides(); return null; };
    runtime.render(Probe);
    assert.equal(value, null, "unknown until the core answers");
    await flush();
    runtime.render(Probe);
    assert.equal(value, false);
    assert.deepEqual(calls, ["companion_close_hides"]);
    tray = true;
    const focus = listeners.get("focus");
    assert.ok(focus);
    focus();
    await flush();
    runtime.render(Probe);
    assert.equal(value, true);
    runtime.unmount();
    assert.equal(listeners.size, 0);
});

test("a core that cannot be asked means closing quits", async context => {
    Reflect.set(globalThis, "window", { addEventListener() {}, removeEventListener() {} });
    context.onTestFinished(() => { Reflect.deleteProperty(globalThis, "window"); });
    const runtime = hooks();
    const { useCloseHides } = await load(runtime, async () => { throw Error("no core"); });
    let value: CloseHides | undefined;
    const Probe = () => { value = useCloseHides(); return null; };
    runtime.render(Probe);
    await flush();
    runtime.render(Probe);
    assert.equal(value, false);
    runtime.unmount();
});
