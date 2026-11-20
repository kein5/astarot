import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { readFileSync } from "node:fs";
import { hooks, loadModule, find, eventTarget, stubGlobals, findIn, nodesIn, componentName, componentOf, setRef } from "../../../../../logics/test/hookHarness.ts";
import type { DrawnComponent } from "../../../../../logics/test/hookHarness.ts";
import { localeAt, readLocale } from "../../../../../logics/test/locales.ts";
import type { TreeNode } from "../../../../../logics/test/hookHarness.ts";
import { voiceActions } from "../../../../../logics/voice/voiceActions.ts";

interface MenuState {
    foreground: boolean;
    sync: boolean;
    small: boolean;
    large: boolean;
    osc: boolean;
    pending: boolean;
    flow: boolean;
    update?: string;
}
const all = (tree: unknown, predicate: (node: TreeNode) => boolean) => nodesIn(tree).filter(predicate);
const t = (key: string, options?: object) => options ? `${key}:${JSON.stringify(options)}` : key;
// A control inside its tooltip, an element named "tooltip" that keeps the bubble's words in
// `title` and its side in `placement` (hookHarness): the control, the words and the side.
const tipped = (tree: TreeNode) => {
    assert.equal(tree.type, "tooltip");
    const control = find(tree.props.children, () => true);
    assert.ok(control);
    return { control, words: tree.props.title, side: tree.props.placement };
};
// The words a control points at with aria-describedby: kept in the page, out of sight.
const describedBy = (control: TreeNode) => {
    const words = find(control, node => node.props?.id !== undefined && node.props.id === control.props["aria-describedby"]);
    assert.ok(words, "the control points at its description");
    assert.equal(words.props.hidden, true);
    return words.props.children;
};

// The part of the bar named `name`, found in its tree: a function of the bar's own module (not
// exported), which the test draws as React would.
const partNamed = (tree: TreeNode, name: string): DrawnComponent => componentOf(findIn(tree, item => componentName(item) === name));

async function menu(context: TestContext, values: Partial<MenuState> = {}) {
    const runtime = hooks(), calls: unknown[][] = [], document = eventTarget();
    // Unmount first: the menu's cleanup still needs the document this test provides.
    context.onTestFinished(() => runtime.unmount());
    stubGlobals(context, { document });
    const state: MenuState = { foreground: false, sync: false, small: false, large: false, osc: true, pending: false, flow: false, ...values };
    const button = await loadModule<typeof import("./right_side_components/_buttons/OpenQuickSettingButton.tsx")>(new URL("./right_side_components/_buttons/OpenQuickSettingButton.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t }) },
    });
    const { RightSideComponents } = await loadModule<typeof import("./right_side_components/RightSideComponents.tsx")>(new URL("./right_side_components/RightSideComponents.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t }) },
        "@store": { useStore_OpenedQuickSetting: () => ({ updateOpenedQuickSetting: (value: unknown) => calls.push(["open", value]) }) },
        "@logics_common": {
            useIsOscAvailable: () => ({ currentIsOscAvailable: { data: state.osc }, oscUnavailableLabelKey: "why_unavailable" }),
        },
        "@logics_configs": {
            useAppearance: () => ({ currentUiLanguage: { data: "ja" } }),
            useVr: () => ({ currentIsEnabledOverlaySmallLog: { data: state.small }, currentIsEnabledOverlayLargeLog: { data: state.large } }),
            useOthers: () => ({ currentEnableVrcMicMuteSync: { data: state.sync, state: "ok" }, toggleEnableVrcMicMuteSync: () => calls.push(["sync"]) }),
        },
        "@logics_main": { useMainFunction: () => ({ currentForegroundStatus: { data: state.foreground, state: state.pending ? "pending" : "ok" },
            toggleForeground: () => calls.push(["foreground"]) }) },
        "./_buttons/OpenQuickSettingButton": button,
        "../../../../../../logics/common/useAppUpdate": { useAppUpdate: () => ({ appUpdate: { status: state.update ?? "idle" } }) },
        "../../../../others/vrchat_presence/VrchatPresence": { VrchatPresence: "vrchat-presence" },
        "@ui_configs": { generateLocalizedDocumentUrl: () => ({ vrct_document_ui_guide_url: "https://example.invalid/guide" }) },
        "../../../../../../logics/flow/useIoFlow": { useIoFlow: () => ({ isPanelOpen: state.flow,
            togglePanel: () => { calls.push(["flow"]); state.flow = !state.flow; } }) },
    });
    const right = runtime.render(RightSideComponents);
    const Menu = partNamed(right, "QuickSettingsMenu");
    const FlowButton = partNamed(right, "IoFlowButton");
    const focused: string[] = [];
    const draw = () => {
        const tree = runtime.render(Menu, {}, node => {
            setRef(node, { contains: (target: unknown) => target === "inside" });
            const opener = find(node, child => child.type === "button");
            assert.ok(opener);
            setRef(opener, { focus: () => focused.push("opener") });
        });
        const rows = all(tree, node => node.type === button.OpenQuickSettingButton).map(node => {
            // The node's type is OpenQuickSettingButton (the predicate above): draw it with its props.
            const drawn = button.OpenQuickSettingButton(node.props);
            const rowButton = find(drawn, child => child.type === "button");
            assert.ok(rowButton);
            return { props: node.props, button: rowButton, note: find(drawn, child => child.type === "p" && child.props.className === "note") };
        });
        const opener = find(tree, node => node.type === "button");
        assert.ok(opener);
        return { tree, opener, panel: find(tree, node => node.props?.role === "group"), rows,
            state: find(tree, node => node.props?.className === "menu_state")?.props.children };
    };
    const UpdateButton = partNamed(right, "SoftwareUpdateAvailableButton");
    return { draw, calls, document, focused, state, flowButton: () => runtime.render(FlowButton), updateButton: () => runtime.render(UpdateButton) };
}

test("the quick settings button says how many of its toggles are on, and opens them in place", async context => {
    const s = await menu(context, { foreground: true, large: true });
    let view = s.draw();
    assert.equal(view.opener.props["aria-expanded"], false);
    assert.equal(view.panel, null);
    assert.equal(view.state, 'main_page.quick_settings_on:{"count":2}');
    assert.match(view.opener.props.className, /has_on/);
    view.opener.props.onClick();
    view = s.draw();
    assert.equal(view.opener.props["aria-expanded"], true);
    assert.ok(view.panel);
    assert.equal(view.opener.props["aria-controls"], view.panel.props.id);
    assert.deepEqual(view.rows.map(row => [row.props.label, row.props.variable]), [
        ["main_page.foreground", true], ["config_page.others.vrc_mic_mute_sync.label", false], ["config_page.vr.section_label_overlay", true]]);
    assert.deepEqual(view.rows.map(row => row.button.props["aria-pressed"]), [true, false, undefined]);
    assert.equal(view.rows[2].button.props["aria-haspopup"], "dialog");
    assert.ok(find(view.panel, node => node.type === "vrchat-presence"), "the open menu says whether VRChat can be reached");
});

test("nothing on reads as all off", async context => {
    const s = await menu(context);
    const view = s.draw();
    assert.equal(view.state, "main_page.quick_settings_all_off");
    assert.doesNotMatch(view.opener.props.className, /has_on/);
});

test("a toggle is pressed in the open menu; the overlay row closes it and opens its dialog", async context => {
    const s = await menu(context);
    s.draw().opener.props.onClick();
    const view = s.draw();
    view.rows[0].button.props.onClick();
    view.rows[1].button.props.onClick();
    assert.deepEqual(s.calls, [["foreground"], ["sync"]]);
    assert.ok(s.draw().panel, "toggling keeps the menu open");
    s.draw().rows[2].button.props.onClick();
    assert.deepEqual(s.calls.at(-1), ["open", "overlay"]);
    assert.equal(s.draw().panel, null);
});

test("mute sync that cannot be used is disabled and says why", async context => {
    const s = await menu(context, { osc: false });
    s.draw().opener.props.onClick();
    const row = s.draw().rows[1];
    assert.equal(row.button.props.disabled, true);
    assert.ok(row.note);
    assert.equal(row.note.props.children, "why_unavailable");
    row.props.onClickFunction();
    assert.deepEqual(s.calls, []);
    assert.equal(s.draw().rows[0].note, null);
});

test("a pending toggle keeps the keyboard's place: not disabled, and a second press does nothing", async context => {
    const s = await menu(context, { pending: true });
    s.draw().opener.props.onClick();
    const row = s.draw().rows[0];
    assert.equal(row.button.props.disabled, false);
    assert.equal(row.button.props["aria-disabled"], true);
    assert.equal(row.button.props.onClick, undefined);
});

test("Escape closes the menu and returns focus; a press or focus outside closes it; inside does not", async context => {
    const s = await menu(context);
    s.draw().opener.props.onClick();
    assert.ok(s.draw().panel);
    s.document.dispatch("keydown", { key: "a" });
    s.document.dispatch("pointerdown", { target: "inside" });
    s.document.dispatch("focusin", { target: "inside" });
    assert.ok(s.draw().panel);
    s.document.dispatch("keydown", { key: "Escape" });
    assert.equal(s.draw().panel, null);
    assert.deepEqual(s.focused, ["opener"]);
    for (const type of ["pointerdown", "focusin"]) {
        s.draw().opener.props.onClick();
        assert.ok(s.draw().panel);
        s.document.dispatch(type, { target: "outside" });
        assert.equal(s.draw().panel, null);
    }
    assert.deepEqual(s.focused, ["opener"], "leaving does not pull focus back");
    assert.equal(s.document.added.length, s.document.removed.length, "listeners are removed with the menu");
});

test("the main bar leads with stop and mute, drawn with its own short and shortest words", async () => {
    const runtime = hooks(), sent: string[] = [];
    const voice: { status: object; route: Record<string, boolean>; send: (path: string) => number } =
        { status: { queued: 2, active: true }, route: { requested_muted: true, ready: true, pending: false, managed: true }, send: path => sent.push(path) };
    const actions = await loadModule<typeof import("../../../others/stop_actions/StopActions.tsx")>(new URL("../../../others/stop_actions/StopActions.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t }) }, "../../../../logics/voice/useVoice": { useVoice: () => voice },
        "../../../../logics/voice/voiceActions.ts": { voiceActions },
    });
    const { TopBar } = await loadModule<typeof import("./TopBar.tsx")>(new URL("./TopBar.tsx", import.meta.url), runtime, {
        "./sidebar_compact_mode_button/SidebarCompactModeButton": { SidebarCompactModeButton: "compact" },
        "./right_side_components/RightSideComponents": { RightSideComponents: "right" },
        "../../../others/stop_actions/StopActions": actions,
    });
    const bar = runtime.render(TopBar);
    const leading = find(bar, node => node.props?.className === "leading");
    assert.ok(leading);
    const [first, second] = leading.props.children;
    assert.equal(first.type, "compact");
    assert.equal(second.type, actions.StopActions);
    const group = runtime.render(second.type, second.props);
    const [stop, mute] = all(group, node => node.type === "button");
    // The words a button draws, by their class (its description is a span without one).
    const words = (button: TreeNode) => Object.fromEntries(all(button, node => node.type === "span" && node.props.className !== undefined).map(node => [node.props.className, node.props.children]));
    assert.deepEqual(words(stop), { long: 'voice_ui.topbar_stop_count:{"count":2}', short: 'voice_ui.topbar_stop_short_count:{"count":2}',
        tiny: 'voice_ui.topbar_stop_tiny_count:{"count":2}' });
    assert.equal(stop.props["aria-label"], 'voice_ui.topbar_stop_count:{"count":2}', "the name stays the full words");
    assert.match(stop.props.className, /is_attention/);
    // One name at every width and on every route (#436); the tooltip says what it silences.
    assert.deepEqual(words(mute), { long: "voice_ui.mute_row", short: "voice_ui.mute_row", tiny: "voice_ui.topbar_muted",
        muted_badge: "voice_ui.topbar_muted" });
    assert.equal(mute.props["aria-label"], "voice_ui.mute_row");
    // Both tooltips open under the bar, on the pointer and on keyboard focus (Tooltip); their
    // words stay in the page as the buttons' descriptions. No title attribute is left.
    const [stopTip, muteTip] = all(group, node => node.type === "tooltip").map(tipped);
    assert.deepEqual([stopTip.control.props["aria-label"], stopTip.words, stopTip.side], [stop.props["aria-label"], "voice.stop", "bottom"]);
    assert.deepEqual([muteTip.control.props["aria-label"], muteTip.words, muteTip.side], [mute.props["aria-label"], "voice.mute_scope_managed", "bottom"]);
    assert.equal(describedBy(stop), "voice.stop");
    assert.equal(describedBy(mute), "voice.mute_scope_managed");
    assert.deepEqual([stop.props.title, mute.props.title], [undefined, undefined]);
    assert.equal(mute.props["aria-pressed"], true);
    stop.props.onClick(); mute.props.onClick();
    assert.deepEqual(sent.slice(-2), ["/run/stop_voice", "/run/resume_voice"]);

    // A hotkey presses these same buttons with the state of the moment.
    assert.ok(voiceActions.stop);
    assert.ok(voiceActions.toggleMute);
    voiceActions.stop(); voiceActions.toggleMute();
    assert.deepEqual(sent.slice(-2), ["/run/stop_voice", "/run/resume_voice"]);
    voice.route = { requested_muted: false, ready: true, pending: false };
    runtime.render(second.type, second.props);
    voiceActions.toggleMute();
    assert.equal(sent.at(-1), "/run/mute_voice");
    // Resume is refused while the route is not ready, for the button and the hotkey alike.
    voice.route = { requested_muted: true, ready: false, pending: false };
    const blocked = all(runtime.render(second.type, second.props), node => node.type === "button")[1];
    assert.equal(blocked.props.disabled, true);
    const before = sent.length;
    voiceActions.toggleMute(); blocked.props.onClick();
    assert.equal(sent.length, before);
});

test("the settings bar draws the same actions without the shortest words", async () => {
    const runtime = hooks();
    const voice = { status: {}, route: {}, send() {} };
    const { StopActions } = await loadModule<typeof import("../../../others/stop_actions/StopActions.tsx")>(new URL("../../../others/stop_actions/StopActions.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t }) }, "../../../../logics/voice/useVoice": { useVoice: () => voice },
        "../../../../logics/voice/voiceActions.ts": { voiceActions },
    });
    const classes = { stop_actions: "stop_actions", stop: "stop", long: "long", short: "short", is_attention: "is_attention",
        is_pressed: "is_pressed", muted_badge: "muted_badge" };
    const group = runtime.render(StopActions, { classes });
    assert.deepEqual(all(group, node => node.type === "span" && node.props.className !== undefined).map(node => node.props.className), ["long", "short", "long", "short"]);
    const [, mute] = all(group, node => node.type === "button");
    assert.equal(mute.props["aria-pressed"], undefined, "no reported state, no toggle");
});

test("the main bar's stylesheet hides the long words and swaps to the shortest when narrow; strings exist in en and ja", () => {
    const css = readFileSync(new URL("./TopBar.module.scss", import.meta.url), "utf8");
    assert.match(css, /\.long, \.tiny \{ display: none; \}/);
    const narrow = css.split("@mixin narrow_bar")[1].split("@container")[0];
    assert.match(narrow, /\.short \{ display: none; \}/);
    assert.match(narrow, /\.tiny \{ display: inline; \}/);
    // The conversation column's width decides, not the window's (a wide rail leaves less room).
    assert.match(css, /@container main_section \(max-width: 64rem\) \{ @include narrow_bar; \}/);
    assert.doesNotMatch(css, /@media \(max-width: 800px\)|data-narrow/);
    const menu = readFileSync(new URL("./right_side_components/RightSideComponents.module.scss", import.meta.url), "utf8");
    assert.match(menu, /@container main_section \(max-width: 64rem\) \{ @include narrow_menu; \}/);
    for (const language of ["en", "ja"]) {
        const strings = readLocale(language);
        for (const key of ["quick_settings", "quick_settings_on", "quick_settings_all_off"]) assert.equal(typeof localeAt(strings, `main_page.${key}`), "string");
        for (const key of ["topbar_stop_tiny", "topbar_stop_tiny_count"]) assert.equal(typeof localeAt(strings, `voice_ui.${key}`), "string");
    }
});

test("stop and mute keep their width in a narrow bar; the update button keeps only its arrow there", async context => {
    const css = readFileSync(new URL("./TopBar.module.scss", import.meta.url), "utf8");
    const leadingRule = css.match(/\.leading \{([^}]*)\}/);
    assert.ok(leadingRule);
    const leading = leadingRule[1];
    assert.match(leading, /flex-shrink: 0/, "the right-hand buttons can no longer slide over stop and mute");
    assert.doesNotMatch(leading, /min-width: 0/);
    const right = readFileSync(new URL("./right_side_components/RightSideComponents.module.scss", import.meta.url), "utf8");
    const narrow = right.split("@mixin narrow_menu")[1].split("@container")[0];
    assert.match(narrow, /\.software_update_label \{[^}]*clip-path: inset\(50%\)/);
    const { control: button, words, side } = tipped((await menu(context, { update: "available" })).updateButton());
    assert.equal(button.type, "button");
    assert.equal(button.props.type, "button");
    assert.deepEqual([words, side], ["main_page.update_available", "bottom"], "the tooltip keeps the words");
    assert.equal(button.props.title, undefined);
    assert.ok(find(button, node => node.type === "span" && node.props.children === "main_page.update_available"), "and so does the name");
});

test("the words added to the main page are never smaller than 12px (1.2rem at the 10px base)", () => {
    for (const file of ["./TopBar.module.scss", "./right_side_components/RightSideComponents.module.scss",
        "./right_side_components/_buttons/OpenQuickSettingButton.module.scss",
        "../../sidebar_section/language_readout/LanguageReadout.module.scss"]) {
        const sizes = [...readFileSync(new URL(file, import.meta.url), "utf8").matchAll(/font-size: ([\d.]+)rem/g)].map(match => Number(match[1]));
        assert.ok(sizes.length > 0, file);
        assert.ok(sizes.every(size => size >= 1.2), `${file}: ${sizes}`);
    }
});

test("the inputs and outputs button opens and closes the panel it controls", async context => {
    const s = await menu(context);
    const drawn = tipped(s.flowButton());
    let button = drawn.control;
    assert.equal(button.type, "button");
    assert.equal(button.props["aria-expanded"], false);
    assert.equal(button.props["aria-controls"], "io_flow_panel");
    // What the panel shows is the button's tooltip and, kept in the page, its description.
    assert.deepEqual([drawn.words, drawn.side], ["io_flow.open_hint", "bottom"]);
    assert.equal(describedBy(button), "io_flow.open_hint");
    assert.equal(button.props.title, undefined);
    assert.ok(find(button, node => node.props?.children === "io_flow.open"), "the button names itself");
    button.props.onClick();
    button = tipped(s.flowButton()).control;
    assert.equal(button.props["aria-expanded"], true);
    assert.match(button.props.className, /has_on/);
    assert.deepEqual(s.calls, [["flow"]]);
});
