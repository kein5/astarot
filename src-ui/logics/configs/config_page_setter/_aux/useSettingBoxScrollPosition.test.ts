import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule } from "../../../test/hookHarness.ts";

// The settings page's scroll position (useSettingBoxScrollPosition.ts): kept in the store, put back
// on the page's scroll container, and set to the top.
interface Saved {
    state: string;
    data: number;
}
const load = async (container: { current: { scrollTop: number } | null } | undefined) => {
    const runtime = hooks(), updates: unknown[] = [];
    const saved: { value: Saved } = { value: { state: "ok", data: 120 } };
    const update = (value: number | ((previous: Saved) => number)) => {
        updates.push(value);
        saved.value = { state: "ok", data: typeof value === "function" ? value(saved.value) : value };
    };
    const module = await loadModule<typeof import("./useSettingBoxScrollPosition.ts")>(new URL("./useSettingBoxScrollPosition.ts", import.meta.url), runtime, {
        "@store": { store: { setting_box_scroll_container: container },
            useStore_SettingBoxScrollPosition: () => ({ currentSettingBoxScrollPosition: saved.value, updateSettingBoxScrollPosition: update }) },
    });
    return { saved, updates, update, hook: () => runtime.render(module.useSettingBoxScrollPosition) };
};

test("the settings page keeps where it was scrolled, scrolls back there, and goes to the top", async () => {
    const element = { scrollTop: 300 };
    const s = await load({ current: element });
    s.hook().saveScrollPosition();
    assert.deepEqual([s.updates, s.saved.value.data], [[300], 300]);
    element.scrollTop = 0;
    s.hook().restoreScrollPosition();
    assert.deepEqual([element.scrollTop, s.saved.value.data], [300, 300], "the kept position is put back and kept");
    s.hook().resetScrollPosition();
    assert.deepEqual([element.scrollTop, s.saved.value.data], [0, 0]);
    const drawn = s.hook();
    assert.deepEqual(drawn.currentSettingBoxScrollPosition, { state: "ok", data: 0 });
    assert.equal(drawn.updateSettingBoxScrollPosition, s.update);
});

test("without the page's scroll container nothing is kept, put back or reset", async () => {
    for (const container of [undefined, { current: null }]) {
        const s = await load(container);
        s.hook().saveScrollPosition();
        s.hook().restoreScrollPosition();
        s.hook().resetScrollPosition();
        assert.deepEqual([s.updates, s.saved.value.data], [[], 120], JSON.stringify(container));
    }
});
