import assert from "node:assert/strict";
import { test } from "vitest";
import { componentNamed, hooks, loadModule } from "../../../../../../logics/test/hookHarness.ts";
import { settingTarget } from "../../../../../../logics/configs/config_page_setter/_aux/configSearchTargets.ts";

// The settings more than one page shows (SharedItems.tsx), drawn with their shared rows as stand-ins
// that keep their props. Each row is found by the settings search under the id it looks for, says
// what it is, shows the saved value and changes that setting.

const t = (key: string, variables?: object) => variables ? `${key} ${JSON.stringify(variables)}` : key;
type Setting = { state: string; data: unknown };
const ok = (data: unknown): Setting => ({ state: "ok", data });

async function sharedItems(osc: Setting = ok(true)) {
    const calls: unknown[][] = [], runtime = hooks();
    // useOthers: a value of its own for every setting; every action records its call.
    const others = new Proxy({}, { get: (_, key) => {
        const name = String(key);
        if (name.startsWith("current")) return ok(`${name} value`);
        return (...args: unknown[]) => { calls.push([name, ...args]); };
    } });
    const module = await loadModule<typeof import("./SharedItems.tsx")>(new URL("./SharedItems.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t }) },
        "@logics_common": { useIsOscAvailable: () => ({ currentIsOscAvailable: osc, oscUnavailableLabelKey: "config_page.others.osc_unavailable_reason" }) },
        "@logics_configs": { useOthers: () => others },
        "../_templates/Templates": { CheckboxContainer: "checkbox", MessageFormatContainer: "message-format" },
    });
    const draw = (name: string) => runtime.render(componentNamed(module, name));
    return { calls, others, draw };
}

// The switches: [container, the setting's name, its locale key under config_page.others, its description].
const ROMAJI_DESC = ["config_page.others.common_convert_message_hiragana_romaji.desc_1", "config_page.others.common_convert_message_hiragana_romaji.desc_2",
    `config_page.others.convert_message_to_romaji.desc {"convert_message_to_hiragana":"config_page.others.convert_message_to_hiragana.label"}`].join("\n");
const SWITCHES: [string, string, string, string | undefined][] = [
    ["AutoClearMessageInputBoxContainer", "EnableAutoClearMessageInputBox", "auto_clear_the_message_box", undefined],
    ["SendOnlyTranslatedMessagesContainer", "EnableSendOnlyTranslatedMessages", "send_only_translated_messages", undefined],
    ["AutoExportMessageLogsContainer", "EnableAutoExportMessageLogs", "auto_export_message_logs", "config_page.others.auto_export_message_logs.desc"],
    ["SendMessageToVrcContainer", "EnableSendMessageToVrc", "send_message_to_vrc", "config_page.others.send_message_to_vrc.desc"],
    ["EnableNotificationVrcSfxContainer", "EnableNotificationVrcSfx", "notification_vrc_sfx", "config_page.others.notification_vrc_sfx.desc"],
    ["SendReceivedMessageToVrcContainer", "EnableSendReceivedMessageToVrc", "send_received_message_to_vrc", "config_page.others.send_received_message_to_vrc.desc"],
    ["ConvertMessageToRomajiContainer", "ConvertMessageToRomaji", "convert_message_to_romaji", ROMAJI_DESC],
    ["ConvertMessageToHiraganaContainer", "ConvertMessageToHiragana", "convert_message_to_hiragana",
        "config_page.others.common_convert_message_hiragana_romaji.desc_1\nconfig_page.others.common_convert_message_hiragana_romaji.desc_2"],
];

test("each shared switch is where the settings search looks for it, says what it is, and turns its own setting on or off", async () => {
    const s = await sharedItems();
    for (const [name, base, key, desc] of SWITCHES) {
        const row = s.draw(name);
        assert.equal(row.type, "checkbox", name);
        assert.equal(row.props.setting_id, settingTarget("others", key), name);
        assert.deepEqual([row.props.setting_id, row.props.label, row.props.desc], [key, `config_page.others.${key}.label`, desc], name);
        assert.deepEqual(row.props.variable, ok(`current${base} value`), name);
        row.props.toggleFunction();
        assert.deepEqual(s.calls.splice(0), [[`toggle${base}`]], name);
    }
});

test("the VRChat mic mute sync says why it cannot work while OSC is unavailable, and only then", async () => {
    for (const [osc, warnings] of [[false, [{ label: "config_page.others.osc_unavailable_reason" }]], [true, []], [null, []]] as const) {
        const s = await sharedItems(ok(osc));
        const row = s.draw("VrcMicMuteSyncContainer");
        assert.equal(row.type, "checkbox");
        assert.deepEqual([row.props.setting_id, row.props.label, row.props.desc, row.props.is_available, row.props.add_warnings],
            ["vrc_mic_mute_sync", "config_page.others.vrc_mic_mute_sync.label", "config_page.others.vrc_mic_mute_sync.desc", osc, warnings], String(osc));
        assert.equal(row.props.setting_id, settingTarget("others", "vrc_mic_mute_sync"));
        assert.deepEqual(row.props.variable, ok("currentEnableVrcMicMuteSync value"));
        row.props.toggleFunction();
        assert.deepEqual(s.calls, [["toggleEnableVrcMicMuteSync"]]);
    }
});

test("the formats of sent and received messages each edit their own parts", async () => {
    const s = await sharedItems();
    for (const [name, base, key, format] of [["SendMessageFormatPartsContainer", "SendMessageFormatParts", "send_message_format", "send"],
        ["ReceivedMessageFormatPartsContainer", "ReceivedMessageFormatParts", "received_message_format", "received"]]) {
        const row = s.draw(name);
        assert.equal(row.type, "message-format", name);
        assert.deepEqual([row.props.setting_id, row.props.label, row.props.desc, row.props.format_id],
            [key, `config_page.others.${key}.label`, `config_page.others.${key}.desc`, format], name);
        assert.equal(row.props.setting_id, settingTarget("others", key), name);
        assert.deepEqual(row.props.variable, ok(`current${base} value`), name);
        row.props.setFunction({ parts: [] });
        assert.deepEqual(s.calls.splice(0), [[`set${base}`, { parts: [] }]], name);
    }
});
