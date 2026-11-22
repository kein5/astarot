import assert from "node:assert/strict";
import { test, vi } from "vitest";
import i18next from "i18next";
import { parsePortInput, PORT_INPUT_LIMITS } from "./networkPortInput.ts";
import { rvcBlockChoiceId, rvcBlockChoices } from "./rvcBlockChoices.ts";
import { buildObsBrowserSourceUrl, buildWebsocketUrl } from "./obsBrowserSourceUrl.ts";
import { hooks, loadModule, find, findIn, componentName, componentOf, unchecked } from "../test/hookHarness.ts";
import type { TreeNode } from "../test/hookHarness.ts";
import { loadBridgeRoutes, settingAtom } from "../test/bridgeHarness.ts";
import { localeAt, readLocale, textAt } from "../test/locales.ts";
import type { SaveButtonLogicOptions } from "./config_page_setter/useSettingsLogics.ts";
import type { SettingsDraftOptions } from "../voice/useSettingsDraft.tsx";
import type { EntryProps } from "../../views/app/config_page/setting_section/setting_box/_components/_atoms/_entry/_Entry.tsx";
import type { EntryWithSaveButtonProps } from "../../views/app/config_page/setting_section/setting_box/_components/entry_with_save_button/EntryWithSaveButton.tsx";


test("port drafts accept only digits in range and serialize as integers", () => {
    for (const [value, expected] of [[0, null], [1, 1], [65535, 65535], [65536, null], [-1, null],
        [true, null], [1.5, null], ["80", 80], ["8x", null], ["1.0", null], ["1e2", null],
        ["-1", null], ["+1", null], ["", null], [" 80", null], ["８０", null]]) {
        assert.equal(parsePortInput(value), expected, String(value));
    }
    assert.deepEqual(PORT_INPUT_LIMITS, { min: 1, max: 65535, step: 1 });
});

const obsNumeric = [
    ["MaxMessages", "max_messages", 1, 50], ["DisplayDuration", "display_duration", 1, 120],
    ["FadeoutDuration", "fadeout_duration", 0, 120], ["FontSize", "font_size", 10, 200],
    ["FontOutlineThickness", "font_outline_thickness", 0, 20],
] satisfies [string, string, number, number][];
const box = "../../views/app/config_page/setting_section/setting_box/";
async function settingsHarness({ host = "127.0.0.1" } = {}) {
    const runtime = hooks(), drafts: unknown[] = [], sent: [string, unknown][] = [], copied: string[] = [],
        ipc: [string, unknown][] = [], notices: string[] = [], dialogs: boolean[] = [];
    let saveOptions: SaveButtonLogicOptions | undefined, draftOptions: SettingsDraftOptions<unknown> | undefined;
    const advanced: Record<string, unknown> = {};
    for (const name of ["OscPort", "WebsocketPort", "ObsBrowserSourcePort", "RvcBlockMs", ...obsNumeric.map(([name]) => `ObsBrowserSource${name}`)]) {
        advanced[`current${name}`] = { state: "ok", data: 2231 };
        advanced[`set${name}`] = (value: unknown) => sent.push([name, value]);
    }
    Object.assign(advanced, {
        currentWebsocketHost: { data: host }, currentWebsocketAuthToken: { data: "test+token&あ" },
        currentEnableObsBrowserSource: { state: "ok", data: true },
        currentWebsocketTls: { state: "ok", data: { cert_file: "C:/certs/vox.pem", key_file: "C:/certs/vox-key.pem" } },
        setWebsocketTls: async (value: unknown) => { sent.push(["WebsocketTls", value]); return { status: 200, result: value }; },
    });
    const module = await loadModule<typeof import("../../views/app/config_page/setting_section/setting_box/advanced_settings/AdvancedSettings.tsx")>(new URL(box + "advanced_settings/AdvancedSettings.tsx", import.meta.url), runtime, {
        "./DirectVoiceSettings": { DirectVoiceSettings: () => null },
        "../shared_items/SharedItems": { AutoExportMessageLogsContainer: () => null },
        "../_components/description/Description": { Description: () => null },
        "../_components/telemetry/TelemetryContents": { TelemetryContents: () => null },
        "./GpuCheck.tsx": { GpuCheck: () => null },
        "../../../../../../logics/configs/obsBrowserSourceUrl": { buildObsBrowserSourceUrl, buildWebsocketUrl },
        "../../../../../../logics/configs/networkPortInput": { parsePortInput, PORT_INPUT_LIMITS },
        "../../../../../../logics/configs/rvcBlockChoices": { rvcBlockChoiceId, rvcBlockChoices },
        // A minimal draft: the saved pair, edited in place, submitted through the given write.
        "../../../../../../logics/voice/useSettingsDraft": { useSettingsDraft: (saved: Record<string, unknown>, _error: unknown, _updateError: unknown, options: SettingsDraftOptions<unknown>) => {
            draftOptions = options;
            const draft = { ...saved };
            return { draft, dirty: true, saving: false, navigationDialog: null,
                setDraft: (update: (draft: Record<string, unknown>) => Record<string, unknown>) => Object.assign(draft, update(draft)),
                submit: (write: (draft: Record<string, unknown>) => unknown) => write(draft) };
        } },
        "../../../../../../logics/configs/telemetryToggle": { toggleTelemetryOrAnswer: () => {}, shownTelemetry: (value: unknown) => value, telemetryUnanswered: () => false },
        "../../../../../../logics/common/useConsentDialog": { useConsentDialog: (open: boolean) => {
            dialogs.push(open);
            return { dialog: { current: null }, close: () => {} };
        } },
        "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython: async (endpoint: string, data?: unknown) => {
            ipc.push([endpoint, data]);
            return { status: 200, result: "new-token" };
        } }) },
        "@logics_common": {
            useCopyToClipboard: () => ({ copyToClipboard: (url: string) => copied.push(url) }),
            useNotificationStatus: () => ({ showNotification_Success: (text: string) => notices.push(text) }),
        },
        "@logics_configs": {
            useAdvancedSettings: () => advanced,
            useSaveButtonLogic: (options: SaveButtonLogicOptions) => {
                saveOptions = options;
                return { variable: options.variable, onChangeFunction: (value: unknown) => drafts.push(value), saveFunction: () => {} };
            },
        },
        "../_templates/Templates": { EntryWithSaveButtonContainer: () => null, ActionButtonContainer: () => null, DropdownMenuContainer: "DropdownMenuContainer" },
        "../_components": { SectionLabelComponent: () => null },
        "../_components/hint/Hint": { HintDescriptions: "hints" },
    });
    const root = runtime.render(module.AdvancedSettings);
    // The containers the page draws are components without props that draw one element.
    const child = (tree: unknown, name: string) => componentOf(findIn(tree, node => componentName(node) === name));
    const ws = runtime.render(child(root, "WebsocketContainer"));
    const obs = runtime.render(child(root, "ObsBrowserSourceContainer"));
    // The options are there once the page has drawn the field that gives them.
    return { runtime, drafts, sent, copied, ipc, notices, dialogs, get saveOptions() { assert.ok(saveOptions); return saveOptions; },
        get draftOptions() { assert.ok(draftOptions); return draftOptions; }, root, rvcBlockComponent: module.RvcBlockMsContainer,
        components: [module.OscPortContainer, child(ws, "WebsocketPortContainer"), child(obs, "ObsBrowserSourcePortContainer")],
        urlComponent: child(ws, "WebsocketUrlContainer"),
        obsUrlComponent: child(obs, "ObsBrowserSourceUrlContainer"),
        tlsComponent: child(ws, "WebsocketTlsContainer"),
        tokenComponent: child(ws, "WebsocketTokenContainer"),
        numericComponents: obsNumeric.map(([name]) => child(obs, `ObsBrowserSource${name}Container`)),
    };
}

test("all three production port fields enforce range and send numeric IPC values", async () => {
    const s = await settingsHarness();
    for (const component of s.components) {
        const row = s.runtime.render(component);
        assert.equal(row.props.type, "number");
        for (const key of ["min", "max", "step"] as const) assert.equal(row.props[key], PORT_INPUT_LIMITS[key]);
        s.drafts.length = 0;
        for (const value of ["0", "65536", "-1", "1.5", "1e2", "8x"]) row.props.onChangeFunction(value);
        assert.deepEqual(s.drafts, []);
        for (const value of ["", "1", "65535"]) row.props.onChangeFunction(value);
        assert.deepEqual(s.drafts, ["", "1", "65535"]);
        s.saveOptions.setFunction("80");
        assert.equal(s.sent.at(-1)?.[1], 80);
        s.saveOptions.setFunction("");
        assert.equal(s.sent.at(-1)?.[1], null); // backend returns existing localized invalid-port error
    }
});

test("the RVC block length is Automatic or 20 to 200 ms in steps of 20 under Advanced (#531)", async () => {
    const s = await settingsHarness();
    assert.ok(find(s.root, node => node.type === s.rvcBlockComponent), "the Advanced page shows it");
    const row = s.runtime.render(s.rvcBlockComponent);
    assert.equal(row.type, "DropdownMenuContainer");
    assert.equal(row.props.setting_id, "rvc_block_ms");
    // Automatic (0) first, then every length the backend accepts, in order.
    assert.deepEqual(Object.keys(row.props.list), ["0", "20", "40", "60", "80", "100", "120", "140", "160", "180", "200"]);
    assert.equal(row.props.list["0"], "config_page.advanced_settings.rvc_block_ms.automatic");
    // A saved value the backend would not keep shows as Automatic, as the backend loads it.
    assert.equal(row.props.selected_id, "0");
    row.props.selectFunction({ dropdown_id: "rvc_block_ms", selected_id: "60" });
    assert.deepEqual(s.sent.at(-1), ["RvcBlockMs", 60]);
    row.props.selectFunction({ dropdown_id: "rvc_block_ms", selected_id: "0" });
    assert.deepEqual(s.sent.at(-1), ["RvcBlockMs", 0]);
    for (const language of ["en", "ja"]) {
        const strings = readLocale(language);
        const key = (name: string) => textAt(strings, `config_page.advanced_settings.rvc_block_ms.${name}`);
        assert.ok(key("desc").includes(key("automatic")), `${language}: the description says what Automatic does`);
        assert.equal(key("length"), "{{ms}} ms", language);
        assert.equal(typeof localeAt(strings, "backend_errors.VALIDATION_RVC_BLOCK_MS"), "string", language);
    }
});

test("the block choices keep a saved length and show anything else as Automatic", () => {
    const list = rvcBlockChoices("Automatic", ms => `${ms} ms`);
    assert.equal(list["0"], "Automatic");
    assert.equal(list["120"], "120 ms");
    for (const [saved, shown] of [[0, "0"], [40, "40"], [200, "200"], [30, "0"], [220, "0"], ["40", "0"], [null, "0"], [undefined, "0"]] as const) {
        assert.equal(rvcBlockChoiceId(saved), shown, String(saved));
    }
});

test("native number input receives min, max and step through the shared components", async () => {
    const runtime = hooks();
    runtime.api.useImperativeHandle = () => {};
    const { _Entry } = await loadModule<typeof import("../../views/app/config_page/setting_section/setting_box/_components/_atoms/_entry/_Entry.tsx")>(new URL(box + "_components/_atoms/_entry/_Entry.tsx", import.meta.url), runtime);
    const { EntryWithSaveButton } = await loadModule<typeof import("../../views/app/config_page/setting_section/setting_box/_components/entry_with_save_button/EntryWithSaveButton.tsx")>(new URL(box + "_components/entry_with_save_button/EntryWithSaveButton.tsx", import.meta.url), runtime,
        { "../_atoms/_entry/_Entry": { _Entry } });
    // Test data: only the props the number input reads, without a save.
    const wrapper = runtime.render(EntryWithSaveButton, unchecked<EntryWithSaveButtonProps>({ type: "number", variable: 2231, ...PORT_INPUT_LIMITS }));
    const entry = findIn(wrapper, node => node.type === _Entry);
    const tree = runtime.render(_Entry, unchecked<EntryProps>(entry.props));
    const input = findIn(tree, node => node.type === "input");
    for (const key of ["min", "max", "step"] as const) assert.equal(input.props[key], PORT_INPUT_LIMITS[key]);
});

test("WebSocket copy uses the exact token returned by the backend and masks only the display", async () => {
    const s = await settingsHarness();
    const row = s.runtime.render(s.urlComponent);
    row.props.onclickFunction();
    assert.equal(new URL(s.copied[0]).searchParams.get("token"), "test+token&あ");
    assert.ok(!JSON.stringify(row.props).includes("test+token"));
});

test("a LAN host copies encrypted URLs for WebSocket and OBS", async () => {
    const s = await settingsHarness({ host: "192.168.1.20" });
    s.runtime.render(s.urlComponent).props.onclickFunction();
    s.runtime.render(s.obsUrlComponent).props.children[0].props.onclickFunction();
    assert.ok(s.copied[0].startsWith("wss://192.168.1.20:2231/?token="), s.copied[0]);
    assert.ok(s.copied[1].startsWith("https://192.168.1.20:"), s.copied[1]);
});

test("the certificate and key are saved together as one pair", async () => {
    const s = await settingsHarness();
    const rows = s.runtime.render(s.tlsComponent).props.children.filter(Boolean);
    const [cert, key] = rows.filter((row: TreeNode) => row.props?.setting_id?.startsWith("websocket_tls_"));
    assert.deepEqual([cert.props.variable, key.props.variable], ["C:/certs/vox.pem", "C:/certs/vox-key.pem"]);
    cert.props.onChangeFunction("D:/new.pem");
    await key.props.saveFunction();
    assert.deepEqual(s.sent.at(-1), ["WebsocketTls", { cert_file: "D:/new.pem", key_file: "C:/certs/vox-key.pem" }]);
    // The save bar lists the field by its own label.
    assert.equal(s.draftOptions.label?.(["key_file"]), "config_page.advanced_settings.websocket_tls_key_file.label");
});

test("a new connection key is made only after the question is answered", async () => {
    const s = await settingsHarness();
    let tree = s.runtime.render(s.tokenComponent);
    const [button] = tree.props.children;
    assert.equal(tree.props.children[1], false); // No dialog yet.
    button.props.onclickFunction();
    assert.deepEqual(s.ipc, []);
    tree = s.runtime.render(s.tokenComponent);
    const dialog = find(tree, node => node.type === "dialog");
    assert.ok(dialog && s.dialogs.at(-1) === true);
    const [cancel] = findIn(dialog, node => node.type === "div" && Array.isArray(node.props.children)
        && node.props.children.every((child: TreeNode | null) => child?.type === "button")).props.children;
    assert.equal(cancel.props.autoFocus, true); // The safe choice has the focus.
    // Drawn in the app's dialog frame: the forms' container (border, padding, buttons) and the
    // shared frame (width), as every dialog on that frame; with the frame alone it was bare.
    assert.deepEqual(String(tree.props.children[1].props.className).split(" ").sort(), ["container", "host"]);
    cancel.props.onClick();
    assert.deepEqual(s.ipc, []);
    assert.equal(s.runtime.render(s.tokenComponent).props.children[1], false);

    s.runtime.render(s.tokenComponent).props.children[0].props.onclickFunction();
    const again = find(s.runtime.render(s.tokenComponent), node => node.type === "dialog");
    const buttons = findIn(again, node => node.type === "div" && Array.isArray(node.props.children)
        && node.props.children.every((child: TreeNode | null) => child?.type === "button")).props.children;
    await buttons[1].props.onClick();
    assert.deepEqual(s.ipc, [["/run/regenerate_websocket_auth_token", undefined]]);
    assert.deepEqual(s.notices, ["config_page.advanced_settings.websocket_token.done"]);
});

for (const language of ["en", "ja"]) {
    const translation = readLocale(language);
    for (const [endpoint, code, field, previous] of [
        ["osc_port", "VALIDATION_OSC_PORT_INVALID", "OscPort", 9000],
        ["websocket_port", "WEBSOCKET_PORT_INVALID", "WebsocketPort", 2231],
        ["obs_browser_source_port", "OBS_BROWSER_SOURCE_PORT_INVALID", "ObsBrowserSourcePort", 2232],
        ["websocket_host", "VALIDATION_INVALID_IP", "WebsocketHost", "127.0.0.1"],
        ["websocket_host", "WEBSOCKET_HOST_NEEDS_TLS", "WebsocketHost", "127.0.0.1"],
        ["websocket_host", "WEBSOCKET_HOST_RESET_WITHOUT_TLS", "WebsocketHost", "127.0.0.1"],
        ["websocket_tls", "WEBSOCKET_HOST_NEEDS_TLS", "WebsocketTls", { cert_file: "a.pem", key_file: "b.pem" }],
        ["websocket_tls", "WEBSOCKET_TLS_INVALID", "WebsocketTls", { cert_file: "", key_file: "" }],
    ] satisfies [string, string, string, unknown][]) {
        test(`${language}: ${code} restores the setting and shows localized guidance`, async () => {
            vi.spyOn(console, "error").mockImplementation(() => {});
            const i18n = i18next.createInstance();
            await i18n.init({ lng: language, resources: { [language]: { translation } } });
            const s = await loadBridgeRoutes(undefined, i18n);
            // The registry keeps each setting's atom, which the setting's hook writes.
            const atom = settingAtom(s.stores.dynamicStoreRegistry, `Atom_${field}`);
            s.runtime.store.set(atom, { state: "pending", data: previous });
            s.receiveRoutes({ endpoint: `/set/data/${endpoint}`, status: 400,
                result: { error_code: code, data: previous } });
            assert.deepEqual(s.runtime.store.get(atom), { state: "ok", data: previous });
            const text = i18n.t(`backend_errors.${code}`);
            assert.ok(i18n.exists(`backend_errors.${code}`));
            assert.equal(s.notices[0].key, text);
            if (endpoint.endsWith("_port")) assert.match(text, /65535/);
        });
    }
    test(`${language}: WebSocket host label states IPv4`, () => {
        assert.match(textAt(translation, "config_page.advanced_settings.websocket_host.label"), /IPv4/);
    });
}

for (const [index, [name, suffix, min, max]] of obsNumeric.entries()) test(`OBS ${name} exposes its bounds and preserves invalid drafts for validation`, async () => {
    const s = await settingsHarness();
    const row = s.runtime.render(s.numericComponents[index]);
    assert.deepEqual([row.props.min, row.props.max, row.props.step], [min, max, 1]);
    for (const value of ["-1", "1.5", String(max + 1), ""]) row.props.onChangeFunction(value);
    assert.deepEqual(s.drafts, ["-1", "1.5", String(max + 1), ""]);
    for (const lang of ["en", "ja"]) {
        const strings = readLocale(lang);
        const description = textAt(strings, `config_page.advanced_settings.obs_browser_source_${suffix}.desc`);
        assert.ok(description.includes(String(min)) && description.includes(String(max)));
    }
});
