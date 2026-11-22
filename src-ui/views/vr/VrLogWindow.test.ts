import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, find, unchecked, drawWith } from "../../logics/test/hookHarness.ts";

test("closed VR log renders no body or subscribers and retains its saved view across reopen", async () => {
    const runtime = hooks();
    let reads = 0;
    const LogBox = () => null;
    const { VrLogWindow } = await loadModule<typeof import("./VrLogWindow.tsx")>(new URL("./VrLogWindow.tsx", import.meta.url), runtime, {
        "@logics_configs": { useVr: () => {
            reads++;
            return { currentOverlayVrPanelLocked: { data: false }, currentOverlayVrPanelFontSize: { data: 24 } };
        } },
        "../app/main_page/main_section/message_container/log_box/LogBox": { LogBox },
        "./VrWindow": { VrWindow: () => null },
    });
    // Test data: the window's props without onClose, which nothing here calls.
    const closed = unchecked<Parameters<typeof VrLogWindow>[0]>({ open: false });
    const open = unchecked<Parameters<typeof VrLogWindow>[0]>({ open: true });
    assert.equal(runtime.render(VrLogWindow, closed), null);
    assert.equal(reads, 0);
    const opened = runtime.render(VrLogWindow, open);
    assert.ok(opened);
    const bodyRuntime = hooks();
    // The element the window returns draws its body, a function component.
    const body = drawWith(bodyRuntime, opened);
    const log = find(body, node => node.type === LogBox);
    assert.ok(log);
    const savedView = log.props.savedView;
    assert.equal(reads, 1);
    savedView.current = { follow: false, scrollTop: 123 };
    bodyRuntime.unmount();
    assert.equal(runtime.render(VrLogWindow, closed), null);
    // Even repeated parent updates while closed never reach the body/useVr/LogBox.
    assert.equal(runtime.render(VrLogWindow, closed), null);
    assert.equal(reads, 1);
    const reopened = runtime.render(VrLogWindow, open);
    assert.ok(reopened);
    assert.equal(reopened.props.savedView, savedView);
    assert.deepEqual(reopened.props.savedView.current, { follow: false, scrollTop: 123 });
    runtime.unmount();
});
