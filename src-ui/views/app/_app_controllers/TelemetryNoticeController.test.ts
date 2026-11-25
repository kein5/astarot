import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { hooks, kitStandIns, loadModule, find, nodesIn } from "../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../logics/test/hookHarness.ts";

const TelemetryContents = () => null;

async function setup(context: TestContext, notice: unknown) {
    const runtime = hooks(), sent: unknown[] = [], refreshed: boolean[] = [];
    const state = { current: notice };
    const { TelemetryNoticeController } = await loadModule<typeof import("./TelemetryNoticeController.tsx")>(new URL("./TelemetryNoticeController.tsx", import.meta.url), runtime, {
        "@logics_configs": { useOthers: () => ({
            currentTelemetryNotice: state.current,
            setTelemetryNotice: async (value: unknown) => { sent.push(value); },
            getTelemetry: () => refreshed.push(true),
        }) },
        "../../../logics/common/useConsentDialog": { useConsentDialog: (open: unknown) => ({ dialog: { current: null, open } }) },
        "../config_page/setting_section/setting_box/_components/telemetry/TelemetryContents": { TelemetryContents },
    });
    context.onTestFinished(() => runtime.unmount());
    const render = () => runtime.render(TelemetryNoticeController);
    const buttons = () => {
        const found: TreeNode[] = [];
        // The answers and "later" are the kit's Button.
        find(render(), node => { if (node.type === kitStandIns.Button) found.push(node); return false; });
        return found;
    };
    return { render, buttons, sent, refreshed, state, remount: runtime.remount };
}

test("the notice is asked only while the backend says it is pending", async context => {
    for (const notice of [
        { state: "ok", data: { pending: false, enabled: true } },
        // Not known yet, or a write under way: no dialog is shown on a guess.
        { state: "pending", data: { pending: true, enabled: true } },
        { state: "ok", data: null },
    ]) {
        const s = await setup(context, notice);
        assert.equal(s.render(), null);
    }
    const s = await setup(context, { state: "ok", data: { pending: true, enabled: true } });
    // The kit's Dialog, shown while the notice is pending and named by its title alone, as before (D-43).
    const tree = s.render();
    // In the forms' section (the words) and the shared host, which takes no room of its own.
    assert.deepEqual(String(tree?.props.className).split(" ").sort(), ["container", "host"]);
    const dialog = find(tree, node => node.type === kitStandIns.Dialog);
    assert.ok(dialog);
    assert.deepEqual([dialog.props.open, "aria-describedby" in dialog.props, dialog.props["aria-describedby"]], [true, true, undefined]);
    assert.equal(find(dialog, node => node.type === kitStandIns.DialogTitle)?.props.children, "telemetry_notice.title");
    const texts: unknown[] = [];
    find(dialog, node => { if (node.type === "p") texts.push(node.props.children); return false; });
    // Why it is asked, what is sent, what is not, and where to change it.
    assert.deepEqual(texts, ["telemetry_notice.purpose", "telemetry_notice.what", "telemetry_notice.not_sent", "telemetry_notice.change"]);
    // The event itself can be read before choosing; in the notice, without a list of what was sent.
    const contents = find(dialog, node => node.type === TelemetryContents);
    assert.ok(contents);
    assert.equal(contents.props.with_sent, undefined);
    // The two answers, then a way out that is not an answer.
    assert.deepEqual(s.buttons().map(button => button.props.children),
        ["telemetry_notice.send", "telemetry_notice.dont_send", "telemetry_notice.later"]);
    // The answers are the kit's plain Button in the footer, neither of them first in focus; "later"
    // is the kit's quiet Button on its own line under them (decided on 2026-11-25).
    const footer = find(dialog, node => node.type === kitStandIns.DialogFooter);
    assert.deepEqual(nodesIn(footer).filter(node => node.type === kitStandIns.Button).map(node => [node.props.children, node.props.tone, node.props.autoFocus]),
        [["telemetry_notice.send", undefined, undefined], ["telemetry_notice.dont_send", undefined, undefined]]);
    const later = [dialog.props.children].flat(3).find((child: TreeNode) => child?.props?.children === "telemetry_notice.later");
    assert.deepEqual([later?.type, later?.props.tone, later?.props.className, later?.props.autoFocus], [kitStandIns.Button, "quiet", "ownLine", undefined]);
});

test("each answer is sent once", async context => {
    for (const [index, send] of [[0, true], [1, false]] as const) {
        const s = await setup(context, { state: "ok", data: { pending: true, enabled: true } });
        await s.buttons()[index].props.onClick();
        assert.deepEqual(s.sent, [{ send }]);
        // The switch in the settings is asked to show the same choice.
        assert.deepEqual(s.refreshed, [true]);
        // A second press while the first is on its way does nothing, and "later" is no longer offered.
        assert.equal(s.buttons().every(button => button.props.disabled === true), true);
        await s.buttons()[index].props.onClick();
        s.buttons()[2].props.onClick();
        assert.deepEqual(s.sent, [{ send }]);
        assert.notEqual(s.render(), null);
    }
});

test("Decide later and Escape put the notice away for this run without answering", async context => {
    // While the dialog is open the window's own buttons cannot be pressed: there must be a way out.
    const later = await setup(context, { state: "ok", data: { pending: true, enabled: true } });
    later.buttons()[2].props.onClick();
    assert.equal(later.render(), null);
    assert.deepEqual(later.sent, []);
    assert.deepEqual(later.refreshed, []);

    const dismissed = await setup(context, { state: "ok", data: { pending: true, enabled: true } });
    const dialog = find(dismissed.render(), node => node.type === kitStandIns.Dialog);
    assert.ok(dialog);
    // Escape: the kit's Dialog keeps it open and asks the page (Dialog.test.ts), which closes it
    // itself (so focus goes back where it was); no answer is sent.
    dialog.props.onOpenChange(false);
    assert.equal(dismissed.render(), null);
    assert.deepEqual(dismissed.sent, []);
});

// #563: changing the UI language drew the main page again (until #904), and the notice put away
// opened again at once. The engine starting again still draws it again (the start-up lock).
test("a notice put away stays away when the main page is drawn again", async context => {
    const s = await setup(context, { state: "ok", data: { pending: true, enabled: true } });
    s.buttons()[2].props.onClick();
    s.remount();
    assert.equal(s.render(), null);
    assert.deepEqual(s.sent, []);
});
