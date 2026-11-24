import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, findIn, find, componentName, componentOf, kitStandIns } from "../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../logics/test/hookHarness.ts";

// The Quick Chat part of the hotkeys page: its key's row, a note for the platforms whose key needs
// one, and the button that opens Quick Chat, the kit's plain Button, which leaves settings first.
async function quickChat(platform: string) {
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
    });
    const part = componentOf(findIn(runtime.render(Hotkeys), (node: TreeNode) => componentName(node) === "QuickChatHotkeyContainer"));
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

test("a platform whose Quick Chat key needs a note shows it above the button", async () => {
    for (const [platform, words] of [["wayland", "quick_chat.wayland_portal"], ["xwayland", "quick_chat.xwayland_hint"],
        ["unknown", "quick_chat.platform_unknown"]]) {
        const note = findIn((await quickChat(platform)).tree, node => node.type === "readout");
        assert.equal(findIn(note, node => node.type === "p").props.children, words, platform);
    }
});
