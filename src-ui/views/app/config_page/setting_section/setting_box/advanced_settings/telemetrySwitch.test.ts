import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, findIn, componentName, componentOf } from "../../../../../../logics/test/hookHarness.ts";
import { readLocale, localeAt } from "../../../../../../logics/test/locales.ts";
import * as telemetryToggle from "../../../../../../logics/configs/telemetryToggle.ts";
import * as fieldErrors from "../../../../../../logics/configs/fieldErrors.ts";
import * as fieldChecks from "../../../../../../logics/configs/fieldChecks.ts";


// Settings → Advanced, "Send usage data". ENABLE_TELEMETRY starts true, and before the one-time
// notice is answered nothing is sent: the switch showed on, and pressing it answered "don't send".
async function render({ enabled, pending }: { enabled: boolean; pending: boolean }) {
    const runtime = hooks(), calls: unknown[][] = [];
    const others = {
        currentTelemetry: { state: "ok", data: enabled },
        currentTelemetryNotice: { state: "ok", data: { pending, enabled } },
        toggleTelemetry: () => calls.push(["toggle"]),
        setTelemetryNotice: (answer: unknown) => { calls.push(["answer", answer]); return Promise.resolve(); },
        getTelemetry: () => calls.push(["read"]),
    };
    const SwitchContainer = () => null;
    const module = await loadModule<typeof import("./AdvancedSettings.tsx")>(new URL("./AdvancedSettings.tsx", import.meta.url), runtime, {
        "./DirectVoiceSettings": { DirectVoiceSettings: () => null },
        "../shared_items/SharedItems": { AutoExportMessageLogsContainer: () => null },
        "../_components/description/Description": { Description: () => null },
        "../_components/telemetry/TelemetryContents": { TelemetryContents: () => null },
        "./GpuCheck.tsx": { GpuCheck: () => null },
        "../../../../../../logics/configs/telemetryToggle": telemetryToggle,
        "../../../../../../logics/configs/networkPortInput": {},
        "../../../../../../logics/configs/rvcBlockChoices": {},
        "../../../../../../logics/configs/obsBrowserSourceUrl": {},
        "../../../../../../logics/configs/logDestination": {},
        "../../../../../../logics/configs/fieldErrors.ts": fieldErrors,
        "../../../../../../logics/configs/fieldChecks.ts": fieldChecks,
        "../../../../../../logics/voice/useSettingsDraft": {},
        "../../../../../../logics/common/useConsentDialog": {},
        "@logics_common": {},
        "@logics_configs": { useOthers: () => others, useAdvancedSettings: () => ({}) },
        "../_templates/Templates": { SwitchContainer },
        "../_components": { SectionLabelComponent: () => null },
        "../_components/_atoms/_entry/_Entry": { _Entry: () => null },
        "../_components/path_field/PathField": { PathPickButton: "path-pick" },
        "../_components/hint/Hint": { HintDescriptions: "hints" },
    });
    const page = runtime.render(module.AdvancedSettings);
    // The page's own telemetry row, a component that takes no props.
    const Telemetry = componentOf(findIn(page, node => componentName(node) === "TelemetryContainer"));
    const tree = runtime.render(Telemetry);
    const checkbox = findIn(tree, node => node.type === SwitchContainer);
    return { calls, checkbox };
}

test("while the notice is unanswered the switch is off, says no choice was made, and one press sends", async () => {
    const { calls, checkbox } = await render({ enabled: true, pending: true });
    assert.equal(checkbox.props.variable.data, false);
    // Said in the setting's own row, under its description, and read with the switch.
    assert.equal(checkbox.props.note, "config_page.advanced_settings.telemetry.unanswered");
    assert.ok(checkbox.props.note_id);
    assert.equal(checkbox.props["aria-describedby"], checkbox.props.note_id);
    await checkbox.props.toggleFunction();
    assert.deepEqual(calls, [["answer", { send: true }], ["read"]]);
});

test("once answered the switch shows the setting and works as a switch", async () => {
    for (const enabled of [true, false]) {
        const { calls, checkbox } = await render({ enabled, pending: false });
        assert.equal(checkbox.props.variable.data, enabled);
        assert.equal(checkbox.props.note, undefined);
        assert.equal(checkbox.props["aria-describedby"], undefined);
        await checkbox.props.toggleFunction();
        assert.deepEqual(calls, [["toggle"]]);
    }
});

test("the note is worded in both languages", () => {
    for (const name of ["en", "ja"]) {
        const text = localeAt(readLocale(name), "config_page.advanced_settings.telemetry.unanswered");
        assert.equal(typeof text, "string", name);
        assert.ok(typeof text === "string" && text.length > 10, name);
    }
});
