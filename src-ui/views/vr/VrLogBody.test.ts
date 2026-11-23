import assert from "node:assert/strict";
import { test } from "vitest";
import { drawWith, findIn, hooks, loadModule } from "../../logics/test/hookHarness.ts";

// The open VR log: the log's own frame, which can be resized and says when it cannot be grabbed,
// and the main window's log drawn at the size the toolbar's A− and A＋ set. VrLogWindow.test.ts
// covers what stays while the log is closed.

const LogBox = () => null, VrWindow = () => null;

async function openLog(locked: unknown, fontSize: number) {
    const runtime = hooks();
    const { VrLogWindow } = await loadModule<typeof import("./VrLogWindow.tsx")>(new URL("./VrLogWindow.tsx", import.meta.url), runtime, {
        "@logics_configs": { useVr: () => ({ currentOverlayVrPanelLocked: { data: locked }, currentOverlayVrPanelFontSize: { data: fontSize } }) },
        "../app/main_page/main_section/message_container/log_box/LogBox": { LogBox },
        "./VrWindow": { VrWindow },
    });
    let closed = 0;
    const window = runtime.render(VrLogWindow, { open: true, onClose: () => { closed++; } });
    assert.ok(window);
    return { frame: drawWith(hooks(), window), closed: () => closed };
}

test("the open log is a resizable window titled for the log that closes with its button", async () => {
    const view = await openLog(false, 17);
    assert.equal(view.frame.type, VrWindow);
    assert.deepEqual([view.frame.props.title, view.frame.props.is_resizable, view.frame.props.is_grab_locked], ["vr_panel.window_log", true, false]);
    assert.equal(typeof view.frame.props.Icon, "function");
    view.frame.props.onClose();
    assert.equal(view.closed(), 1);
});

test("the log says it cannot be grabbed only while the toolbar's lock is on", async () => {
    assert.equal((await openLog(true, 17)).frame.props.is_grab_locked, true);
    for (const locked of [false, "true", null]) assert.equal((await openLog(locked, 17)).frame.props.is_grab_locked, false, String(locked));
});

test("the log's text is drawn at the size the toolbar sets", async () => {
    const view = await openLog(false, 24);
    const wrapper = findIn(view.frame, node => node.type === "div");
    assert.deepEqual(wrapper.props.style, { "--vr_log_font_size": "24px" });
    assert.equal(findIn(wrapper, node => node.type === LogBox).props.savedView.current, null);
});
