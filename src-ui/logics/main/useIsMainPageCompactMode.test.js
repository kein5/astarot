import assert from "node:assert/strict";
import { test } from "node:test";
import { hooks, loadModule, find, eventTarget, stubGlobals } from "../test/hookHarness.js";

async function fixture(saved, context) {
    // The opened rail listens on the document for Escape and presses outside it.
    const document = { ...eventTarget(), focused: [],
        querySelector: selector => selector === "[data-sidebar-toggle]" ? { focus: () => document.focused.push(selector) } : null };
    stubGlobals(context, { document });
    const runtime = hooks(), requests = [];
    let narrow = true;
    const store = {
        useStore_IsBreakPoint: () => ({ currentIsBreakPoint: { data: narrow } }),
        useStore_IsMainPageCompactMode: () => ({ currentIsMainPageCompactMode: { data: saved, state: "ok" },
            updateIsMainPageCompactMode: value => { saved = value; } }),
        useStore_IsOpenedLanguageSelector: () => ({ currentIsOpenedLanguageSelector: { data: {} } }),
    };
    const logic = await loadModule(new URL("./useIsMainPageCompactMode.js", import.meta.url), runtime, {
        "@store": store, "@useStdoutToPython": { useStdoutToPython: () => ({
            asyncStdoutToPython: endpoint => requests.push(endpoint) }) },
    });
    const { SidebarSection } = await loadModule(new URL("../../views/app/main_page/sidebar_section/SidebarSection.jsx", import.meta.url), runtime, {
        "@store": store, "@logics_main": logic, "./logo/Logo": { Logo: "logo" },
        "./main_function_switch/MainFunctionSwitch": { MainFunctionSwitch: "switches" },
        "./language_settings/LanguageSettings": { LanguageSettings: "languages" },
        "./language_readout/LanguageReadout": { LanguageReadout: "readout" },
        "./open_settings/OpenSettings": { OpenSettings: "settings" },
    });
    const { SidebarCompactModeButton } = await loadModule(new URL("../../views/app/main_page/main_section/top_bar/sidebar_compact_mode_button/SidebarCompactModeButton.jsx", import.meta.url), runtime, {
        "@logics_main": logic,
    });
    const render = () => runtime.render(() => ({ sidebar: SidebarSection(), button: SidebarCompactModeButton() }));
    return { render, requests, document, setNarrow: value => { narrow = value; }, saved: () => saved };
}

for (const saved of [false, true]) {
    test(`automatic narrow sidebar expands and collapses without saving (saved compact=${saved})`, async context => {
        const s = await fixture(saved, context);
        let tree = s.render();
        assert.equal(find(tree.sidebar, node => node.type === "languages"), null);
        assert.ok(find(tree.sidebar, node => node.type === "readout"), "the icon rail keeps the language pair in sight");
        assert.ok(!tree.button.props.disabled, "keyboard and pointer activation must remain available");
        assert.equal(tree.button.props.type, "button");
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
        assert.match(opened.sidebar.props.className, /is_overlay/);
        const inside = { closest: () => null };
        opened.sidebar.ref.current = { contains: target => target === inside };
        s.document.dispatch("pointerdown", { target: inside });
        assert.equal(s.render().button.props["aria-expanded"], true, "a press inside the rail keeps it open");
        // The toggle handles its own press; closing here as well would reopen it.
        s.document.dispatch("pointerdown", { target: { closest: selector => selector === "[data-sidebar-toggle]" ? {} : null } });
        assert.equal(s.render().button.props["aria-expanded"], true);
        s.document.dispatch("keydown", { key: "Escape", defaultPrevented: false });
        assert.equal(s.render().button.props["aria-expanded"], false);
        assert.deepEqual(s.document.focused, ["[data-sidebar-toggle]"], "focus goes back to the toggle");
        assert.doesNotMatch(s.render().sidebar.props.className, /is_overlay/);

        s.render().button.props.onClick();
        s.render();
        s.document.dispatch("pointerdown", { target: { closest: () => null } });
        assert.equal(s.render().button.props["aria-expanded"], false, "a press on the conversation closes it");

        // The opened rail carries its own close button, since the toggle is under it.
        const closeButton = tree => find(tree, node => node.type === "button" && node.props["aria-label"] === "studio.close_sidebar");
        assert.equal(closeButton(s.render().sidebar), null);
        s.render().button.props.onClick();
        closeButton(s.render().sidebar).props.onClick();
        assert.equal(s.render().button.props["aria-expanded"], false);
        assert.equal(s.document.focused.length, 2, "and focus goes back to the toggle");
        assert.deepEqual(s.requests, [], "never saved");

        // A wide window has no overlay, whatever the saved preference.
        s.setNarrow(false);
        assert.doesNotMatch(s.render().sidebar.props.className ?? "", /is_overlay/);
    });
}
