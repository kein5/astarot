import * as routeState from "./routeState.ts";
import * as voiceErrorTextModule from "./voiceErrorText.ts";
import assert from "node:assert/strict";
import { test, vi } from "vitest";
import type { TestContext } from "vitest";
import type { ReactElement } from "react";
import { hooks, loadModule, stubGlobals, eventTarget, find, componentNamed, isRecord } from "../test/hookHarness.ts";
import type { HookRuntime } from "../test/hookHarness.ts";
import { flush } from "../test/bridgeHarness.ts";
import { rebaseDraft } from "./draftRebase.ts";
import { changedPaths } from "./saveBar.ts";
import type { SaveBarEntry } from "./saveBar.ts";
import { createSettingsWriteResponses } from "../common/settingsWriteResponses.ts";

interface Request {
    endpoint: string;
    data: unknown;
}
// A form's save bar entry; a form that has none fails here, as using it would.
const saved = (entry: SaveBarEntry | null | undefined) => {
    assert.ok(entry);
    return entry;
};

async function setup(context: TestContext) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const runtimes: HookRuntime[] = [];
    context.onTestFinished(() => runtimes.forEach(runtime => { runtime.unmount(); }));
    stubGlobals(context, { window: eventTarget() });
    const owners = createSettingsWriteResponses(), requests: Request[] = [], entries: (SaveBarEntry | null)[] = [], forms: (() => ReactElement)[] = [];
    // What useVoice answers, as far as the two forms read it.
    const state: { settings: Record<string, unknown>; error: unknown; [key: string]: unknown } = {
        settings: { routing: "external", output_device: "output-a", monitor_volume: "35" }, error: null,
        directState: { observation_id: 1 }, devices: { devices: [] }, updateError: (error: unknown) => { state.error = error; },
        send: (endpoint: string, data?: unknown) => {
            if (!endpoint.startsWith("/set/")) return true;
            const owner = owners.begin(endpoint);
            requests.push({ endpoint, data });
            // A write while none is owned stops here, as reading its response did.
            assert.ok(owner);
            return owner.response;
        },
    };
    const views: [number, string, string][] = [[0, "device/VoiceRouteSettings.tsx", "VoiceRouteSettings"],
        [1, "advanced_settings/VoiceSettings.tsx", "TtsOutputDeviceSettings"]];
    for (const [index, file, name] of views) {
        const runtime = hooks();
        runtimes.push(runtime);
        const draft = await loadModule(new URL("./useSettingsDraft.tsx", import.meta.url), runtime, {
            "./draftRebase": { rebaseDraft }, "./saveBar": { changedPaths, setSaveBarEntry: (_: string, value: SaveBarEntry | null) => { entries[index] = value; } },
        });
        const components = await loadModule(new URL(`../../views/app/config_page/setting_section/setting_box/${file}`, import.meta.url), runtime, {
            "@store": {}, "../../../../../../logics/voice/useVoice": { useVoice: () => state },
            "../../../../../../logics/voice/routeState": routeState,
            "../../../../../../logics/voice/useSettingsDraft": draft,
            "../tts/GenerationOptions": { validGenerationOptions: () => true }, "../tts/TtsEngine": { TTS_ENGINES: {}, AUDIO_QUERY_ENGINES: [], validCoeiroinkOptions: () => true, validAudioQueryOptions: () => true }, "../device/VoiceRouteSettings": {}, "../tts/VirtualMicEntry": { VirtualMicEntry: () => null }, "../../../../../../logics/voice/voiceErrorText.ts": voiceErrorTextModule, "../../../../../../logics/configs/revealSetting.ts": { revealSetting: () => {} },
            "./StatusLine": {}, "../_components/description/Description": {},
            "../_components/section_label_component/SectionLabelComponent": { SectionLabelComponent: "heading" },
            "../_components/env_readout/EnvReadout": {}, "../_components/form_row/FormRow": { FormRow: "row" },
            "../_components/hint/Hint": { Hint: "hint", useHintDescriptions: () => false },
            "../_components/advanced_section/AdvancedSection": { AdvancedSection: "advanced" },
            "../_components/page_pointer/PagePointer": { PageLinkButton: "page-link" },
        });
        // The form the view exports under that name; both take a title.
        const form = componentNamed(components, name);
        forms.push(() => runtime.render(form, { title: "Output" }));
    }
    context.onTestFinished(() => owners.stop());
    const render = () => { forms.forEach(form => { form(); }); return forms.map(form => form()); };
    const edit = (index: number, value: string) => {
        const select = find(render()[index], node => node.type === "select");
        assert.ok(select);
        select.props.onChange({ target: { value } }); render();
    };
    const reply = async (index: number, status: number) => {
        const request = requests[index];
        if (status === 200) state.settings = { ...state.settings, ...(isRecord(request.data) ? request.data : {}) };
        render();
        owners.receive({ endpoint: request.endpoint, status, result: status === 200 ? state.settings : { error_code: "rejected" } });
        await flush(); render();
    };
    render();
    return { entries, requests, state, edit, render, reply };
}

for (const reverse of [false, true]) test(`VRChat forms save only their edits and own their responses (reverse=${reverse})`, async context => {
    const s = await setup(context);
    s.edit(0, "managed"); s.edit(1, "output-b");
    const order = reverse ? [1, 0] : [0, 1];
    for (const index of order) saved(s.entries[index]).save();
    s.render();
    assert.deepEqual(s.requests.map(request => request.data), order.map(index => index ? { output_device: "output-b" } : { routing: "managed" }));
    await s.reply(0, 200);
    assert.equal(saved(s.entries[order[0]]).saving, false);
    assert.equal(saved(s.entries[order[1]]).saving, true, "another form's response cannot confirm this save");
    await s.reply(1, 200);
    assert.deepEqual(s.state.settings, { routing: "managed", output_device: "output-b", monitor_volume: "35" });
    assert.ok(s.entries.every(entry => !saved(entry).dirty && saved(entry).saveState === "saved"));
});

test("a rejected route edit stays dirty when the output form saves successfully", async context => {
    const s = await setup(context);
    s.edit(0, "managed"); s.edit(1, "output-b");
    s.entries.forEach(entry => { saved(entry).save(); }); s.render();
    await s.reply(0, 409); await s.reply(1, 200);
    assert.equal(s.state.settings.routing, "external");
    assert.equal(s.state.settings.output_device, "output-b");
    assert.equal(saved(s.entries[0]).dirty, true);
    assert.equal(saved(s.entries[1]).dirty, false);
    const select = find(s.render()[0], node => node.type === "select");
    assert.ok(select);
    assert.equal(select.props.value, "managed");
});
