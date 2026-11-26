import assert from "node:assert/strict";
import { test } from "vitest";
import { find, hooks, loadModule, nodesIn } from "../../../../logics/test/hookHarness.ts";
import * as closeBehavior from "../../../../logics/common/closeBehavior.ts";

// The title bar's three buttons are icons. Each one's name is also its tooltip (#766), so what
// closing does here, quit or stay in the tray, is seen before the button is pressed.

async function titleBar(hides: boolean | null, inSettingsWindow = false) {
    const runtime = hooks(), calls: string[] = [];
    const { WindowTitleBar } = await loadModule<typeof import("./WindowTitleBar.tsx")>(new URL("./WindowTitleBar.tsx", import.meta.url), runtime, {
        "@logics_common": { useWindow: () => ({ asyncCloseApp: () => calls.push("close"), asyncToggleMaximizeApp: () => calls.push("maximize"),
            asyncMinimizeApp: () => calls.push("minimize") }) },
        "../../../../logics/common/closeBehavior.ts": { closeButtonLabelKey: closeBehavior.closeButtonLabelKey,
            useCloseHides: (ask?: () => Promise<unknown>) => { if (ask) calls.push("not asked"); return hides; } },
        "../../../../logics/common/settingsWindow.ts": { isSettingsWindow: () => inSettingsWindow },
    });
    // The tooltip is drawn as an element named "tooltip" that keeps the bubble's words (hookHarness).
    const tips = nodesIn(runtime.render(WindowTitleBar)).filter(node => node.type === "tooltip").map(tip => {
        const button = find(tip.props.children, node => node.type === "button");
        assert.ok(button);
        return { words: tip.props.title, side: tip.props.placement, bare: tip.props.bare, button };
    });
    const title = find(runtime.render(WindowTitleBar), node => node.type === "span")?.props.children;
    return { tips, calls, title };
}

test("each button of the title bar shows its name as a tooltip under it", async () => {
    const { tips, calls } = await titleBar(false);
    assert.deepEqual(tips.map(tip => tip.words), ["studio.minimize", "studio.maximize", "studio.close"]);
    for (const tip of tips) {
        assert.equal(tip.button.props["aria-label"], tip.words, "the tooltip is the name, so nothing is read twice");
        assert.equal(tip.button.props.title, undefined);
        // Under the bar, which is the window's top edge; the wrapper adds no box to the bar.
        assert.deepEqual([tip.side, tip.bare], ["bottom", true]);
        tip.button.props.onClick();
    }
    assert.deepEqual(calls, ["minimize", "maximize", "close"]);
});

test("where closing keeps the app in the tray, the close button's tooltip says so", async () => {
    assert.equal((await titleBar(true)).tips[2].words, "studio.close_to_tray");
    // Until the tray is known, the button only says that it closes the window.
    assert.equal((await titleBar(null)).tips[2].words, "studio.close_window");
});

// #1236: the settings window's title bar names it, and its close button closes only it, so it does
// not ask whether closing keeps the app in the tray.
test("the settings window's title bar names it, and its close button says it closes the settings", async () => {
    const { tips, calls, title } = await titleBar(false, true);
    assert.equal(title, "studio.settings_window_title");
    assert.equal(tips[2].words, "studio.close_settings");
    assert.ok(calls.includes("not asked"));
    assert.equal((await titleBar(false)).title, "ASTAROT");
});
