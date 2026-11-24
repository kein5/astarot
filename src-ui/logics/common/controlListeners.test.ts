import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { hooks, loadModule, findIn, eventTarget, setRef, unchecked } from "../test/hookHarness.ts";
import type { SliderProps } from "../../views/app/config_page/setting_section/setting_box/_components/slider/Slider.tsx";
import * as fieldErrors from "../configs/fieldErrors.ts";

const componentRoot = "../../views/app/config_page/setting_section/setting_box/_components/";
const pointer = (x: number, y = 0) => ({ button: 0, clientX: x, clientY: y, preventDefault() {} });
const track = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) };

test("slider installs listeners once per drag, reads current values/callbacks and cleans up", async t => {
    const runtime = hooks(), window = eventTarget(), changed: [number, number][] = [], committed: [number, number][] = [];
    Reflect.set(globalThis, "window", window);
    t.onTestFinished(() => { runtime.unmount(); Reflect.deleteProperty(globalThis, "window"); });
    let version = 0, value = 0;
    const { Slider } = await loadModule<typeof import("../../views/app/config_page/setting_section/setting_box/_components/slider/Slider.tsx")>(new URL(`${componentRoot}slider/Slider.tsx`, import.meta.url), runtime, {
        "@logics_configs": { useSliderLogic: () => {
            const current = version;
            return { ui_value: value, onChangeFunction: (next: number) => { value = next; changed.push([current, next]); },
                onChangeCommittedFunction: (next: number) => committed.push([current, next]) };
        } },
    });
    const props: { min: number; max: number; step: number; orientation?: SliderProps["orientation"] } = { min: 0, max: 100, step: 1 };
    // Test data: only the fields the stand-in slider logic leaves the slider to read.
    const render = () => runtime.render(Slider, unchecked<SliderProps>(props), tree => {
        setRef(findIn(tree, node => node.props?.onPointerDown), track);
    });
    const start = () => findIn(render(), node => node.props?.onPointerDown).props.onPointerDown(pointer(10));
    start(); render();
    const installed = [...window.added];
    assert.deepEqual(installed.map(([type]) => type), ["pointermove", "pointerup"]);
    for (const x of [20, 30, 40]) {
        version++;
        render();
        window.dispatch("pointermove", pointer(x));
        render();
    }
    assert.deepEqual(changed, [[0, 10], [1, 20], [2, 30], [3, 40]]);
    window.dispatch("pointermove", pointer(40));
    assert.equal(changed.length, 4); // Compares with the latest ui_value.
    props.max = 200; props.orientation = "vertical"; version++;
    render();
    window.dispatch("pointerup", pointer(0, 25));
    render();
    assert.deepEqual(committed, [[4, 150]]);
    assert.deepEqual(window.added, installed);
    assert.deepEqual(window.removed, installed);
    start(); render();
    assert.equal(window.added.length, 4);
    runtime.unmount();
    assert.deepEqual(window.removed, window.added);
    window.dispatch("pointerup", pointer(0));
    assert.equal(committed.length, 1);
});

for (const timing of ["on_change", "on_change_committed"] as const) test(`slider retains production ${timing} debounce/commit behavior`, async t => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const runtime = hooks(), window = eventTarget(), sent: number[] = [];
    Reflect.set(globalThis, "window", window);
    t.onTestFinished(() => { runtime.unmount(); Reflect.deleteProperty(globalThis, "window"); });
    const settings = await loadModule<typeof import("../configs/config_page_setter/useSettingsLogics.ts")>(new URL("../configs/config_page_setter/useSettingsLogics.ts", import.meta.url), runtime, { "../fieldErrors.ts": fieldErrors,
        "@store": {}, "@logics_common": {}, "@utils": {}, 
    });
    const { Slider } = await loadModule<typeof import("../../views/app/config_page/setting_section/setting_box/_components/slider/Slider.tsx")>(new URL(`${componentRoot}slider/Slider.tsx`, import.meta.url), runtime, {
        "@logics_configs": settings,
    });
    const props: SliderProps = { min: 0, max: 100, step: 1, variable: 0, state: "ok", setter_timing: timing,
        setterFunction: value => { sent.push(value); return true; } };
    const render = () => runtime.render(Slider, props, tree => { setRef(findIn(tree, node => node.props?.onPointerDown), track); });
    findIn(render(), node => node.props?.onPointerDown).props.onPointerDown(pointer(10));
    render();
    window.dispatch("pointermove", pointer(20)); render();
    vi.advanceTimersByTime(100);
    window.dispatch("pointermove", pointer(30)); render();
    vi.advanceTimersByTime(199);
    assert.deepEqual(sent, []);
    window.dispatch("pointerup", pointer(30)); render();
    if (timing === "on_change") {
        assert.deepEqual(sent, []);
        vi.advanceTimersByTime(1);
    }
    assert.deepEqual(sent, [30]);
    assert.deepEqual(window.added.map(([type]) => type), ["pointermove", "pointerup"]);
    assert.deepEqual(window.removed, window.added);
    findIn(render(), node => node.props?.onPointerDown).props.onPointerDown(pointer(40)); render();
    runtime.unmount();
    vi.advanceTimersByTime(1000);
    assert.deepEqual(sent, [30]);
    assert.deepEqual(window.removed, window.added);
});

test("dropdown keeps open listeners through renders, uses the latest updater and cleans up", async t => {
    const runtime = hooks(), document = eventTarget(), window = { ...eventTarget(), innerHeight: 800 }, updates: [number, string][] = [];
    Reflect.set(globalThis, "document", document); Reflect.set(globalThis, "window", window);
    t.onTestFinished(() => { runtime.unmount(); Reflect.deleteProperty(globalThis, "document"); Reflect.deleteProperty(globalThis, "window"); });
    let opened = "", version = 0;
    const { _DropdownMenu } = await loadModule<typeof import("../../views/app/config_page/setting_section/setting_box/_components/_atoms/_dropdown_menu/_DropdownMenu.tsx")>(new URL(`${componentRoot}_atoms/_dropdown_menu/_DropdownMenu.tsx`, import.meta.url), runtime, {
        "@store": { useStore_IsOpenedDropdownMenu: () => {
            const current = version++;
            return { currentIsOpenedDropdownMenu: { data: opened },
                updateIsOpenedDropdownMenu: (value: string) => { opened = value; updates.push([current, value]); } };
        } },
    });
    const props = { dropdown_id: "test", state: "ok", list: { one: "One", two: "Two" }, selected_id: "one", selectFunction() {} };
    const inside = {}, container = { contains: (target: unknown) => target === inside,
        getBoundingClientRect: () => ({ top: 200, bottom: 240 }) };
    const render = () => runtime.render(_DropdownMenu, props, tree => {
        setRef(tree, container);
        setRef(findIn(tree, node => node.props?.role === "listbox"), { offsetHeight: 200, children: [] });
    });
    findIn(render(), node => node.props?.role === "combobox").props.onClick();
    render();
    const installed = [...document.added];
    assert.deepEqual(installed.map(([type]) => type), ["pointerdown", "keydown"]);
    for (let i = 0; i < 4; i++) render();
    const latest = version - 1;
    document.dispatch("pointerdown", { target: inside });
    document.dispatch("keydown", { key: "Enter" });
    assert.equal(opened, "test");
    document.dispatch("keydown", { key: "Escape" });
    assert.deepEqual(updates.at(-1), [latest, ""]);
    render();
    assert.deepEqual(document.added, installed);
    assert.deepEqual(document.removed, installed);
    assert.deepEqual(window.removed, window.added);
    findIn(render(), node => node.props?.role === "combobox").props.onClick(); render(); render();
    document.dispatch("pointerdown", { target: {} });
    assert.deepEqual(updates.at(-1), [version - 1, ""]);
    runtime.unmount();
    assert.deepEqual(document.removed, document.added);
    assert.deepEqual(window.removed, window.added);
});
