import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, findIn } from "../../../../../logics/test/hookHarness.ts";

// #912: the composer starts at the ratio already known (the saved one, or the store's default),
// so the log above does not jump once the first frame is drawn.
test("the composer's first frame is drawn at the ratio already known", async () => {
    const runtime = hooks();
    const { MessageContainer } = await loadModule<typeof import("./MessageContainer.tsx")>(new URL("./MessageContainer.tsx", import.meta.url), runtime, {
        "react-resizable-layout": { useResizable: () => ({ position: 0, separatorProps: {} }) },
        "./log_box/LogBox": { LogBox: "log" },
        "./message_log_settings_container/MessageLogSettingsContainer": { MessageLogSettingsContainer: "log-settings" },
        "./message_input_box/MessageInputBox": { MessageInputBox: "composer" },
        "./message_input_box/ChatboxLengthWarning": { ChatboxLengthWarning: "warning" },
        "@logics_main": { useMessageInputBoxRatio: () => ({ currentMessageInputBoxRatio: { data: 35 }, asyncSetMessageInputBoxRatio: () => {} }) },
        "@logics_common": { MessageActionsProvider: "provider" },
    });
    const tree = runtime.render(MessageContainer.type, {});
    const composer = findIn(tree, node => node.props?.className === "message_box_resize_wrapper");
    assert.equal(composer.props.style.height, "35%");
    runtime.unmount();
});
