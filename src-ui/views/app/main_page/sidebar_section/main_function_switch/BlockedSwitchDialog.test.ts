import assert from "node:assert/strict";
import { test } from "vitest";
import { find, hooks, kitStandIns, loadModule, nodesIn } from "../../../../../logics/test/hookHarness.ts";
import { localeAt, readLocale } from "../../../../../logics/test/locales.ts";

// #1314 (M-1): a greyed main switch that is pressed says why it cannot be turned on yet, with the
// step that fixes it, in the shape of the speech recognition switches' dialog (#1225).
async function dialog() {
    const runtime = hooks(), events: unknown[][] = [];
    const { BlockedSwitchDialog } = await loadModule<typeof import("./BlockedSwitchDialog.tsx")>(new URL("./BlockedSwitchDialog.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t: (key: string, values?: Record<string, unknown>) => values ? `${key}:${JSON.stringify(values)}` : key }) },
        "../../../../../logics/common/useConsentDialog": { useConsentDialog: () => ({ dialog: { current: null }, close: () => events.push(["close"]) }) },
    });
    const draw = (fixLabel: string | null) => runtime.render(BlockedSwitchDialog, { name: "Translation", reason: "No model yet.", fixLabel,
        onFix: () => events.push(["fix"]), onClose: () => events.push(["closed"]) });
    const buttons = (tree: unknown) => nodesIn(find(tree as never, node => node.type === kitStandIns.DialogFooter))
        .filter(node => node.type === kitStandIns.Button);
    return { draw, buttons, events };
}

test("the dialog names the switch, says why, and offers Close and the fix", async () => {
    const d = await dialog();
    const tree = d.draw("Check what is downloaded");
    const title = find(tree, node => node.type === kitStandIns.DialogTitle);
    assert.equal(title?.props.children, 'main_page.switch_blocked_dialog.title:{"name":"Translation"}');
    assert.equal(find(tree, node => node.type === "p")?.props.children, "No model yet.");
    const [close, fix] = d.buttons(tree);
    assert.deepEqual([close.props.children, close.props.autoFocus, fix.props.children, fix.props.tone],
        ["main_page.switch_blocked_dialog.close", true, "Check what is downloaded", "primary"]);
    fix.props.onClick();
    assert.deepEqual(d.events, [["close"], ["closed"], ["fix"]], "the dialog closes before the fix opens");
    d.events.length = 0;
    close.props.onClick();
    assert.deepEqual(d.events, [["close"], ["closed"]]);
});

test("with only waiting to do, the dialog offers Close alone", async () => {
    const d = await dialog();
    assert.deepEqual(d.buttons(d.draw(null)).map(button => button.props.children), ["main_page.switch_blocked_dialog.close"]);
});

test("the dialog's words exist in both languages, the title with the switch's name", () => {
    for (const language of ["en", "ja"]) {
        const locale = readLocale(language);
        assert.match(String(localeAt(locale, "main_page.switch_blocked_dialog.title")), /\{\{name\}\}/, language);
        assert.equal(typeof localeAt(locale, "main_page.switch_blocked_dialog.close"), "string", language);
    }
});
