import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import yaml from "js-yaml";
import { hooks, loadModule, find } from "../../../../../../logics/test/hookHarness.js";
import * as telemetryToggle from "../../../../../../logics/configs/telemetryToggle.ts";

// Settings → Advanced, "Send usage data". ENABLE_TELEMETRY starts true, and before the one-time
// notice is answered nothing is sent: the switch showed on, and pressing it answered "don't send".
async function render({ enabled, pending }) {
    const runtime = hooks(), calls = [];
    const others = {
        currentTelemetry: { state: "ok", data: enabled },
        currentTelemetryNotice: { state: "ok", data: { pending, enabled } },
        toggleTelemetry: () => calls.push(["toggle"]),
        setTelemetryNotice: answer => { calls.push(["answer", answer]); return Promise.resolve(); },
        getTelemetry: () => calls.push(["read"]),
    };
    const CheckboxContainer = () => null;
    const module = await loadModule(new URL("./AdvancedSettings.jsx", import.meta.url), runtime, {
        "./DirectVoiceSettings": { DirectVoiceSettings: () => null },
        "../shared_items/SharedItems": { AutoExportMessageLogsContainer: () => null },
        "../_components/description/Description": { Description: () => null },
        "../_components/telemetry/TelemetryContents": { TelemetryContents: () => null },
        "./GpuCheck.tsx": { GpuCheck: () => null },
        "../../../../../../logics/configs/telemetryToggle": telemetryToggle,
        "../../../../../../logics/configs/networkPortInput": {},
        "../../../../../../logics/configs/obsBrowserSourceUrl": {},
        "../../../../../../logics/voice/useSettingsDraft": {},
        "../../../../../../logics/common/useConsentDialog": {},
        "@logics_common": {},
        "@logics_configs": { useOthers: () => others, useAdvancedSettings: () => ({}) },
        "../_templates/Templates": { CheckboxContainer },
        "../_components": { SectionLabelComponent: () => null },
    });
    const page = runtime.render(module.AdvancedSettings);
    const Telemetry = find(page, node => node.type?.name === "TelemetryContainer").type;
    const tree = runtime.render(Telemetry);
    const checkbox = find(tree, node => node.type === CheckboxContainer);
    return { calls, checkbox };
}

test("while the notice is unanswered the switch is off, says no choice was made, and one press sends", async () => {
    const { calls, checkbox } = await render({ enabled: true, pending: true });
    assert.equal(checkbox.props.variable.data, false);
    // Said in the setting's own row, under its description, and read with the checkbox.
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
        const locale = yaml.load(readFileSync(new URL(`../../../../../../../locales/${name}.yml`, import.meta.url), "utf8"));
        const text = locale.config_page.advanced_settings.telemetry.unanswered;
        assert.equal(typeof text, "string", name);
        assert.ok(text.length > 10, name);
    }
});
