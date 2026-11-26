import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, findIn, find, componentName, componentOf, kitStandIns } from "../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../logics/test/hookHarness.ts";

// The Quick Chat part of the hotkeys page: its key's row, a note for the platforms whose key needs
// one, and the button that opens Quick Chat, the kit's plain Button, which leaves settings first.
async function quickChat(platform: string, inSettingsWindow = false) {
    const runtime = hooks(), calls: unknown[] = [];
    const { Hotkeys } = await loadModule<typeof import("./Hotkeys.tsx")>(new URL("./Hotkeys.tsx", import.meta.url), runtime, {
        "@logics_configs": { useHotkeys: () => ({ currentHotkeys: { data: {}, state: "ok" }, setHotkeys: async () => true,
            openQuickChat: () => calls.push("open quick chat") }) },
        "@tauri-apps/api/core": { invoke: async (command: string) => { calls.push(command); return platform; } },
        "@logics_common": { useIsOpenedConfigPage: () => ({ setIsOpenedConfigPage: (open: boolean) => calls.push(["settings open", open]) }) },
        "../_components/env_readout/EnvReadout": { EnvReadout: "readout" },
        "../_components": { SectionLabelComponent: "heading" },
        "../_components/advanced_section/AdvancedSection": { AdvancedSection: "advanced" },
        "../_components/hint/Hint": { HintDescriptions: "hints" },
        "../_templates/Templates": { HotkeysEntryContainer: "hotkey" },
        "../../../../../../logics/common/settingsWindow.ts": { isSettingsWindow: () => inSettingsWindow,
            handOverQuickChat: async () => { calls.push("hand over"); },
            showingHotkeysPage: async (shown: boolean) => { calls.push(["hotkeys page", shown]); } },
    });
    const part = componentOf(findIn(runtime.render(Hotkeys), (node: TreeNode) => componentName(node) === "QuickChatHotkeyContainer"));
    // The page itself, in the settings window, asks for the hotkeys to wait: that is not this part's.
    calls.length = 0;
    runtime.render(part);
    // The platform comes back from the shell after the first render.
    await Promise.resolve();
    await Promise.resolve();
    return { tree: runtime.render(part), calls };
}

test("Quick Chat opens from the kit's plain Button, which leaves settings first", async () => {
    const { tree, calls } = await quickChat("native");
    const open = findIn(tree, node => node.type === kitStandIns.Button);
    assert.deepEqual([open.props.tone, open.props.className, open.props.children], [undefined, "open_quick_chat", "quick_chat.open"]);
    assert.equal(find(tree, node => node.type === "readout"), null, "a native key needs no note");
    open.props.onClick();
    assert.deepEqual(calls, ["quick_chat_shortcut_platform", ["settings open", false], "open quick chat"]);
});

// #1236: the main window, which runs Quick Chat, opens it, and the settings window stays open, as
// nothing waits for the settings window (decided on 2026-11-26).
test("in the settings window the button leaves the opening to the main window, and the settings stay", async () => {
    const { tree, calls } = await quickChat("native", true);
    findIn(tree, node => node.type === kitStandIns.Button).props.onClick();
    await Promise.resolve();
    assert.deepEqual(calls, ["quick_chat_shortcut_platform", "hand over"]);
});

// The hotkeys wait while the page is shown, so a key pressed to record it does not act. In the
// settings window the main window pauses them until the page goes; in a page of the main window
// they wait while the settings are open, and the page asks nothing.
test("in the settings window the Hotkeys page pauses the hotkeys while it is shown", async () => {
    for (const inSettingsWindow of [true, false]) {
        const runtime = hooks(), calls: unknown[] = [];
        const { Hotkeys } = await loadModule<typeof import("./Hotkeys.tsx")>(new URL("./Hotkeys.tsx", import.meta.url), runtime, {
            "@logics_configs": { useHotkeys: () => ({ currentHotkeys: { data: {}, state: "ok" }, setHotkeys: async () => true, openQuickChat: () => {} }) },
            "@tauri-apps/api/core": { invoke: async () => "native" },
            "@logics_common": { useIsOpenedConfigPage: () => ({ setIsOpenedConfigPage: () => {} }) },
            "../_components/env_readout/EnvReadout": { EnvReadout: "readout" },
            "../_components": { SectionLabelComponent: "heading" },
            "../_components/advanced_section/AdvancedSection": { AdvancedSection: "advanced" },
            "../_components/hint/Hint": { HintDescriptions: "hints" },
            "../_templates/Templates": { HotkeysEntryContainer: "hotkey" },
            "../../../../../../logics/common/settingsWindow.ts": { isSettingsWindow: () => inSettingsWindow, handOverQuickChat: async () => {},
                showingHotkeysPage: async (shown: boolean) => { calls.push(shown); } },
        });
        runtime.render(Hotkeys);
        runtime.render(Hotkeys);
        assert.deepEqual(calls, inSettingsWindow ? [true] : [], "once, as the page is shown");
        runtime.unmount();
        assert.deepEqual(calls, inSettingsWindow ? [true, false] : [], "and the hotkeys resume as it goes");
    }
});

test("a platform whose Quick Chat key needs a note shows it above the button", async () => {
    for (const [platform, words] of [["wayland", "quick_chat.wayland_portal"], ["xwayland", "quick_chat.xwayland_hint"],
        ["unknown", "quick_chat.platform_unknown"]]) {
        const note = findIn((await quickChat(platform)).tree, node => node.type === "readout");
        assert.equal(findIn(note, node => node.type === "p").props.children, words, platform);
    }
});
