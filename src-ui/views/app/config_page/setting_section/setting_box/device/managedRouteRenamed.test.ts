import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import { readLocale, localeAt, textAt } from "../../../../../../logics/test/locales.ts";
import { hooks, loadModule, nodesIn, kitStandIns } from "../../../../../../logics/test/hookHarness.ts";

// ADR-014, 2.8: the Linux virtual microphone took its ASTAROT name. The core made the user's
// managed route again under it, so VRChat has to be pointed at the new microphone once. The
// route controls say so until the notice is closed, and every sentence names the new microphone.
const source = readFileSync(new URL("./VoiceRouteSettings.tsx", import.meta.url), "utf8");
const routes = readFileSync(new URL("../../../../../../logics/useReceiveRoutes.ts", import.meta.url), "utf8");

test("the route controls show the new name of the microphone until the notice is closed", () => {
    assert.match(source, /const renamed = !!route\.managed && route\.notice === "managed_route_renamed";/);
    assert.match(source, /\{renamed && <div role="status">\s*<p>\{t\("voice_ui\.managed_route_renamed"\)\}<\/p>/);
    assert.match(source, /onClick=\{\(\) => send\("\/set\/disable\/managed_route_rename_notice"\)\}>\{t\("common\.close_button_label"\)\}/);
    // The core answers with the route, which no longer has the notice.
    assert.match(routes, /\{ endpoint: "\/set\/disable\/managed_route_rename_notice", ns: voice, hook_name: "useVoice", method_name: "updateRoute" \}/);
});

test("the strings name the new microphone, and the old one only where it is gone, in both languages", () => {
    for (const language of ["en", "ja"]) {
        const text = readLocale(language);
        for (const key of ["voice.managed_lead", "voice.input_selection_hint"]) {
            assert.match(textAt(text, key), /ASTAROT Managed Virtual Microphone/, `${language} ${key}`);
            assert.doesNotMatch(textAt(text, key), /VRCT/, `${language} ${key}`);
        }
        const renamed = textAt(text, "voice_ui.managed_route_renamed");
        assert.match(renamed, /ASTAROT Managed Virtual Microphone/, language);
        assert.match(renamed, /VRCT Managed Virtual Microphone/, language);
        assert.equal(typeof localeAt(text, "common.close_button_label"), "string", language);
        const legacy = textAt(text, "voice_setup_errors.managed_setup_manual_config_legacy");
        assert.match(legacy, /90-vrct-managed\.conf/, language);
        assert.match(legacy, /90-astarot-managed\.conf/, language);
    }
});

// Close, mute and unmute are the kit's plain Buttons, inside a form whose own rules leave them
// alone (formSelectors.ts). Unmute waits until the route is ready and muted.
test("the route's close, mute and unmute are the kit's plain buttons and send the route's commands", async () => {
    const draw = async (route: Record<string, unknown>) => {
        const runtime = hooks(), sent: string[] = [];
        const { VoiceRouteControls } = await loadModule<typeof import("./VoiceRouteSettings.tsx")>(new URL("./VoiceRouteSettings.tsx", import.meta.url), runtime, {
            "@useI18n": { useI18n: () => ({ t: (key: string, values?: object) => values ? `${key}:${JSON.stringify(values)}` : key, i18n: { language: "en" } }) },
            "../../../../../../logics/voice/useVoice": { useVoice: () => ({ route, error: null, send: (endpoint: string) => sent.push(endpoint) }) },
            "../../../../../../logics/voice/routeState": { usesOutputDevice: () => false },
            "../../../../../../logics/voice/useSettingsDraft": { useSettingsDraft: () => null },
            "../_components/section_label_component/SectionLabelComponent": { SectionLabelComponent: "heading" },
            "../_components/env_readout/EnvReadout": { EnvReadout: "readout" },
            "../_components/lead/Lead": { Lead: "lead" },
            "../_components/form_row/FormRow": { FormRow: "row" },
            "../_components/page_pointer/PagePointer": { PageLinkButton: "link" },
            "../../../../../../logics/voice/voiceErrorText.ts": { voiceErrorText: () => "" },
        });
        const tree = runtime.render(VoiceRouteControls);
        const buttons = nodesIn(tree).filter(node => node.type === kitStandIns.Button);
        const row = nodesIn(tree).find(node => node.type === "row");
        const notice = nodesIn(tree).find(node => node.type === "p" && node.props.children === "voice_ui.managed_route_renamed");
        return { buttons, sent, row, notice };
    };
    const muted = await draw({ managed: true, notice: "managed_route_renamed", ready: true, pending: false, requested_muted: true });
    assert.deepEqual(muted.buttons.map(button => [button.props.tone, button.props.children, button.props.disabled]),
        [[undefined, "common.close_button_label", undefined], [undefined, "voice.mute", undefined], [undefined, "voice.resume", false]]);
    // The notice says why it is there, and the mute row says what it silences on this route.
    assert.ok(muted.notice);
    assert.deepEqual([muted.row?.props.label, muted.row?.props.description],
        ["voice_ui.mute_row", 'voice_ui.mute_row_description:{"scope":"voice.mute_scope_managed"}']);
    for (const button of muted.buttons) button.props.onClick();
    assert.deepEqual(muted.sent, ["/set/disable/managed_route_rename_notice", "/run/mute_voice", "/run/resume_voice"]);
    const unmuted = await draw({ ready: true, pending: false, requested_muted: false });
    assert.equal(unmuted.notice, undefined);
    assert.equal(unmuted.row?.props.description, 'voice_ui.mute_row_description:{"scope":"voice.mute_scope_external"}');
    assert.equal((await draw({ covers_direct: true })).row?.props.description, 'voice_ui.mute_row_description:{"scope":"voice.mute_scope_device"}');
    assert.deepEqual(unmuted.buttons.map(button => [button.props.children, button.props.disabled]), [["voice.mute", undefined], ["voice.resume", true]]);
    for (const route of [{ ready: false, requested_muted: true }, { ready: true, pending: true, requested_muted: true }]) {
        assert.equal((await draw(route)).buttons[1].props.disabled, true);
    }
});

// The route is the kit's Select (D-14, decided on 2026-11-25), named by its label as before: the
// managed route is offered only while the voice does not go to an output device, and the choice
// waits while the route is changing.
test("the route is chosen with the kit's Select, which offers the managed route only without an output device", async () => {
    const draw = async (outputDevice: boolean, directState: Record<string, unknown>) => {
        const runtime = hooks(), drafts: unknown[] = [];
        const form = { draft: { routing: "external" }, saving: false, groupProps: {}, commit: () => { drafts.push("commit"); }, setDraft: (next: unknown) => { drafts.push(next); } };
        const { VoiceRouteSettings } = await loadModule<typeof import("./VoiceRouteSettings.tsx")>(new URL("./VoiceRouteSettings.tsx", import.meta.url), runtime, {
            "@useI18n": { useI18n: () => ({ t: (key: string) => key, i18n: { language: "en" } }) },
            "../../../../../../logics/voice/useVoice": { useVoice: () => ({ settings: form.draft, directState, directPending: false, error: null,
                updateError: () => {}, send: () => {} }) },
            "../../../../../../logics/voice/routeState": { usesOutputDevice: () => outputDevice },
            "../../../../../../logics/voice/useSettingsDraft": { useSettingsDraft: () => form },
            "../_components/section_label_component/SectionLabelComponent": { SectionLabelComponent: "heading" },
            "../_components/env_readout/EnvReadout": { EnvReadout: "readout" },
            "../_components/lead/Lead": { Lead: "lead" },
            "../_components/form_row/FormRow": { FormRow: "row" },
            "../_components/page_pointer/PagePointer": { PageLinkButton: "link" },
            "../../../../../../logics/voice/voiceErrorText.ts": { voiceErrorText: () => "" },
        });
        const tree = runtime.render(VoiceRouteSettings, {});
        const select = nodesIn(tree).find(node => node.type === kitStandIns.Select);
        assert.ok(select);
        const options = nodesIn(select).filter(node => node.type === kitStandIns.SelectOption).map(node => node.props.value);
        const words = nodesIn(select).filter(node => node.type === kitStandIns.SelectOption).map(node => node.props.children);
        const native = nodesIn(tree).filter(node => node.type === "select" || node.type === "option");
        const label = nodesIn(tree).find(node => node.type === "label");
        const element = nodesIn(tree).find(node => node.type === "form");
        return { select, options, words, native, label, form: element, drafts, unmount: () => runtime.unmount() };
    };
    const ready = await draw(false, { observation_id: "o-1" });
    assert.deepEqual([ready.select.props["aria-label"], ready.select.props.value, ready.select.props.disabled], ["voice.routing", "external", false]);
    assert.deepEqual([ready.options, ready.words, ready.native], [["external", "managed"], ["voice.routing_external", "voice.routing_managed"], []]);
    assert.equal([ready.label?.props.children].flat()[0], "voice.routing");
    // Enter in the form saves it, as the form's own submit, without leaving the page.
    let prevented = false;
    ready.form?.props.onSubmit({ preventDefault: () => { prevented = true; } });
    assert.deepEqual([prevented, ready.drafts], [true, ["commit"]]);
    ready.drafts.length = 0;
    ready.select.props.onChange({ target: { value: "managed" } });
    assert.deepEqual(ready.drafts, [{ routing: "managed" }]);
    ready.unmount();
    const device = await draw(true, { observation_id: "o-1" });
    assert.deepEqual(device.options, ["external"]);
    device.unmount();
    const changing = await draw(false, { observation_id: "o-1", pending: true });
    assert.equal(changing.select.props.disabled, true);
    changing.unmount();
});
