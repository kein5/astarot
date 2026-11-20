import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { hooks, loadModule, find, stubGlobals, eventTarget, unchecked } from "../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../logics/test/hookHarness.ts";

// React's element type leaves out ref, which the dialog and its close button carry.
const refOf = (node: TreeNode): { current: unknown } | null | undefined => Reflect.get(node, "ref");

async function fixture(context: TestContext) {
    const runtime = hooks(), focus: string[] = [], changes: [string, boolean][] = [];
    let opened = "overlay", dropdown = "";
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
            useStore_IsOpenedDropdownMenu: () => ({ currentIsOpenedDropdownMenu: { data: dropdown } }),
        },
        "@setting_box": { Vr: "vr-settings", Updater: "update-settings" },
    });
    const modal = { open: false, opens: 0, showModal() { this.open = true; this.opens++; },
        close() { this.open = false; } };
    // Test data: the main page as far as focus restoring reads it.
    const render = () => runtime.render(ModalController, { fallback: unchecked<Parameters<typeof ModalController>[0]["fallback"]>(fallback) }, tree => {
        const dialog = find(tree, node => node.type === "dialog");
        if (dialog) {
            const ref = refOf(dialog);
            assert.ok(ref);
            ref.current = modal;
        }
        const button = find(tree, node => node.type === "button");
        const buttonRef = button ? refOf(button) : undefined;
        if (buttonRef) buttonRef.current = control("close");
    });
    context.onTestFinished(() => runtime.unmount());
    return { render, modal, focus, changes, opener, fallbackControl, runtime,
        setDropdown: (value: string) => { dropdown = value; }, setOpened: (value: string) => { opened = value; } };
}

test("quick settings uses a named native modal with initial close focus", async context => {
    const s = await fixture(context), tree = s.render();
    assert.ok(tree);
    assert.equal(tree.type, "dialog", "native modal confines Tab/Shift+Tab and makes the background inert");
    assert.equal(tree.props["aria-label"], "config_page.vr.section_label_overlay");
    assert.equal(s.modal.open, true);
    assert.equal(s.modal.opens, 1);
    const close = find(tree, node => node.type === "button");
    assert.ok(close);
    assert.equal(close.props.autoFocus, true);
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
                const close = find(tree, node => node.type === "button");
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

test("dropdown Escape prevents native cancellation but still reaches the dropdown listener", async context => {
    const s = await fixture(context);
    s.setDropdown("overlay-position");
    let tree = s.render(), prevented = false;
    assert.ok(tree);
    const event = { key: "Escape", preventDefault: () => { prevented = true; },
        stopPropagation: () => assert.fail("the dropdown must receive Escape") };
    tree.props.onKeyDownCapture(event);
    assert.equal(prevented, true, "suppress the browser cancel before the dropdown clears its state");
    tree.props.onCancel(event);
    assert.deepEqual(s.changes, []);
    assert.equal(s.modal.open, true);
    s.setDropdown(""); // The existing document listener closes the dropdown.
    tree = s.render();
    assert.ok(tree);
    prevented = false;
    tree.props.onKeyDownCapture(event);
    assert.equal(prevented, false);
    tree.props.onCancel(event);
    assert.deepEqual(s.changes, [["", false]]);
});

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
