import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { hooks, kitStandIns, loadModule, find, stubGlobals, eventTarget, unchecked, setRef } from "../../../../logics/test/hookHarness.ts";

async function fixture(context: TestContext) {
    const runtime = hooks(), focus: string[] = [], changes: [string, boolean][] = [];
    let opened = "update_software";
    const control = (name: string) => ({ isConnected: true, disabled: false, tabIndex: 0,
        getAttribute: () => null, closest: () => null, matches: () => false,
        focus: () => focus.push(name) });
    const opener = control("opener"), fallbackControl = control("main control");
    const fallback = { current: { ...control("main page"), querySelectorAll: () => [fallbackControl] } };
    stubGlobals(context, { document: { ...eventTarget(), activeElement: opener }, HTMLElement: Object });
    const dialogHooks = await loadModule(new URL("../../../../logics/common/useConsentDialog.ts", import.meta.url), runtime);
    const { ModalController } = await loadModule<typeof import("./ModalController.tsx")>(new URL("./ModalController.tsx", import.meta.url), runtime, {
        "../../../../logics/common/useConsentDialog": dialogHooks,
        "@store": {
            useStore_OpenedQuickSetting: () => ({ currentOpenedQuickSetting: { data: opened },
                updateOpenedQuickSetting: (value: string) => { changes.push([value, modal.open]); opened = value; } }),
        },
        "@setting_box": { Updater: "update-settings" },
    });
    const modal = { open: false, opens: 0, showModal() { this.open = true; this.opens++; },
        close() { this.open = false; } };
    // Test data: the main page as far as focus restoring reads it.
    const render = () => runtime.render(ModalController, { fallback: unchecked<Parameters<typeof ModalController>[0]["fallback"]>(fallback) }, tree => {
        const dialog = find(tree, node => node.type === "dialog");
        if (dialog) setRef(dialog, modal);
    });
    context.onTestFinished(() => runtime.unmount());
    return { render, modal, focus, changes, opener, fallbackControl, runtime,
        setOpened: (value: string) => { opened = value; } };
}

test("quick settings uses a named native modal with initial close focus", async context => {
    const s = await fixture(context), tree = s.render();
    assert.ok(tree);
    assert.equal(tree.type, "dialog", "native modal confines Tab/Shift+Tab and makes the background inert");
    assert.equal(tree.props["aria-label"], "config_page.side_menu_labels.updater");
    // #939: the subtitle overlay switches in place; this dialog shows only the update page.
    assert.equal(s.modal.open, true);
    assert.equal(s.modal.opens, 1);
    // The close button is the kit's plain Button (decided on 2026-11-25), in its row at the panel's top
    // right; the frame and the backdrop stay the modal's own (decision 2 of #764).
    const close = find(tree, node => node.type === kitStandIns.Button);
    assert.ok(close);
    assert.deepEqual([close.props.autoFocus, close.props.tone, close.props.children], [true, undefined, "common.close_button_label"]);
    const row = find(tree, node => node.props?.className === "close_row");
    assert.equal(find(row, node => node.type === kitStandIns.Button)?.props.children, "common.close_button_label");
    assert.equal(tree.props.className, "container");
    s.render();
    assert.equal(s.modal.opens, 1, "ordinary rerenders do not reopen the dialog");
});

for (const action of ["close button", "backdrop", "Escape"]) {
    for (const openerState of ["present", "removed", "disabled"]) {
        test(`quick settings: ${action} closes before unmount and restores focus (${openerState} opener)`, async context => {
            const s = await fixture(context), tree = s.render();
            assert.ok(tree);
            if (openerState === "removed") s.opener.isConnected = false;
            if (openerState === "disabled") s.opener.disabled = true;
            if (action === "Escape") {
                let prevented = false;
                tree.props.onCancel({ preventDefault: () => { prevented = true; } });
                assert.equal(prevented, true);
            } else if (action === "backdrop") {
                const backdrop = find(tree, node => node.props?.className === "bg_onclick_close_area");
                assert.ok(backdrop);
                backdrop.props.onClick();
            } else {
                const close = find(tree, node => node.type === kitStandIns.Button);
                assert.ok(close);
                close.props.onClick();
            }
            assert.deepEqual(s.changes, [["", false]], "close the native dialog before removing its content");
            assert.equal(s.render(), null);
            await Promise.resolve();
            assert.deepEqual(s.focus, [openerState === "present" ? "opener" : "main control"]);
        });
    }
}

test("external dismissal returns focus to the main page when every fallback control is unavailable", async context => {
    const s = await fixture(context);
    s.render();
    s.opener.isConnected = false;
    s.fallbackControl.disabled = true;
    s.setOpened("");
    s.render();
    await Promise.resolve();
    assert.equal(s.modal.open, false);
    assert.deepEqual(s.focus, ["main page"]);
});
