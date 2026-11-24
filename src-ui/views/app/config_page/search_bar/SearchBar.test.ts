import assert from "node:assert/strict";
import { test, vi } from "vitest";
import type { TestContext } from "vitest";
import { hooks, loadModule, find, setRef, stubGlobals, eventTarget } from "../../../../logics/test/hookHarness.ts";
import * as searchTargets from "../../../../logics/configs/config_page_setter/_aux/configSearchTargets.ts";
import * as revealSettingModule from "../../../../logics/configs/revealSetting.ts";

const key = (name: string) => ({ key: name, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} });

// The page as far as the search reads it: what has the focus and where a setting's row is.
interface FakeDocument extends ReturnType<typeof eventTarget> {
    body: object;
    activeElement?: unknown;
    querySelector?: (selector: string) => unknown;
}
interface Options {
    reducedMotion?: boolean;
    control?: boolean;
    delayed?: boolean;
}

async function setup(t: TestContext, { reducedMotion = false, control = true, delayed = false }: Options = {}) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const document: FakeDocument = { ...eventTarget(), body: {} }, window = { matchMedia: (query: string) => {
        assert.equal(query, "(prefers-reduced-motion: reduce)"); return { matches: reducedMotion };
    } };
    let cleanup: (() => void) | undefined;
    t.onTestFinished(() => cleanup?.());
    stubGlobals(t, { document, window, CSS: { escape: (value: string) => value.replaceAll('"', '\\"') } });
    const ancestors = { tagName: "DETAILS", open: false, parentElement: { tagName: "DETAILS", open: false } };
    const destination = { matches: (selector: string) => selector.startsWith("input,"), closest: () => null, getClientRects: () => [1],
        focus: () => { assert.equal(ancestors.open, true); document.activeElement = destination; } };
    const help = { ...destination, matches: () => false, focus: () => { document.activeElement = help; } };
    const scrolls: unknown[] = [], classes = new Set<string>(), attributes = new Map<string, string>();
    const row = { ...eventTarget(), parentElement: ancestors, querySelectorAll: () => control ? [help, destination] : [],
        scrollIntoView: (options: unknown) => scrolls.push(options),
        classList: { add: (value: string) => classes.add(value), remove: (value: string) => classes.delete(value) },
        getAttribute: (name: string) => attributes.get(name) ?? null, setAttribute: (name: string, value: string) => attributes.set(name, value),
        removeAttribute: (name: string) => attributes.delete(name), focus: () => { document.activeElement = row; } };
    let available = !delayed;
    document.querySelector = selector => available && selector.includes('data-setting-id="osc"') ? row : null;
    const hookRuntime = hooks(), tabs: string[] = [];
    const { useConfigSearch } = await loadModule<typeof import("../../../../logics/configs/config_page_setter/_aux/useConfigSearch.ts")>(new URL("../../../../logics/configs/config_page_setter/_aux/useConfigSearch.ts", import.meta.url), hookRuntime, {
        "@useI18n": { useI18n: () => ({ t: (name: string) => name, i18n: { language: "ja" } }) },
        "@store": { useStore_SelectedConfigTabId: () => ({ currentSelectedConfigTabId: { data: "appearance" }, updateSelectedConfigTabId: (tab: string) => tabs.push(tab) }) },
        "@logics_configs": { useOcr: () => ({ currentSelectableOcrSourceLanguageList: { data: {} }, currentOcrSourceLanguage: { data: "ja" } }) },
        "../../../transcription/useRealtimeASR": { useRealtimeASR: () => ({ models: {}, settings: {} }) },
        "../../../common/languageNames.ts": { createLanguageNames: () => ({ fromCode: (name: string) => name }) },
        
        "@ui_configs": { ui_configs: {} },
        "./configSearchTargets.ts": searchTargets, "../../revealSetting.ts": revealSettingModule,
        "@root/locales/config.ts": { getResource: () => ({ config_page: { advanced_settings: { osc: { label: "OSC", desc: "OSC port" } } } }) },
    });
    const runtime = hooks();
    let hook = hookRuntime.render(useConfigSearch);
    hook.setQuery("OSC"); hook = hookRuntime.render(useConfigSearch);
    const { SearchBar } = await loadModule<typeof import("./SearchBar.tsx")>(new URL("./SearchBar.tsx", import.meta.url), runtime, {
        "@store": { useStore_IsBreakPoint: () => ({ currentIsBreakPoint: { data: false } }) },
        "@logics_configs": { useConfigSearch: () => hook },
        "../sidebar_section/SidebarSection.tsx": { TabIcon: () => null },
        "@common_components": { Empty: "empty", EmptyDescription: "empty-description" },
    });
    const search = { focus: () => { document.activeElement = search; }, blur: () => { document.activeElement = document.body; } };
    const render = () => {
        const field = find(runtime.render(SearchBar, {}, tree => {
            const input = find(tree, node => node.type === "input");
            assert.ok(input);
            setRef(input, search);
        }), node => node.type === "input");
        assert.ok(field);
        return field;
    };
    search.focus(); render().props.onFocus();
    cleanup = () => { runtime.unmount(); hookRuntime.unmount(); };
    return { render, search, document, ancestors, destination, row, scrolls, classes, attributes, tabs,
        setAvailable: () => { available = true; }, navigate: hook.navigateToSetting };
}

for (const reducedMotion of [false, true]) test(`search Enter opens ancestors and focuses destination (reduced motion: ${reducedMotion})`, async t => {
    const s = await setup(t, { reducedMotion, delayed: true });
    s.render().props.onKeyDown(key("ArrowDown"));
    s.render().props.onKeyDown(key("Enter"));
    assert.equal(s.document.activeElement, s.search); // Keep focus until the destination is mounted.
    vi.advanceTimersByTime(60);
    s.setAvailable(); vi.advanceTimersByTime(40);
    assert.deepEqual(s.tabs, ["advanced_settings"]);
    assert.equal(s.ancestors.open, true); assert.equal(s.ancestors.parentElement.open, true);
    assert.equal(s.document.activeElement, s.destination);
    assert.deepEqual(s.scrolls, [{ behavior: reducedMotion ? "instant" : "smooth", block: "center" }]);
    assert.ok(s.classes.has("search_target_highlight"));
});

test("search Escape keeps input focus, closes results and allows typing again", async t => {
    const s = await setup(t);
    const event = key("Escape"); s.render().props.onKeyDown(event);
    assert.equal(event.defaultPrevented, true);
    assert.equal(s.document.activeElement, s.search);
    assert.equal(s.render().props["aria-expanded"], false);
    assert.deepEqual(s.tabs, []);
    s.render().props.onChange({ target: { value: "OSC" } });
    assert.equal(s.render().props["aria-expanded"], true);
});

test("search focuses an empty row temporarily and does not navigate on IME Enter", async t => {
    const s = await setup(t, { control: false });
    s.render().props.onKeyDown({ ...key("Enter"), nativeEvent: { isComposing: true } });
    assert.deepEqual(s.tabs, []);
    s.render().props.onKeyDown(key("Enter")); vi.advanceTimersByTime(60);
    assert.equal(s.document.activeElement, s.row);
    assert.equal(s.attributes.get("tabindex"), "-1");
    s.row.dispatch("blur", {});
    assert.equal(s.attributes.has("tabindex"), false);
});


