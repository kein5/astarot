import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { readFileSync } from "node:fs";
import { hooks, loadModule, find, findIn, nodesIn, componentName, componentOf, kitStandIns } from "../../../../../logics/test/hookHarness.ts";
import type { DrawnComponent } from "../../../../../logics/test/hookHarness.ts";
import { localeAt, readLocale } from "../../../../../logics/test/locales.ts";
import type { TreeNode } from "../../../../../logics/test/hookHarness.ts";
import { voiceActions } from "../../../../../logics/voice/voiceActions.ts";
import * as stopShapes from "../../../../../logics/voice/stopVoice.ts";
import type { StopPress } from "../../../../../logics/voice/stopVoice.ts";
import { styleOf } from "../../../../../logics/test/styleSource.ts";

interface MenuState {
    foreground: boolean;
    sync: boolean;
    small: boolean;
    large: boolean;
    osc: boolean;
    pending: boolean;
    flow: boolean;
    // Either subtitle overlay is being switched.
    overlayPending?: boolean;
    update?: string;
    // The version an update check found.
    version?: string;
}
const all = (tree: unknown, predicate: (node: TreeNode) => boolean) => nodesIn(tree).filter(predicate);

// What StopActions reads besides the voice: the audition, the virtual microphone's check and the
// stop's own press (#937). The press pushes the endpoint it would send.
interface StopWorld { audition: string; check: string; stop: StopPress; sent: string[] }
const stopDependencies = (world: StopWorld) => ({
    "../../../../logics/voice/useVoiceAudition": { useVoiceAudition: () => ({ audition: { phase: world.audition } }) },
    "../../../../logics/voice/useVirtualMic": { useVirtualMic: () => ({ check: { phase: world.check } }) },
    "../../../../logics/voice/useStopVoice": { useStopVoice: () => ({ stop: world.stop, press: () => world.sent.push("/run/stop_voice") }) },
    "../../../../logics/voice/stopVoice.ts": stopShapes,
    "../../../common_components/stable_words/StableWords": { StableWords: "stable-words" },
});
// The words a button draws, by their class: a span's text, or the word its StableWords shows.
const words = (button: TreeNode) => Object.fromEntries(all(button, node => node.type === "span" && node.props.className !== undefined)
    .map(node => [node.props.className, node.props.children?.type === "stable-words" ? node.props.children.props.current : node.props.children]));
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

// Stop and mute, as the kit's stand-ins draw them (hookHarness): the Button and the Toggle.
const kitControls = (tree: unknown) => {
    const stop = find(tree, node => node.type === kitStandIns.Button), mute = find(tree, node => node.type === kitStandIns.Toggle);
    assert.ok(stop && mute);
    return [stop, mute] as const;
};

// The part of the bar named `name`, found in its tree: a function of the bar's own module (not
// exported), which the test draws as React would.
const partNamed = (tree: TreeNode, name: string): DrawnComponent => componentOf(findIn(tree, item => componentName(item) === name));

async function menu(context: TestContext, values: Partial<MenuState> = {}) {
    const runtime = hooks(), calls: unknown[][] = [];
    context.onTestFinished(() => runtime.unmount());
    const state: MenuState = { foreground: false, sync: false, small: false, large: false, osc: true, pending: false, flow: false, ...values };
    const button = await loadModule<typeof import("./right_side_components/_buttons/OpenQuickSettingButton.tsx")>(new URL("./right_side_components/_buttons/OpenQuickSettingButton.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t }) },
    });
    const { RightSideComponents } = await loadModule<typeof import("./right_side_components/RightSideComponents.tsx")>(new URL("./right_side_components/RightSideComponents.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t }) },
        "@store": { useStore_OpenedQuickSetting: () => ({ updateOpenedQuickSetting: (value: unknown) => calls.push(["open", value]) }),
            useStore_IsOpenedConfigPage: () => ({ updateIsOpenedConfigPage: (value: unknown) => calls.push(["settings", value]) }),
            useStore_SelectedConfigTabId: () => ({ updateSelectedConfigTabId: (value: unknown) => calls.push(["tab", value]) }) },
        "@logics_common": {
            useIsOscAvailable: () => ({ currentIsOscAvailable: { data: state.osc }, oscUnavailableLabelKey: "why_unavailable" }),
        },
        "@logics_configs": {
            useAppearance: () => ({ currentUiLanguage: { data: "ja" } }),
            useOthers: () => ({ currentEnableVrcMicMuteSync: { data: state.sync, state: "ok" }, toggleEnableVrcMicMuteSync: () => calls.push(["sync"]) }),
        },
        "@logics_main": { useMainFunction: () => ({ currentForegroundStatus: { data: state.foreground, state: state.pending ? "pending" : "ok" },
            toggleForeground: () => calls.push(["foreground"]) }) },
        "./_buttons/OpenQuickSettingButton": button,
        "../../../../../../logics/configs/useOverlayQuickToggle": { useOverlayQuickToggle: () => ({ on: state.small || state.large,
            pending: state.overlayPending === true, toggle: () => calls.push(["overlay"]) }) },
        "../../../../../../logics/configs/revealSetting.ts": { revealSetting: (target: unknown) => calls.push(["reveal", target]) },
        "../../../../config_page/setting_section/setting_box/_components/page_pointer/PagePointer": {
            pageLinkLabel: (_t: unknown, tab: string, action: string) => `link:${tab}:${action}` },
        "../../../../../../logics/common/useAppUpdate": { useAppUpdate: () => ({ appUpdate: { status: state.update ?? "idle", version: state.version ?? null } }) },
        "../../../../others/vrchat_presence/VrchatPresence": { VrchatPresence: "vrchat-presence" },
        "@ui_configs": { generateLocalizedDocumentUrl: () => ({ vrct_document_ui_guide_url: "https://example.invalid/guide" }) },
        "../../../../../../logics/flow/useIoFlow": { useIoFlow: () => ({ isPanelOpen: state.flow,
            togglePanel: () => { calls.push(["flow"]); state.flow = !state.flow; } }) },
    });
    const right = runtime.render(RightSideComponents);
    const Menu = partNamed(right, "QuickSettingsMenu");
    const FlowButton = partNamed(right, "IoFlowButton");
    // The menu as the kit's stand-ins draw it (hookHarness): the Popover, which holds whether it is
    // open, its trigger round the kit's Button, and its content, drawn open or not (Radix shows it).
    const draw = () => {
        const tree = runtime.render(Menu);
        const popover = find(tree, node => node.type === kitStandIns.Popover);
        const trigger = find(tree, node => node.type === kitStandIns.PopoverTrigger);
        const content = find(tree, node => node.type === kitStandIns.PopoverContent);
        assert.ok(popover && trigger && content);
        const opener = find(trigger, node => node.type === kitStandIns.Button);
        assert.ok(opener);
        const rows = all(content, node => node.type === button.OpenQuickSettingButton).map(node => {
            // The node's type is OpenQuickSettingButton (the predicate above): draw it with its props.
            const drawn = button.OpenQuickSettingButton(node.props);
            const rowButton = find(drawn, child => child.type === kitStandIns.Toggle);
            assert.ok(rowButton);
            return { props: node.props, button: rowButton, note: find(drawn, child => child.type === "p" && child.props.className === "note"),
                // The name, then the state in words (the state's span also holds the warning mark).
                words: all(rowButton, child => child.type === "span" && child.props.className !== "words")
                    .map(child => [child.props.children].flat().find(item => typeof item === "string")) };
        });
        return { tree, popover, trigger, opener, content, panel: popover.props.open ? content : null, rows,
            state: find(opener, node => node.props?.className === "menu_state")?.props.children };
    };
    const UpdateButton = partNamed(right, "SoftwareUpdateAvailableButton");
    return { draw, calls, state, button, flowButton: () => runtime.render(FlowButton), updateButton: () => runtime.render(UpdateButton) };
}

test("the quick settings button says how many of its toggles are on, and opens them in place", async context => {
    const s = await menu(context, { foreground: true, large: true });
    let view = s.draw();
    // The kit's plain Button at the compact size, as the bar's other buttons are; Radix's trigger
    // opens the kit's Popover, which this menu holds open or closed.
    assert.deepEqual([view.opener.props.tone, view.opener.props.size], [undefined, "compact"]);
    assert.equal(view.trigger.props.asChild, true);
    // Its tooltip and its words are its name; the words go out of sight in a narrow bar.
    assert.equal(tipped(find(view.tree, node => node.type === "tooltip") as TreeNode).words, "main_page.quick_settings");
    assert.equal(find(view.opener, node => node.props?.className === "menu_label")?.props.children, "main_page.quick_settings");
    assert.equal(view.trigger.props["aria-expanded"], false);
    assert.equal(view.panel, null);
    assert.equal(view.state, 'main_page.quick_settings_on:{"count":2}');
    assert.match(view.opener.props.className, /has_on/);
    view.popover.props.onOpenChange(true);
    view = s.draw();
    assert.equal(view.trigger.props["aria-expanded"], true);
    assert.ok(view.panel);
    assert.equal(view.trigger.props["aria-controls"], view.panel.props.id);
    // A group of toggles named as its button, not a dialog: the button does not say it opens one.
    assert.equal(view.panel.props.role, "group");
    assert.equal(view.panel.props["aria-label"], "main_page.quick_settings");
    // Only its controls take the focus: Radix's tabindex="-1" on the panel is replaced.
    assert.ok("tabIndex" in view.panel.props && view.panel.props.tabIndex === undefined);
    assert.equal(view.trigger.props["aria-haspopup"], "false", "Radix's aria-haspopup=\"dialog\" is replaced");
    // In the bar, at its button's end, with the tight inset for rows: sized by the column (portal={false}).
    assert.deepEqual([view.panel.props.portal, view.panel.props.inset, view.panel.props.align], [false, "tight", "end"]);
    assert.deepEqual(view.rows.map(row => [row.props.label, row.props.variable]), [
        ["main_page.foreground", true], ["config_page.others.vrc_mic_mute_sync.label", false], ["config_page.vr.section_label_overlay", true]]);
    // #939: the subtitle overlay is a toggle too, switched in place: it reports pressed and opens no dialog.
    // Each row is the kit's Toggle at the compact size, pressed by the reported state.
    assert.deepEqual(view.rows.map(row => [row.button.props.pressed, row.button.props["aria-pressed"], row.button.props.size]),
        [[true, true, "compact"], [false, false, "compact"], [true, true, "compact"]]);
    assert.deepEqual(view.rows.map(row => row.words), [["main_page.foreground", "main_page.state_text_enabled"],
        ["config_page.others.vrc_mic_mute_sync.label", "main_page.state_text_disabled"], ["config_page.vr.section_label_overlay", "main_page.state_text_enabled"]]);
    assert.equal(view.rows[2].button.props["aria-haspopup"], undefined);
    assert.ok(find(view.panel, node => node.type === "vrchat-presence"), "the open menu says whether VRChat can be reached");
});

test("nothing on reads as all off", async context => {
    const s = await menu(context);
    const view = s.draw();
    assert.equal(view.state, "main_page.quick_settings_all_off");
    assert.doesNotMatch(view.opener.props.className, /has_on/);
});

test("a toggle is pressed in the open menu, the subtitle overlay too; its settings are a link to the captions and VR page", async context => {
    const s = await menu(context);
    s.draw().popover.props.onOpenChange(true);
    const view = s.draw();
    view.rows[0].button.props.onClick();
    view.rows[1].button.props.onClick();
    view.rows[2].button.props.onClick();
    assert.deepEqual(s.calls, [["foreground"], ["sync"], ["overlay"]]);
    assert.ok(s.draw().panel, "toggling keeps the menu open");
    // Under the overlay's row: the captions and VR page, opened on the overlays' position and look.
    const link = find(s.draw().panel, node => node.type === "button" && node.props.className === "menu_link");
    assert.ok(link);
    assert.equal(link.props.children, "link:vr:main_page.overlay_settings_action");
    link.props.onClick();
    assert.deepEqual(s.calls.slice(-3), [["tab", "vr"], ["settings", true], ["reveal", { setting_id: "vr_overlay" }]]);
    const closed = s.draw();
    assert.equal(closed.panel, null, "the menu closes as the settings open");
    // The settings cover the bar: the focus is not sent back to the button they hide. Only that
    // once: the next close gives it back as usual.
    assert.equal(closing(closed.content), true);
    assert.equal(closing(closed.content), false);
});

test("while a subtitle overlay is switching, its row waits as the other toggles do", async context => {
    const s = await menu(context, { overlayPending: true });
    s.draw().popover.props.onOpenChange(true);
    assert.equal(s.draw().rows[2].button.props["aria-disabled"], true);
});

test("mute sync that cannot be used is disabled and says why", async context => {
    const s = await menu(context, { osc: false });
    s.draw().popover.props.onOpenChange(true);
    const row = s.draw().rows[1];
    assert.equal(row.button.props.disabled, true);
    assert.ok(row.note);
    assert.equal(row.note.props.children, "why_unavailable");
    row.props.onClickFunction();
    assert.deepEqual(s.calls, []);
    assert.equal(s.draw().rows[0].note, null);
});

test("mute sync that can be used has no note under it", async context => {
    const s = await menu(context, { osc: true });
    s.draw().popover.props.onOpenChange(true);
    const row = s.draw().rows[1];
    assert.deepEqual([row.button.props.disabled, row.note], [false, null]);
});

// One row, drawn by itself: the kit's Toggle with the row's name and state, the state's look by its classes.
test("a row says its state in words, marks a toggle on that cannot be used, and dims its words while it waits", async context => {
    const { button } = await menu(context);
    const press = () => {};
    const row = (props: Partial<Parameters<typeof button.OpenQuickSettingButton>[0]>) => {
        const drawn = button.OpenQuickSettingButton({ label: "name", onClickFunction: press, ...props });
        const toggle = find(drawn, node => node.type === kitStandIns.Toggle);
        assert.ok(toggle);
        const label = find(toggle, node => node.props?.children === "name");
        assert.ok(label);
        const state = find(toggle, node => String(node.props?.className).includes("button_indicator_label"));
        return { toggle, label: String(label.props.className), state: state ? String(state.props.className) : null,
            warning: find(toggle, node => node.props?.className === "warning_svg") !== null };
    };
    const on = row({ variable: true });
    assert.deepEqual([on.toggle.props.className, on.toggle.props["aria-disabled"], on.toggle.props.onClick, on.toggle.props.disabled],
        ["", undefined, press, false]);
    assert.equal(on.label, "button_label");
    assert.equal(on.state, "button_indicator_label is_enabled is_available");
    assert.equal(on.warning, false);
    assert.equal(row({ variable: false }).state, "button_indicator_label is_disabled is_available");
    // On, but it cannot be used: the warning's color and mark beside "On"; off, no mark.
    const blocked = row({ variable: true, is_available: false });
    assert.deepEqual([blocked.toggle.props.disabled, blocked.state, blocked.warning], [true, "button_indicator_label is_enabled", true]);
    assert.equal(row({ variable: false, is_available: false }).warning, false);
    // Waiting: its words are dimmed, it takes no pointer, and it stays focusable.
    for (const waiting of [row({ variable: true, state: "pending" }), row({ variable: true, is_pending: true })]) {
        assert.deepEqual([waiting.toggle.props.className, waiting.toggle.props["aria-disabled"], waiting.toggle.props.onClick],
            ["is_pending", true, undefined]);
        assert.equal(waiting.label, "button_label is_pending");
        assert.equal(waiting.state, "button_indicator_label is_enabled is_available is_pending");
    }
    // No state yet: no words for it, and not a toggle that says it is pressed or not.
    const unknown = row({});
    assert.deepEqual([unknown.state, unknown.toggle.props.pressed, unknown.toggle.props["aria-pressed"]], [null, false, undefined]);
});

test("a pending toggle keeps the keyboard's place: not disabled, and a second press does nothing", async context => {
    const s = await menu(context, { pending: true });
    s.draw().popover.props.onOpenChange(true);
    const row = s.draw().rows[0];
    assert.equal(row.button.props.disabled, false);
    assert.equal(row.button.props["aria-disabled"], true);
    assert.equal(row.button.props.onClick, undefined);
});

// What Radix's focus handling is told, as the content's onOpenAutoFocus and onCloseAutoFocus get
// it: true when the menu prevents Radix's own move of the focus.
const opening = (content: TreeNode) => { let prevented = false; content.props.onOpenAutoFocus({ preventDefault: () => { prevented = true; } }); return prevented; };
const closing = (content: TreeNode) => { let prevented = false; content.props.onCloseAutoFocus({ preventDefault: () => { prevented = true; } }); return prevented; };

test("the menu is the kit's popover, never modal: Escape, a press or focus outside close it; opening leaves the focus on its button", async context => {
    const s = await menu(context);
    let view = s.draw();
    // Radix's non-modal popover closes on Escape (focus goes back to the button), a press outside or
    // focus moving outside (docs: Popover.tsx); each reaches the menu as onOpenChange(false).
    assert.equal(view.popover.props.modal, undefined, "not modal (Radix's default)");
    view.popover.props.onOpenChange(true);
    view = s.draw();
    assert.ok(view.panel);
    assert.equal(opening(view.content), true, "opening leaves the focus on the button");
    view.popover.props.onOpenChange(false);
    view = s.draw();
    assert.equal(view.panel, null);
    assert.equal(closing(view.content), false, "Radix returns the focus to the button after Escape, unless it left the menu");
});

test("the main bar leads with stop and mute, drawn with its own short and shortest words", async () => {
    const runtime = hooks(), sent: string[] = [];
    const voice: { status: object; route: Record<string, boolean>; send: (path: string) => number } =
        { status: { queued: 2, active: true }, route: { requested_muted: true, ready: true, pending: false, managed: true }, send: path => sent.push(path) };
    const world: StopWorld = { audition: "idle", check: "idle", stop: stopShapes.IDLE_STOP, sent };
    const actions = await loadModule<typeof import("../../../others/stop_actions/StopActions.tsx")>(new URL("../../../others/stop_actions/StopActions.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t }) }, "../../../../logics/voice/useVoice": { useVoice: () => voice },
        "../../../../logics/voice/voiceActions.ts": { voiceActions }, ...stopDependencies(world),
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
    assert.equal(second.props.size, "compact", "the bar's buttons are the kit's compact ones");
    const group = runtime.render(second.type, second.props);
    // Stop is the kit's danger Button (D-10) and mute the kit's Toggle in its warning tone (D-27),
    // both at the size the bar asks for.
    const [stop, mute] = kitControls(group);
    assert.deepEqual([stop.props.tone, stop.props.size, mute.props.tone, mute.props.size], ["danger", "compact", "warning", "compact"]);
    assert.deepEqual(words(stop), { long: 'voice_ui.topbar_stop_count:{"count":2}', short: 'voice_ui.topbar_stop_short_count:{"count":2}',
        tiny: 'voice_ui.topbar_stop_tiny_count:{"count":2}' });
    assert.equal(stop.props["aria-label"], 'voice_ui.topbar_stop_count:{"count":2}', "the name stays the full words");
    assert.equal(stop.props["aria-disabled"], undefined, "offered while something is spoken");
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
    // The reported state presses the toggle; the toggle keeps none of its own.
    assert.deepEqual([mute.props.pressed, mute.props["aria-pressed"], mute.props.onPressedChange], [true, true, undefined]);
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
    const blocked = kitControls(runtime.render(second.type, second.props))[1];
    assert.equal(blocked.props.disabled, true);
    const before = sent.length;
    voiceActions.toggleMute(); blocked.props.onClick();
    assert.equal(sent.length, before);
});

// #937: stop is offered only while something it stops runs, and answers its press.
test("stop reads as disabled with nothing to stop, and answers its press with stopping, then stopped", async () => {
    // sent: the presses only (the bar's own reads of the voice status go elsewhere).
    const runtime = hooks(), sent: string[] = [];
    const voice: { status: object; route: object; send: () => void } = { status: {}, route: {}, send: () => {} };
    const world: StopWorld = { audition: "idle", check: "idle", stop: stopShapes.IDLE_STOP, sent };
    const { StopActions } = await loadModule<typeof import("../../../others/stop_actions/StopActions.tsx")>(new URL("../../../others/stop_actions/StopActions.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t }) }, "../../../../logics/voice/useVoice": { useVoice: () => voice },
        "../../../../logics/voice/voiceActions.ts": { voiceActions }, ...stopDependencies(world),
    });
    const classes = { stop_actions: "stop_actions", stop: "stop", long: "long", short: "short", tiny: "tiny", muted_badge: "muted_badge",
        stop_status: "stop_status" };
    const draw = () => {
        const group = runtime.render(StopActions, { classes });
        const [stop] = kitControls(group);
        const status = find(group, node => node.props?.role === "status");
        assert.ok(status);
        return { stop, tip: tipped(all(group, node => node.type === "tooltip")[0]), status: status.props.children };
    };
    // Nothing runs: disabled to the eye (the kit draws an aria-disabled button at half strength) and
    // to a screen reader, still focusable, and its tooltip says when it can be pressed. Neither the
    // button nor the hotkey sends anything. The bar gives it only its place.
    const idle = draw();
    assert.equal(idle.stop.props["aria-disabled"], true);
    assert.equal(idle.stop.props.disabled, undefined, "it keeps its place in the tab order and its tooltip");
    assert.deepEqual([idle.stop.props.tone, idle.stop.props.className], ["danger", "stop"]);
    assert.equal(idle.tip.words, "voice_ui.topbar_stop_idle");
    idle.stop.props.onClick(); voiceActions.stop?.();
    assert.deepEqual(sent, []);
    // An audition or the virtual microphone's test tone is stopped too, so either offers it.
    for (const running of [{ audition: "playing" }, { check: "running" }]) {
        Object.assign(world, { audition: "idle", check: "idle" }, running);
        assert.equal(draw().stop.props["aria-disabled"], undefined, JSON.stringify(running));
    }
    world.audition = "idle"; world.check = "idle";
    voice.status = { active: true, queued: 0 };
    const offered = draw();
    assert.deepEqual([offered.stop.props["aria-disabled"], offered.tip.words], [undefined, "voice.stop"]);
    offered.stop.props.onClick();
    assert.deepEqual(sent, ["/run/stop_voice"]);
    // Waiting for the answer: it says so in the room its words keep and takes no press; the
    // shortest words stay, so the narrowest bar does not grow.
    world.stop = { phase: "stopping", press: 1 };
    const stopping = draw();
    assert.deepEqual(words(stopping.stop), { long: "voice_ui.topbar_stopping", short: "voice_ui.topbar_stopping", tiny: "voice_ui.topbar_stop_tiny" });
    assert.deepEqual([stopping.stop.props["aria-busy"], stopping.stop.props["aria-disabled"]], [true, true]);
    stopping.stop.props.onClick();
    assert.equal(sent.length, 1);
    const kept = find(stopping.stop, node => node.type === "stable-words");
    assert.ok(kept);
    // The room also holds a two-digit queue, so the queue emptying does not move mute either.
    assert.deepEqual(kept.props.words, ["voice_ui.topbar_stop", 'voice_ui.topbar_stop_count:{"count":99}', "voice_ui.topbar_stopping", "voice_ui.topbar_stopped"]);
    // Answered: "stopped", and a line for screen readers.
    world.stop = { phase: "stopped", press: 1 };
    voice.status = { active: false, queued: 0 };
    const stopped = draw();
    assert.equal(words(stopped.stop).long, "voice_ui.topbar_stopped");
    assert.equal(stopped.stop.props["aria-busy"], undefined);
    assert.equal(stopped.status, "voice_ui.topbar_stopped_announce");
    assert.equal(stopped.stop.props["aria-disabled"], true, "nothing more to press until something runs again");
    world.stop = { phase: "idle", press: 1 };
    assert.equal(draw().status, "");
});

test("both bars give stop and mute only their place, and the stop's words are in en and ja", () => {
    // The kit draws them (D-10, D-27): a bar's class on them sets no look of its own, which would
    // win or lose by the order of the stylesheets.
    for (const sheet of ["./TopBar.css.ts", "../../../config_page/topbar/Topbar.css.ts"]) {
        const css = readFileSync(new URL(sheet, import.meta.url), "utf8");
        assert.doesNotMatch(styleOf(css, "stop"),
            /padding|fontSize|fontWeight|color|background|border|minHeight|maxWidth|opacity|outline|cursor|animation|selectors/, sheet);
        assert.doesNotMatch(css, /keyframes|is_attention|is_pressed|is_stopping|is_stopped|is_idle/, sheet);
        assert.match(styleOf(css, "stop_status"), /position: "absolute",\s*width: "1px",\s*height: "1px",/, sheet);
    }
    for (const language of ["en", "ja"]) {
        const strings = readLocale(language);
        for (const key of ["topbar_stopping", "topbar_stopped", "topbar_stop_idle", "topbar_stopped_announce"])
            assert.equal(typeof localeAt(strings, `voice_ui.${key}`), "string", `${language} ${key}`);
    }
});

test("the settings bar draws the same actions without the shortest words", async () => {
    const runtime = hooks();
    const voice = { status: {}, route: {}, send() {} };
    const { StopActions } = await loadModule<typeof import("../../../others/stop_actions/StopActions.tsx")>(new URL("../../../others/stop_actions/StopActions.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t }) }, "../../../../logics/voice/useVoice": { useVoice: () => voice },
        "../../../../logics/voice/voiceActions.ts": { voiceActions }, ...stopDependencies({ audition: "idle", check: "idle", stop: stopShapes.IDLE_STOP, sent: [] }),
    });
    const classes = { stop_actions: "stop_actions", stop: "stop", long: "long", short: "short", muted_badge: "muted_badge" };
    const group = runtime.render(StopActions, { classes });
    assert.deepEqual(all(group, node => node.type === "span" && node.props.className !== undefined).map(node => node.props.className),
        ["long", "short", "long", "short"]);
    // The settings bar asks for no size: the kit's regular one, 4rem high as search and back.
    const [stop, mute] = kitControls(group);
    assert.deepEqual([stop.props.size, mute.props.size], [undefined, undefined]);
    // No reported state, no toggle: the kit's Toggle is drawn off and says nothing of being pressed.
    assert.deepEqual([mute.props.pressed, mute.props["aria-pressed"]], [false, undefined], "no reported state, no toggle");
    assert.ok("aria-pressed" in mute.props, "the toggle's own aria-pressed is replaced, not left to the kit");
});

test("the main bar's stylesheet hides the long words and swaps to the shortest when narrow; strings exist in en and ja", () => {
    const css = readFileSync(new URL("./TopBar.css.ts", import.meta.url), "utf8");
    assert.match(styleOf(css, "long"), /display: "none"/);
    // The stop and mute's words have their own, narrower threshold, so the default window's column
    // (63rem) says "Stop speech", not "Stop" (#1314, M-9).
    assert.match(styleOf(css, "tiny"), /display: "none",\s*"@container": \{ \[TINY_STOP\]: \{ display: "inline" \} \}/);
    assert.match(styleOf(css, "short"), /"@container": \{ \[TINY_STOP\]: \{ display: "none" \} \}/);
    assert.match(styleOf(css, "muted_badge"), /"@container": \{ \[TINY_STOP\]: \{ display: "none" \} \}/);
    assert.match(css, /const TINY_STOP = `\$\{MAIN_SECTION_CONTAINER\} \(max-width: \$\{TINY_STOP_COLUMN\}\)`;/);
    // The conversation column's width decides, not the window's (a wide rail leaves less room).
    const narrowColumn = /const NARROW = `\$\{MAIN_SECTION_CONTAINER\} \(max-width: \$\{NARROW_COLUMN\}\)`;/;
    assert.match(css, narrowColumn);
    const layout = readFileSync(new URL("../../layout.ts", import.meta.url), "utf8");
    assert.match(layout, /MAIN_SECTION_CONTAINER = "main_section";/);
    assert.match(layout, /NARROW_COLUMN = "64rem";/);
    // Narrower than the default window's column: 870px less the 240px rail is 63rem.
    const tinyStop = /TINY_STOP_COLUMN = "(\d+)rem";/.exec(layout);
    assert.ok(tinyStop && Number(tinyStop[1]) < 63, "the default window keeps the stop's words");
    assert.doesNotMatch(css, /max-width: 800px|data-narrow/);
    const menu = readFileSync(new URL("./right_side_components/RightSideComponents.css.ts", import.meta.url), "utf8");
    assert.match(menu, narrowColumn);
    assert.match(styleOf(menu, "menu_text"), /"@container": \{ \[NARROW\]: readOnly \}/);
    for (const language of ["en", "ja"]) {
        const strings = readLocale(language);
        for (const key of ["quick_settings", "quick_settings_on", "quick_settings_all_off"]) assert.equal(typeof localeAt(strings, `main_page.${key}`), "string");
        for (const key of ["topbar_stop_tiny", "topbar_stop_tiny_count"]) assert.equal(typeof localeAt(strings, `voice_ui.${key}`), "string");
    }
});

test("stop and mute keep their width in a narrow bar, and nothing runs past it; the update button keeps only its arrow there", async context => {
    const css = readFileSync(new URL("./TopBar.css.ts", import.meta.url), "utf8");
    // #562: the bar takes a second line rather than run past the column; the buttons on the right
    // go there, at its end, and never over stop and mute.
    const bar = styleOf(css, "container");
    assert.match(bar, /flexWrap: "wrap"/);
    assert.match(bar, /minHeight: vars\.main_page_topbar_height/);
    assert.doesNotMatch(bar, /(^|[^A-Za-z])height: vars/, "a second line makes it taller");
    // A narrower column still: mute goes under stop, and neither button gets narrower than its words.
    assert.match(styleOf(css, "stop_actions"), /flexWrap: "wrap"/);
    assert.match(styleOf(css, "stop"), /flexShrink: 0/);
    const right = readFileSync(new URL("./right_side_components/RightSideComponents.css.ts", import.meta.url), "utf8");
    const group = styleOf(right, "container");
    assert.match(group, /marginInlineStart: "auto"/, "at the bar's end on either line");
    assert.match(group, /flexShrink: 0/);
    assert.match(styleOf(right, "software_update_label"), /"@container": \{ \[NARROW\]: readOnly \}/);
    assert.match(right.slice(right.indexOf("const readOnly")), /^[^;]*clipPath: "inset\(50%\)"/);
    // The icon and its mark stay in a narrow bar: only the words are clipped.
    for (const name of ["update_icon", "update_mark"]) assert.doesNotMatch(styleOf(right, name), /@container/, name);
    const { control: button, words, side } = tipped((await menu(context, { update: "available", version: "0.6.1" })).updateButton());
    // The kit's plain Button at the compact size, which is a button that submits nothing.
    assert.equal(button.type, kitStandIns.Button);
    assert.deepEqual([button.props.tone, button.props.size, button.props.type], [undefined, "compact", undefined]);
    assert.equal(button.props.title, undefined);
    // #766: a version being out is a state. It is a mark on the icon and the short word with the
    // version; the sentence that announces it is the tooltip and the button's description.
    const label = find(button, node => node.props?.className === "software_update_label");
    assert.ok(label);
    assert.equal(label.props.children, 'main_page.update_button:{"version":"0.6.1"}', "the words, which stay the button's name in a narrow bar");
    const mark = find(button, node => node.props?.className === "update_mark");
    assert.ok(mark, "the mark on the icon");
    assert.equal(mark.props["aria-hidden"], "true");
    assert.deepEqual([words, side], ["main_page.update_available", "bottom"]);
    assert.equal(describedBy(button), "main_page.update_available");
    assert.equal(find(button, node => node.props?.className !== undefined && node.props.children === "main_page.update_available"), null, "the sentence is not a line of the bar");
});

test("the update button names the version when the check found one, shows while it downloads and installs, and is absent otherwise", async context => {
    for (const update of ["available", "downloading", "installing"]) {
        const { control } = tipped((await menu(context, { update, version: "0.6.1" })).updateButton());
        assert.ok(find(control, node => node.props?.children === 'main_page.update_button:{"version":"0.6.1"}'), update);
    }
    const plain = tipped((await menu(context, { update: "available" })).updateButton()).control;
    assert.ok(find(plain, node => node.props?.children === "main_page.update_button_plain"), "no version, no number");
    for (const update of ["idle", "up_to_date", "checking", "failed"]) assert.equal((await menu(context, { update })).updateButton(), null, update);
    // Both languages keep the version in the words.
    for (const language of ["en", "ja"]) {
        const strings = readLocale(language);
        const [named, plainWords, sentence] = ["update_button", "update_button_plain", "update_available"].map(key => localeAt(strings, `main_page.${key}`));
        assert.ok(typeof named === "string" && typeof plainWords === "string" && typeof sentence === "string", language);
        assert.match(named, /\{\{version\}\}/, language);
        assert.equal(named.replace(/\s*\{\{version\}\}\s*/, ""), plainWords, `${language}: the same word with and without the version`);
    }
});

test("the words added to the main page are never smaller than 12px (1.2rem at the 10px base)", () => {
    for (const file of ["./TopBar.css.ts", "./right_side_components/RightSideComponents.css.ts",
        "./right_side_components/_buttons/OpenQuickSettingButton.css.ts",
        "../../sidebar_section/language_readout/LanguageReadout.css.ts"]) {
        const sizes = [...readFileSync(new URL(file, import.meta.url), "utf8").matchAll(/fontSize: "([\d.]+)rem"/g)].map(match => Number(match[1]));
        assert.ok(sizes.length > 0, file);
        assert.ok(sizes.every(size => size >= 1.2), `${file}: ${sizes}`);
    }
});

test("the inputs and outputs button opens and closes the panel it controls", async context => {
    const s = await menu(context);
    const drawn = tipped(s.flowButton());
    let button = drawn.control;
    // The kit's plain Button at the compact size, as the update button is.
    assert.equal(button.type, kitStandIns.Button);
    assert.deepEqual([button.props.tone, button.props.size], [undefined, "compact"]);
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
