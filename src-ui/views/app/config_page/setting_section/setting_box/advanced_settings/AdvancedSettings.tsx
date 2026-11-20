import { useId, useMemo, useState } from "react";
import { useI18n } from "@useI18n";
import { useStdoutToPython } from "@useStdoutToPython";
import styles from "./AdvancedSettings.module.scss";
import voiceStyles from "./VoiceSettings.module.scss";
import dialogStyles from "../_components/download_models/LegacyModelDownloadDialog.module.scss";
import { AutoExportMessageLogsContainer } from "../shared_items/SharedItems";
import { Description } from "../_components/description/Description";
import { TelemetryContents } from "../_components/telemetry/TelemetryContents";
import { GpuCheck } from "./GpuCheck.tsx";
import { parsePortInput, PORT_INPUT_LIMITS } from "../../../../../../logics/configs/networkPortInput";
import { buildObsBrowserSourceUrl, buildWebsocketUrl } from "../../../../../../logics/configs/obsBrowserSourceUrl";
import { useSettingsDraft } from "../../../../../../logics/voice/useSettingsDraft";
import { useConsentDialog } from "../../../../../../logics/common/useConsentDialog";
import { shownTelemetry, telemetryUnanswered, toggleTelemetryOrAnswer } from "../../../../../../logics/configs/telemetryToggle";
import type { DraftWriteValue } from "../../../../../../logics/voice/useSettingsDraft";
import type { StdoutResult } from "@useStdoutToPython";

import { useCopyToClipboard, useOpenFolder, useNotificationStatus } from "@logics_common";
import {
    useAdvancedSettings,
    useOthers,
    useSaveButtonLogic,
} from "@logics_configs";

import {
    CheckboxContainer,
    ActionButtonContainer,
    EntryWithSaveButtonContainer,
    ColorEntryWithSaveButtonContainer,
} from "../_templates/Templates";

import {
    SectionLabelComponent,
} from "../_components";

import OpenFolderSvg from "@images/open_folder.svg?react";
import CopyThinSvg from "@images/copy_thin.svg?react";
import CheckMarkSvg from "@images/check_mark.svg?react";
import RefreshSvg from "@images/refresh.svg?react";

// The value in a field as the entry shows it: the saved value (a string or a number), what was
// typed, or the value the backend answered a save with, written as React writes it into the field.
const fieldValue = (value: unknown): string | number | null | undefined =>
    typeof value === "string" || typeof value === "number" || value === null || value === undefined ? value : String(value);
const fieldText = (value: unknown): string | null | undefined => value === null || value === undefined ? value : String(value);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null;
// The backend's answer to a request, when it answered with one (not a bare true or false).
const answerOf = (response: StdoutResult | undefined) => typeof response === "object" && response !== null ? response : null;
// The error code in a refused answer's result, if it names one.
const errorCodeOf = (result: unknown): string | undefined =>
    isRecord(result) && typeof result.error_code === "string" ? result.error_code : undefined;

// The two paths of the TLS pair.
type TlsField = "cert_file" | "key_file";
type TlsPaths = Readonly<Record<TlsField, string>>;

export const AdvancedSettings = () => {
    const { t } = useI18n();

    return (
        <div className={styles.container}>
            <div>
                <SectionLabelComponent label={t("config_page.advanced_settings.section_label_logs")} />
                <AutoExportMessageLogsContainer />
            </div>
            <div>
                <SectionLabelComponent label={t("config_page.advanced_settings.section_label_config_file")} />
                <OpenConfigFolderContainer />
            </div>
            <div>
                <SectionLabelComponent label={t("config_page.advanced_settings.section_label_telemetry")} />
                <TelemetryContainer />
            </div>
            {/* The GPU check, next to the usage data: both say what leaves the PC (#288). It
                sends nothing itself; the user reads the report and may send it on GitHub. */}
            <div>
                <SectionLabelComponent label={t("config_page.advanced_settings.section_label_gpu_check")} />
                <GpuCheck />
            </div>
            {/* Where messages go to VRChat: set once, if ever, like the other connections below.
                The VRChat page says whether VRChat is found and leads here (#554, Q-06). */}
            <div>
                <SectionLabelComponent label={t("config_page.advanced_settings.section_label_osc")} />
                <OscIpAddressContainer />
                <OscPortContainer />
                <OscQueryContainer />
            </div>
            <WebsocketContainer />
            <ObsBrowserSourceContainer />
            <div>
                <SectionLabelComponent label={t("config_page.advanced_settings.section_label_rvc")} />
                <RvcBlockMsContainer />
            </div>
        </div>
    );
};

// The block an RVC conversion cuts the microphone into (#531). The backend refuses anything but
// 20 to 200 ms in steps of 20 and keeps the saved value; the next Start reads it.
export const RvcBlockMsContainer = () => {
    const { t } = useI18n();
    const { currentRvcBlockMs, setRvcBlockMs } = useAdvancedSettings();

    const { variable, onChangeFunction, saveFunction } = useSaveButtonLogic({
        variable: currentRvcBlockMs.data,
        state: currentRvcBlockMs.state,
        setFunction: setRvcBlockMs,
        label: t("config_page.advanced_settings.rvc_block_ms.label"),
    });

    return (
        <EntryWithSaveButtonContainer
            setting_id="rvc_block_ms"
            label={t("config_page.advanced_settings.rvc_block_ms.label")}
            desc={t("config_page.advanced_settings.rvc_block_ms.desc")}
            variable={fieldValue(variable)}
            saveFunction={saveFunction}
            onChangeFunction={onChangeFunction}
            state={currentRvcBlockMs.state}
            width="10rem"
            type="number"
            min={20} max={200} step={20}
        />
    );
};

export const OscIpAddressContainer = () => {
    const { t } = useI18n();
    const { currentOscIpAddress, setOscIpAddress } = useAdvancedSettings();

    const { variable, onChangeFunction, saveFunction } = useSaveButtonLogic({
        variable: currentOscIpAddress.data,
        state: currentOscIpAddress.state,
        setFunction: setOscIpAddress,
        label: t("config_page.advanced_settings.osc_ip_address.label"),
    });

    return (
        <EntryWithSaveButtonContainer
            label={t("config_page.advanced_settings.osc_ip_address.label")}
            variable={fieldValue(variable)}
            saveFunction={saveFunction}
            onChangeFunction={onChangeFunction}
            state={currentOscIpAddress.state}
            width="14rem"
        />
    );
};

export const OscPortContainer = () => {
    const { t } = useI18n();
    const { currentOscPort, setOscPort } = useAdvancedSettings();

    const { variable, onChangeFunction: rawOnChange, saveFunction } = useSaveButtonLogic({
        variable: currentOscPort.data,
        state: currentOscPort.state,
        setFunction: (value: unknown) => setOscPort(parsePortInput(value)),
        label: t("config_page.advanced_settings.osc_port.label"),
    });

    const onChangeFunction = (value: string) => {
        if (value === "" || parsePortInput(value) !== null) rawOnChange(value);
    };

    return (
        <EntryWithSaveButtonContainer
            label={t("config_page.advanced_settings.osc_port.label")}
            variable={fieldValue(variable)}
            saveFunction={saveFunction}
            onChangeFunction={onChangeFunction}
            state={currentOscPort.state}
            width="10rem"
            type="number"
            {...PORT_INPUT_LIMITS}
        />
    );
};

// OSCQuery finds VRChat and reads its mute state (#559). Off, nothing listens for VRChat or
// announces the app; mute sync and the VRChat check say why they are unavailable.
const OscQueryContainer = () => {
    const { t } = useI18n();
    const { currentEnableOscQuery, toggleEnableOscQuery } = useAdvancedSettings();

    return (
        <CheckboxContainer
            setting_id="osc_query"
            label={t("config_page.advanced_settings.osc_query.label")}
            desc={t("config_page.advanced_settings.osc_query.desc")}
            variable={currentEnableOscQuery}
            toggleFunction={toggleEnableOscQuery}
        />
    );
};

const OpenConfigFolderContainer = () => {
    const { t } = useI18n();
    const { openFolder_ConfigFile } = useOpenFolder();

    return (
        <>
            <ActionButtonContainer
                label={t("config_page.advanced_settings.open_config_filepath.label")}
                IconComponent={OpenFolderSvg}
                ClickedIconComponent={CheckMarkSvg}
                clicked_duration={1000}
                onclickFunction={openFolder_ConfigFile}
            />
        </>
    );
};

// Usage events (the app started; an error by its code) are sent once this is on and the
// one-time notice is answered. Until the answer the switch shows off, as nothing is sent, and
// says that no choice was made; pressing it then answers "send" (telemetryToggle.ts, SEC-07).
const TelemetryContainer = () => {
    const { t } = useI18n();
    const others = useOthers();
    const unansweredId = useId();
    const unanswered = telemetryUnanswered(others.currentTelemetryNotice);

    return (
        <>
            <CheckboxContainer
                setting_id="telemetry"
                label={t("config_page.advanced_settings.telemetry.label")}
                desc={t("config_page.advanced_settings.telemetry.desc")}
                variable={shownTelemetry(others.currentTelemetry, others.currentTelemetryNotice)}
                toggleFunction={() => toggleTelemetryOrAnswer(others)}
                note={unanswered ? t("config_page.advanced_settings.telemetry.unanswered") : undefined}
                note_id={unansweredId}
                aria-describedby={unanswered ? unansweredId : undefined}
            />
            {/* The event itself as it would be sent, and what was sent before. */}
            <div className={styles.telemetry_contents}>
                <TelemetryContents with_sent />
            </div>
        </>
    );
};

const WebsocketContainer = () => {
    return (
        <div>
            <SectionLabelComponent label="WebSocket" />
            <EnableWebsocketContainer />
            <WebsocketHostContainer />
            <WebsocketPortContainer />
            <WebsocketTlsContainer />
            <WebsocketUrlContainer />
            <WebsocketTokenContainer />
        </div>
    );
};

const EnableWebsocketContainer = () => {
    const { t } = useI18n();
    const { currentEnableWebsocket, toggleEnableWebsocket, currentEnableObsBrowserSource } = useAdvancedSettings();

    const is_locked = currentEnableObsBrowserSource.data === true;
    const add_warnings = [];
    if (is_locked) {
        add_warnings.push({ label: t("config_page.advanced_settings.enable_websocket.locked_by_obs_browser_source") });
    }

    return (
        <CheckboxContainer
            label={t("config_page.advanced_settings.enable_websocket.label")}
            variable={currentEnableWebsocket}
            toggleFunction={toggleEnableWebsocket}
            is_available={!is_locked}
            add_warnings={add_warnings}
        />
    );
};

const WebsocketHostContainer = () => {
    const { t } = useI18n();
    const { currentWebsocketHost, setWebsocketHost } = useAdvancedSettings();

    const { variable, onChangeFunction, saveFunction } = useSaveButtonLogic({
        variable: currentWebsocketHost.data,
        state: currentWebsocketHost.state,
        setFunction: setWebsocketHost,
        label: t("config_page.advanced_settings.websocket_host.label"),
    });

    return (
        <EntryWithSaveButtonContainer
            label={t("config_page.advanced_settings.websocket_host.label")}
            desc={t("config_page.advanced_settings.websocket_host.desc")}
            variable={fieldValue(variable)}
            saveFunction={saveFunction}
            onChangeFunction={onChangeFunction}
            state={currentWebsocketHost.state}
            width="14rem"
        />
    );
};

// The certificate and key for listening beyond this PC (paths to PEM files). Saved as a pair:
// the backend loads them first and refuses a pair that does not work.
const WebsocketTlsContainer = () => {
    const { t } = useI18n();
    const { currentWebsocketTls, setWebsocketTls } = useAdvancedSettings();
    const [error, updateError] = useState<string | null>(null);
    const saved = useMemo<TlsPaths>(() => ({
        cert_file: currentWebsocketTls.data?.cert_file ?? "", key_file: currentWebsocketTls.data?.key_file ?? "",
    }), [currentWebsocketTls.data]);
    const label = (name: string) => t(`config_page.advanced_settings.websocket_tls_${name}.label`);
    const write = async (value: DraftWriteValue<TlsPaths>) => {
        const response = await setWebsocketTls(value);
        const answer = answerOf(response);
        if (answer?.status !== 200) updateError(errorCodeOf(answer?.result) || "save_unconfirmed");
        return response;
    };
    const form = useSettingsDraft(saved, error, updateError, { write, label: ([name]) => label(name) });
    const draft = form.draft;
    if (!draft) return null;
    const field = (name: TlsField) => ({
        setting_id: `websocket_tls_${name}`,
        label: label(name),
        desc: t(`config_page.advanced_settings.websocket_tls_${name}.desc`),
        variable: draft[name],
        state: form.saving || currentWebsocketTls.state === "pending" ? "pending" : "ok",
        onChangeFunction: (value: string) => form.setDraft(previous => previous && ({ ...previous, [name]: value })),
        saveFunction: () => { if (form.dirty) return form.submit(write); },
    });
    return <>
        <EntryWithSaveButtonContainer {...field("cert_file")} remove_border_bottom={true} />
        <EntryWithSaveButtonContainer {...field("key_file")} />
        {form.navigationDialog}
    </>;
};

const WebsocketPortContainer = () => {
    const { t } = useI18n();
    const { currentWebsocketPort, setWebsocketPort } = useAdvancedSettings();

    const { variable, onChangeFunction: rawOnChange, saveFunction } = useSaveButtonLogic({
        variable: currentWebsocketPort.data,
        state: currentWebsocketPort.state,
        setFunction: (value: unknown) => setWebsocketPort(parsePortInput(value)),
        label: t("config_page.advanced_settings.websocket_port.label"),
    });

    const onChangeFunction = (value: string) => {
        if (value === "" || parsePortInput(value) !== null) rawOnChange(value);
    };

    return (
        <EntryWithSaveButtonContainer
            label={t("config_page.advanced_settings.websocket_port.label")}
            variable={fieldValue(variable)}
            saveFunction={saveFunction}
            onChangeFunction={onChangeFunction}
            state={currentWebsocketPort.state}
            width="10rem"
            type="number"
            {...PORT_INPUT_LIMITS}
        />
    );
};


const WebsocketUrlContainer = () => {
    const { t } = useI18n();
    const { copyToClipboard } = useCopyToClipboard();
    const { currentWebsocketHost, currentWebsocketPort, currentWebsocketAuthToken } = useAdvancedSettings();

    // The token stays off screen (screenshots, streams); the copy has it.
    const { url, shown } = buildWebsocketUrl(
        currentWebsocketHost.data, currentWebsocketPort.data, currentWebsocketAuthToken.data,
    );

    return (
        <ActionButtonContainer
            label={t("config_page.advanced_settings.websocket_url.label")}
            desc={shown}
            IconComponent={CopyThinSvg}
            ClickedIconComponent={CheckMarkSvg}
            clicked_duration={1000}
            onclickFunction={() => copyToClipboard(url)}
        />
    );
};

// A new token makes a leaked URL useless at once. OBS and other apps then need the URLs copied
// again, so the button asks first, says what stops working, and leaves a way back.
const WebsocketTokenContainer = () => {
    const { t } = useI18n();
    const key = (name: string) => t(`config_page.advanced_settings.websocket_token.${name}`);
    const { asyncStdoutToPython } = useStdoutToPython();
    const { showNotification_Success } = useNotificationStatus();
    const [open, setOpen] = useState(false);
    const { dialog, close } = useConsentDialog(open);
    const cancel = () => { close(); setOpen(false); };
    const regenerate = async () => {
        close(); setOpen(false);
        const response = await asyncStdoutToPython("/run/regenerate_websocket_auth_token");
        if (answerOf(response)?.status === 200) showNotification_Success(key("done"), { category_id: "websocket_token_regenerated" });
    };
    return <>
        <ActionButtonContainer
            setting_id="websocket_token"
            label={key("label")}
            desc={key("desc")}
            IconComponent={RefreshSvg}
            onclickFunction={() => setOpen(true)}
        />
        {open && <div className={`${voiceStyles.container} ${dialogStyles.host}`}>
            <dialog ref={dialog} className={dialogStyles.dialog} aria-label={key("confirm_title")}
                onCancel={event => { event.preventDefault(); cancel(); }}>
                <div className={voiceStyles.dialog_text}>
                    <h3>{key("confirm_title")}</h3>
                    <p>{key("confirm_body")}</p>
                </div>
                <div className={voiceStyles.actions}>
                    <button type="button" autoFocus onClick={cancel}>{key("confirm_cancel")}</button>
                    <button type="button" onClick={regenerate}>{key("confirm_ok")}</button>
                </div>
            </dialog>
        </div>}
    </>;
};

const ObsBrowserSourceContainer = () => {
    const { t } = useI18n();

    return (
        <div>
            <SectionLabelComponent label={t("config_page.advanced_settings.obs_browser_source.section_label")} />
            <EnableObsBrowserSourceContainer />
            <ObsBrowserSourceUrlContainer />
            <ObsBrowserSourcePortContainer />
            <ObsBrowserSourceMaxMessagesContainer />
            <ObsBrowserSourceDisplayDurationContainer />
            <ObsBrowserSourceFadeoutDurationContainer />
            <ObsBrowserSourceFontSizeContainer />
            <ObsBrowserSourceFontColorContainer />
            <ObsBrowserSourceFontOutlineThicknessContainer />
            <ObsBrowserSourceFontOutlineColorContainer />
        </div>
    );
};

const EnableObsBrowserSourceContainer = () => {
    const { t } = useI18n();
    const { currentEnableObsBrowserSource, toggleEnableObsBrowserSource } = useAdvancedSettings();

    return (
        <CheckboxContainer
            label={t("config_page.advanced_settings.enable_obs_browser_source.label")}
            desc={t("config_page.advanced_settings.enable_obs_browser_source.desc")}
            variable={currentEnableObsBrowserSource}
            toggleFunction={toggleEnableObsBrowserSource}
        />
    );
};

const ObsBrowserSourceUrlContainer = () => {
    const { t } = useI18n();
    const { copyToClipboard } = useCopyToClipboard();
    const { currentWebsocketHost, currentObsBrowserSourcePort, currentWebsocketAuthToken } = useAdvancedSettings();

    const { url, shown } = buildObsBrowserSourceUrl(
        currentWebsocketHost.data, currentObsBrowserSourcePort.data, currentWebsocketAuthToken.data,
    );

    return (
        <>
            <ActionButtonContainer
                label={t("config_page.advanced_settings.obs_browser_source_url.label")}
                desc={shown}
                IconComponent={CopyThinSvg}
                ClickedIconComponent={CheckMarkSvg}
                clicked_duration={1000}
                onclickFunction={() => copyToClipboard(url)}
            />
            <Description
                text={t("config_page.advanced_settings.obs_browser_source_url.desc")}
                className={styles.obs_url_description}
                fold={false}
            />
        </>
    );
};

const ObsBrowserSourcePortContainer = () => {
    const { t } = useI18n();
    const { currentObsBrowserSourcePort, setObsBrowserSourcePort } = useAdvancedSettings();

    const { variable, onChangeFunction: rawOnChange, saveFunction } = useSaveButtonLogic({
        variable: currentObsBrowserSourcePort.data,
        state: currentObsBrowserSourcePort.state,
        setFunction: (value: unknown) => setObsBrowserSourcePort(parsePortInput(value)),
        label: t("config_page.advanced_settings.obs_browser_source_port.label"),
    });

    const onChangeFunction = (value: string) => {
        if (value === "" || parsePortInput(value) !== null) rawOnChange(value);
    };

    return (
        <EntryWithSaveButtonContainer
            label={t("config_page.advanced_settings.obs_browser_source_port.label")}
            variable={fieldValue(variable)}
            saveFunction={saveFunction}
            onChangeFunction={onChangeFunction}
            state={currentObsBrowserSourcePort.state}
            width="10rem"
            type="number"
            {...PORT_INPUT_LIMITS}
        />
    );
};

const ObsBrowserSourceMaxMessagesContainer = () => {
    const { t } = useI18n();
    const { currentObsBrowserSourceMaxMessages, setObsBrowserSourceMaxMessages } = useAdvancedSettings();

    const { variable, onChangeFunction: rawOnChange, saveFunction } = useSaveButtonLogic({
        variable: currentObsBrowserSourceMaxMessages.data,
        state: currentObsBrowserSourceMaxMessages.state,
        setFunction: setObsBrowserSourceMaxMessages,
        label: t("config_page.advanced_settings.obs_browser_source_max_messages.label"),
    });

    const onChangeFunction = (value: string) => {
        rawOnChange(value);
    };

    return (
        <EntryWithSaveButtonContainer
            label={t("config_page.advanced_settings.obs_browser_source_max_messages.label")}
            desc={t("config_page.advanced_settings.obs_browser_source_max_messages.desc")}
            variable={fieldValue(variable)}
            saveFunction={saveFunction}
            onChangeFunction={onChangeFunction}
            state={currentObsBrowserSourceMaxMessages.state}
            width="10rem"
            type="number"
            min={1} max={50} step={1}
        />
    );
};

const ObsBrowserSourceDisplayDurationContainer = () => {
    const { t } = useI18n();
    const { currentObsBrowserSourceDisplayDuration, setObsBrowserSourceDisplayDuration } = useAdvancedSettings();

    const { variable, onChangeFunction: rawOnChange, saveFunction } = useSaveButtonLogic({
        variable: currentObsBrowserSourceDisplayDuration.data,
        state: currentObsBrowserSourceDisplayDuration.state,
        setFunction: setObsBrowserSourceDisplayDuration,
        label: t("config_page.advanced_settings.obs_browser_source_display_duration.label"),
    });

    const onChangeFunction = (value: string) => {
        rawOnChange(value);
    };

    return (
        <EntryWithSaveButtonContainer
            label={t("config_page.advanced_settings.obs_browser_source_display_duration.label")}
            desc={t("config_page.advanced_settings.obs_browser_source_display_duration.desc")}
            variable={fieldValue(variable)}
            saveFunction={saveFunction}
            onChangeFunction={onChangeFunction}
            state={currentObsBrowserSourceDisplayDuration.state}
            width="10rem"
            type="number"
            min={1} max={120} step={1}
        />
    );
};

const ObsBrowserSourceFadeoutDurationContainer = () => {
    const { t } = useI18n();
    const { currentObsBrowserSourceFadeoutDuration, setObsBrowserSourceFadeoutDuration } = useAdvancedSettings();

    const { variable, onChangeFunction: rawOnChange, saveFunction } = useSaveButtonLogic({
        variable: currentObsBrowserSourceFadeoutDuration.data,
        state: currentObsBrowserSourceFadeoutDuration.state,
        setFunction: setObsBrowserSourceFadeoutDuration,
        label: t("config_page.advanced_settings.obs_browser_source_fadeout_duration.label"),
    });

    const onChangeFunction = (value: string) => {
        rawOnChange(value);
    };

    return (
        <EntryWithSaveButtonContainer
            label={t("config_page.advanced_settings.obs_browser_source_fadeout_duration.label")}
            desc={t("config_page.advanced_settings.obs_browser_source_fadeout_duration.desc")}
            variable={fieldValue(variable)}
            saveFunction={saveFunction}
            onChangeFunction={onChangeFunction}
            state={currentObsBrowserSourceFadeoutDuration.state}
            width="10rem"
            type="number"
            min={0} max={120} step={1}
        />
    );
};

const ObsBrowserSourceFontSizeContainer = () => {
    const { t } = useI18n();
    const { currentObsBrowserSourceFontSize, setObsBrowserSourceFontSize } = useAdvancedSettings();

    const { variable, onChangeFunction: rawOnChange, saveFunction } = useSaveButtonLogic({
        variable: currentObsBrowserSourceFontSize.data,
        state: currentObsBrowserSourceFontSize.state,
        setFunction: setObsBrowserSourceFontSize,
        label: t("config_page.advanced_settings.obs_browser_source_font_size.label"),
    });

    const onChangeFunction = (value: string) => {
        rawOnChange(value);
    };

    return (
        <EntryWithSaveButtonContainer
            label={t("config_page.advanced_settings.obs_browser_source_font_size.label")}
            desc={t("config_page.advanced_settings.obs_browser_source_font_size.desc")}
            variable={fieldValue(variable)}
            saveFunction={saveFunction}
            onChangeFunction={onChangeFunction}
            state={currentObsBrowserSourceFontSize.state}
            width="10rem"
            type="number"
            min={10} max={200} step={1}
        />
    );
};

const ObsBrowserSourceFontColorContainer = () => {
    const { t } = useI18n();
    const { currentObsBrowserSourceFontColor, setObsBrowserSourceFontColor } = useAdvancedSettings();

    const { variable, onChangeFunction, saveFunction } = useSaveButtonLogic({
        variable: currentObsBrowserSourceFontColor.data,
        state: currentObsBrowserSourceFontColor.state,
        setFunction: setObsBrowserSourceFontColor,
        label: t("config_page.advanced_settings.obs_browser_source_font_color.label"),
    });

    return (
        <ColorEntryWithSaveButtonContainer
            label={t("config_page.advanced_settings.obs_browser_source_font_color.label")}
            variable={fieldText(variable)}
            saveFunction={saveFunction}
            onChangeFunction={onChangeFunction}
            state={currentObsBrowserSourceFontColor.state}
            width="10rem"
        />
    );
};

const ObsBrowserSourceFontOutlineThicknessContainer = () => {
    const { t } = useI18n();
    const { currentObsBrowserSourceFontOutlineThickness, setObsBrowserSourceFontOutlineThickness } = useAdvancedSettings();

    const { variable, onChangeFunction: rawOnChange, saveFunction } = useSaveButtonLogic({
        variable: currentObsBrowserSourceFontOutlineThickness.data,
        state: currentObsBrowserSourceFontOutlineThickness.state,
        setFunction: setObsBrowserSourceFontOutlineThickness,
        label: t("config_page.advanced_settings.obs_browser_source_font_outline_thickness.label"),
    });

    const onChangeFunction = (value: string) => {
        rawOnChange(value);
    };

    return (
        <EntryWithSaveButtonContainer
            label={t("config_page.advanced_settings.obs_browser_source_font_outline_thickness.label")}
            desc={t("config_page.advanced_settings.obs_browser_source_font_outline_thickness.desc")}
            variable={fieldValue(variable)}
            saveFunction={saveFunction}
            onChangeFunction={onChangeFunction}
            state={currentObsBrowserSourceFontOutlineThickness.state}
            width="10rem"
            type="number"
            min={0} max={20} step={1}
        />
    );
};

const ObsBrowserSourceFontOutlineColorContainer = () => {
    const { t } = useI18n();
    const { currentObsBrowserSourceFontOutlineColor, setObsBrowserSourceFontOutlineColor } = useAdvancedSettings();

    const { variable, onChangeFunction, saveFunction } = useSaveButtonLogic({
        variable: currentObsBrowserSourceFontOutlineColor.data,
        state: currentObsBrowserSourceFontOutlineColor.state,
        setFunction: setObsBrowserSourceFontOutlineColor,
        label: t("config_page.advanced_settings.obs_browser_source_font_outline_color.label"),
    });

    return (
        <ColorEntryWithSaveButtonContainer
            label={t("config_page.advanced_settings.obs_browser_source_font_outline_color.label")}
            variable={fieldText(variable)}
            saveFunction={saveFunction}
            onChangeFunction={onChangeFunction}
            state={currentObsBrowserSourceFontOutlineColor.state}
            width="10rem"
        />
    );
};
