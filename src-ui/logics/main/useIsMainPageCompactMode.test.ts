import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import type { ComponentType, SVGProps } from "react";
import { hooks, loadModule, find, eventTarget, setRef, stubGlobals, unchecked, kitStandIns } from "../test/hookHarness.ts";

async function fixture(saved: boolean, context: TestContext) {
    // The opened rail listens on the document for Escape and presses outside it.
    const focused: string[] = [];
    const document = { ...eventTarget(), focused,
        querySelector: (selector: string) => selector === "[data-sidebar-toggle]" ? { focus: () => document.focused.push(selector) } : null };
    stubGlobals(context, { document });
    const runtime = hooks(), requests: string[] = [];
    let narrow = true;
    const store = {
        useStore_IsBreakPoint: () => ({ currentIsBreakPoint: { data: narrow } }),
        useStore_IsMainPageCompactMode: () => ({ currentIsMainPageCompactMode: { data: saved, state: "ok" },
            updateIsMainPageCompactMode: (value: boolean) => { saved = value; } }),
        useStore_IsOpenedLanguageSelector: () => ({ currentIsOpenedLanguageSelector: { data: selector },
            updateIsOpenedLanguageSelector: (value: unknown) => { selector = value; } }),
        useStore_IsOpenedTranslatorSelector: () => ({ currentIsOpenedTranslatorSelector: { data: list },
            updateIsOpenedTranslatorSelector: (value: boolean) => { list = value; } }),
    };
    let selector: unknown = {};
    let list = false;
    const logic = await loadModule<typeof import("./useIsMainPageCompactMode.ts")>(new URL("./useIsMainPageCompactMode.ts", import.meta.url), runtime, {
        "@store": store, "@useStdoutToPython": { useStdoutToPython: () => ({
            asyncStdoutToPython: (endpoint: string) => requests.push(endpoint) }) },
    });
    const { SidebarSection } = await loadModule<typeof import("../../views/app/main_page/sidebar_section/SidebarSection.tsx")>(new URL("../../views/app/main_page/sidebar_section/SidebarSection.tsx", import.meta.url), runtime, {
        "@store": store, "@logics_main": logic, "./logo/Logo": { Logo: "logo" },
        "./main_function_switch/MainFunctionSwitch": { MainFunctionSwitch: "switches" },
        "./engine_readout/EngineReadout": { EngineReadout: "engine-readout" },
        "./language_settings/LanguageSettings": { LanguageSettings: "languages" },
        "./language_readout/LanguageReadout": { LanguageReadout: "readout" },
        "./open_settings/OpenSettings": { OpenSettings: "settings" },
    });
    const { SidebarCompactModeButton } = await loadModule<typeof import("../../views/app/main_page/main_section/top_bar/sidebar_compact_mode_button/SidebarCompactModeButton.tsx")>(new URL("../../views/app/main_page/main_section/top_bar/sidebar_compact_mode_button/SidebarCompactModeButton.tsx", import.meta.url), runtime, {
        "@logics_main": logic,
    });
    const english = { language: "English", country: "United States", enable: true };
    const { LanguageSelectorOpenButton } = await loadModule<typeof import("../../views/app/main_page/sidebar_section/language_settings/language_selector_open_button/LanguageSelectorOpenButton.tsx")>(new URL("../../views/app/main_page/sidebar_section/language_settings/language_selector_open_button/LanguageSelectorOpenButton.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t: (key: string) => key, i18n: { language: "en" } }) },
        "../../../../../../logics/common/languageNames.ts": { createLanguageNames: () => ({ name: () => ({ language: "English", country: "" }) }) },
        "@store": store, "@logics_main": { ...logic, useLanguageSettings: () => ({ currentSelectedPresetTabNumber: { data: "1" },
            currentSelectedYourLanguages: { data: { 1: { 1: english } } }, currentSelectedTargetLanguages: { data: { 1: { 1: english, 2: english } } } }) },
    });
    // One render for all of them: the hooks share the runtime's slots.
    const render = () => runtime.render(() => ({ sidebar: SidebarSection(), button: SidebarCompactModeButton(),
        hook: logic.useIsMainPageCompactMode(),
        // On purpose: a tag name stands in for the icon component; the test only finds the button.
        language: LanguageSelectorOpenButton({ TurnedOnSvgComponent: unchecked<ComponentType<SVGProps<SVGSVGElement>>>("svg"),
            is_turned_on: true, selector_key: "your_language", target_key: "1" }) }));
    return { render, requests, document, setNarrow: (value: boolean) => { narrow = value; }, saved: () => saved, selector: () => selector,
        setList: (value: boolean) => { list = value; } };
}

for (const saved of [false, true]) {
    test(`automatic narrow sidebar expands and collapses without saving (saved compact=${saved})`, async context => {
        const s = await fixture(saved, context);
        let tree = s.render();
        assert.equal(find(tree.sidebar, node => node.type === "languages"), null);
        assert.ok(find(tree.sidebar, node => node.type === "readout"), "the icon rail keeps the language pair in sight");
        assert.ok(!tree.button.props.disabled, "keyboard and pointer activation must remain available");
        // The kit's icon Button, which is a button that submits nothing.
        assert.deepEqual([tree.button.type, tree.button.props.size, tree.button.props["aria-label"]], [kitStandIns.Button, "icon", "studio.toggle_sidebar"]);
        assert.equal(tree.button.props["aria-expanded"], false);
        tree.button.props.onClick();
        tree = s.render();
        assert.ok(find(tree.sidebar, node => node.type === "languages"));
        assert.equal(find(tree.sidebar, node => node.type === "readout"), null);
        assert.equal(tree.button.props["aria-expanded"], true);
        tree.button.props.onClick();
        tree = s.render();
        assert.equal(find(tree.sidebar, node => node.type === "languages"), null);
        assert.deepEqual(s.requests, []);
        assert.equal(s.saved(), saved);
    });

    test(`leaving narrow mode restores the saved preference and clears temporary expansion (${saved})`, async context => {
        const s = await fixture(saved, context);
        s.render().button.props.onClick();
        assert.equal(s.render().button.props["aria-expanded"], true);
        s.setNarrow(false);
        assert.equal(s.render().button.props["aria-expanded"], !saved);
        s.setNarrow(true);
        assert.equal(s.render().button.props["aria-expanded"], false);
        assert.deepEqual(s.requests, []);
        s.setNarrow(false);
        s.render().button.props.onClick();
        assert.deepEqual(s.requests, [`/set/${saved ? "disable" : "enable"}/main_window_sidebar_compact_mode`]);
        assert.equal(s.saved(), saved, "wide changes still wait for the backend acknowledgement");
    });

    test(`the rail opened in a narrow window lies over the conversation and closes with Escape or a press outside (${saved})`, async context => {
        const s = await fixture(saved, context);
        assert.equal(s.document.added.length, 0, "the icon rail listens to nothing");
        s.render().button.props.onClick();
        const opened = s.render();
        assert.match(opened.sidebar.props.className, /isOverlay/);
        const inside = { nodeType: 1, closest: () => null };
        setRef(opened.sidebar, { contains: (target: unknown) => target === inside });
        s.document.dispatch("pointerdown", { target: inside });
        assert.equal(s.render().button.props["aria-expanded"], true, "a press inside the rail keeps it open");
        // The toggle handles its own press; closing here as well would reopen it.
        s.document.dispatch("pointerdown", { target: { nodeType: 1, closest: (selector: string) => selector === "[data-sidebar-toggle]" ? {} : null } });
        assert.equal(s.render().button.props["aria-expanded"], true);
        // The translator popover is portaled to the body; pressing inside it belongs to the rail.
        s.document.dispatch("pointerdown", { target: { nodeType: 1, closest: (selector: string) => selector === "[data-translator-selector]" ? {} : null } });
        assert.equal(s.render().button.props["aria-expanded"], true);
        s.document.dispatch("keydown", { key: "Escape", defaultPrevented: false });
        assert.equal(s.render().button.props["aria-expanded"], false);
        assert.deepEqual(s.document.focused, ["[data-sidebar-toggle]"], "focus goes back to the toggle");
        assert.doesNotMatch(s.render().sidebar.props.className, /isOverlay/);

        s.render().button.props.onClick();
        s.render();
        s.document.dispatch("pointerdown", { target: { nodeType: 1, closest: () => null } });
        assert.equal(s.render().button.props["aria-expanded"], false, "a press on the conversation closes it");

        // The opened rail carries its own close button, since the toggle is under it.
        const closeButton = (tree: unknown) => find(tree, node => node.type === kitStandIns.Button && node.props["aria-label"] === "studio.close_sidebar");
        assert.equal(closeButton(s.render().sidebar), null);
        s.render().button.props.onClick();
        const close = closeButton(s.render().sidebar);
        assert.ok(close);
        // Its name is also its tooltip, beside the rail.
        assert.equal(find(s.render().sidebar, node => node.type === "tooltip" && node.props.title === "studio.close_sidebar")?.props.placement, "right");
        close.props.onClick();
        assert.equal(s.render().button.props["aria-expanded"], false);
        assert.equal(s.document.focused.length, 2, "and focus goes back to the toggle");
        assert.deepEqual(s.requests, [], "never saved");

        // A wide window has no overlay, whatever the saved preference.
        s.setNarrow(false);
        assert.doesNotMatch(s.render().sidebar.props.className ?? "", /isOverlay/);
    });

    test(`a language selector opened from the rail over a narrow window closes the rail first (${saved})`, async context => {
        const s = await fixture(saved, context);
        s.render().button.props.onClick();
        const opener = find(s.render().language, node => node.type === kitStandIns.Button);
        assert.ok(opener);
        opener.props.onClick();
        assert.deepEqual(s.selector(), { your_language: true, target_language: false, target_key: "1" });
        const tree = s.render();
        assert.equal(tree.button.props["aria-expanded"], false, "the selector's back button and search field are not under the rail");
        assert.doesNotMatch(tree.sidebar.props.className, /isOverlay/);
        assert.deepEqual(s.requests, [], "never saved");
    });

    test(`asking for the translator list shows the full rail (${saved})`, async context => {
        const s = await fixture(saved, context);
        // Narrow: over the conversation, not saved.
        s.render().hook.expandSidebar();
        assert.match(s.render().sidebar.props.className, /isOverlay/);
        assert.ok(find(s.render().sidebar, node => node.type === "languages"));
        assert.deepEqual(s.requests, []);
        // Wide: the full rail while the list is open, and the saved choice is never changed (#562).
        s.setNarrow(false);
        s.render();
        s.render().hook.expandSidebar();
        s.setList(true);
        let tree = s.render();
        assert.ok(find(tree.sidebar, node => node.type === "languages"), "the full rail, with the list's button");
        assert.doesNotMatch(tree.sidebar.props.className, /isOverlay/, "beside the conversation, not over it");
        assert.deepEqual(s.requests, [], "never saved");
        // The list closed: the saved icon rail again.
        s.setList(false);
        s.render();
        tree = s.render();
        assert.equal(Boolean(find(tree.sidebar, node => node.type === "readout")), saved, saved ? "the saved icon rail" : "the full rail, as saved");
        assert.deepEqual(s.requests, []);
    });

    test(`the rail widened for the translator list goes back to the saved icon rail by its toggle, unsaved (${saved})`, async context => {
        const s = await fixture(saved, context);
        s.setNarrow(false);
        s.render();
        s.render().hook.expandSidebar();
        s.setList(true);
        assert.ok(find(s.render().sidebar, node => node.type === "languages"));
        s.render().button.props.onClick();
        // Saved icon rail: the toggle undoes the widening only. A saved full rail: the toggle saves the icon rail, as before.
        assert.deepEqual(s.requests, saved ? [] : ["/set/enable/main_window_sidebar_compact_mode"]);
        if (saved) assert.ok(find(s.render().sidebar, node => node.type === "readout"), "the icon rail again");
    });
}

test("the rail over the conversation never grows wider than the window, so its close button and the space beside it stay", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync(new URL("../../views/app/main_page/sidebar_section/SidebarSection.css.ts", import.meta.url), "utf8");
    const overlay = css.split("export const isOverlay")[1].split("});")[0];
    assert.match(overlay, /width: OVERLAY_RAIL/);
    assert.match(overlay, /marginInlineEnd: `calc\(\$\{ICON_RAIL\} - \$\{OVERLAY_RAIL\}\)`/);
    assert.match(css, /const OVERLAY_RAIL = `min\(\$\{RAIL\}, calc\(100vw - [\d.]+rem\)\)`/);
});
