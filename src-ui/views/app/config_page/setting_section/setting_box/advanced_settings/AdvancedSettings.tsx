import { useId, useMemo, useRef, useState } from "react";
import type { FocusEvent, KeyboardEvent } from "react";
import { useI18n } from "@useI18n";
import { useStdoutToPython } from "@useStdoutToPython";
import * as styles from "./AdvancedSettings.css.ts";
import * as voiceStyles from "./VoiceSettings.css.ts";
import * as dialogStyles from "../_components/download_models/LegacyModelDownloadDialog.css.ts";
import { AutoExportMessageLogsContainer } from "../shared_items/SharedItems";
import { Description } from "../_components/description/Description";
import { HintDescriptions } from "../_components/hint/Hint";
import { TelemetryContents } from "../_components/telemetry/TelemetryContents";
import { GpuCheck } from "./GpuCheck.tsx";
import { parsePortInput, PORT_INPUT_LIMITS } from "../../../../../../logics/configs/networkPortInput";
import { rvcBlockChoiceId, rvcBlockChoices } from "../../../../../../logics/configs/rvcBlockChoices";
import type { DropdownSelection } from "../_components/_atoms/_dropdown_menu/_DropdownMenu";
import { buildObsBrowserSourceUrl, buildWebsocketUrl } from "../../../../../../logics/configs/obsBrowserSourceUrl";
import { logDirectoryErrorKey, pickLogDirectory, validateLogDirectoryInput } from "../../../../../../logics/configs/logDestination";
import { useSettingsDraft } from "../../../../../../logics/voice/useSettingsDraft";
import { awaitInlineAnswer, refusalKeys, settleInlineAnswer } from "../../../../../../logics/configs/fieldErrors.ts";
import { hexColorProblem, oscAddressProblem, tlsPairProblem, websocketHostProblem, wholeNumberProblem } from "../../../../../../logics/configs/fieldChecks.ts";
import { useConsentDialog } from "../../../../../../logics/common/useConsentDialog";
import { shownTelemetry, telemetryUnanswered, toggleTelemetryOrAnswer } from "../../../../../../logics/configs/telemetryToggle";
import type { DraftWriteValue } from "../../../../../../logics/voice/useSettingsDraft";
import type { StdoutResult } from "@useStdoutToPython";
import type { TargetHolder } from "../../../../../../logics/common/targetHolder.ts";

import { useCopyToClipboard, useOpenFolder, useNotificationStatus } from "@logics_common";
import {
    useAdvancedSettings,
    useOthers,
    useSaveButtonLogic,
} from "@logics_configs";

import {
    CheckboxContainer,
    ActionButtonContainer,
    DropdownMenuContainer,
    EntryWithSaveButtonContainer,
    ColorEntryWithSaveButtonContainer,
} from "../_templates/Templates";

import {
    ActionButton,
    LabelComponent,
    SectionLabelComponent,
} from "../_components";
import { _Entry } from "../_components/_atoms/_entry/_Entry";

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
const TLS_ENDPOINT = "/set/data/websocket_tls";
const answerOf = (response: StdoutResult | undefined) => typeof response === "object" && response !== null ? response : null;
// The error code in a refused answer's result, if it names one.
const errorCodeOf = (result: unknown): string | undefined =>
    isRecord(result) && typeof result.error_code === "string" ? result.error_code : undefined;

// The two paths of the TLS pair.
type TlsField = "cert_file" | "key_file";
type TlsPaths = Readonly<Record<TlsField, string>>;

// The rows' general descriptions are hints here (#614, DESIGN.md "Principles"). What is read
// before acting stays on screen: the URLs in use, what the usage data sends and the warnings.
export const AdvancedSettings = () => {
    const { t } = useI18n();

    return (
        <HintDescriptions>
        <div className={styles.container}>
            <div>
                <SectionLabelComponent label={t("config_page.advanced_settings.section_label_logs")} />
                <AutoExportMessageLogsContainer />
                <LogDestinationContainer />
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
                {/* What the check is for, how it measures, what its result holds and what to know
                    before pressing are the heading's hint (#614, #1013). */}
                <SectionLabelComponent label={t("config_page.advanced_settings.section_label_gpu_check")}
                    desc={["desc", "what", "privacy", "before"].map(name => t(`config_page.advanced_settings.gpu_check.${name}`)).join("\n")} />
                <GpuCheck />
            </div>
            {/* Where messages go to VRChat: set once, if ever, like the other connections below.
                The VRChat page says whether VRChat is found and leads here (#554, Q-06). */}
            <div>
                {/* That the destination is VRChat's default and is usually left alone: the heading's hint,
                    in the words the VRChat page uses where it leads here. */}
                <SectionLabelComponent label={t("config_page.advanced_settings.section_label_osc")}
                    desc={t("config_page.vrchat.osc_pointer.desc")} />
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
        </HintDescriptions>
    );
};

// The block an RVC conversion cuts the microphone into (#531): Automatic, the default, or a
// length the user chose, which then wins. Chosen from a list, so only lengths the backend
// accepts are sent; the next Start reads it.
export const RvcBlockMsContainer = () => {
    const { t } = useI18n();
    const { currentRvcBlockMs, setRvcBlockMs } = useAdvancedSettings();
    const key = (name: string) => `config_page.advanced_settings.rvc_block_ms.${name}`;

    return (
        <DropdownMenuContainer
            setting_id="rvc_block_ms"
            dropdown_id="rvc_block_ms"
            label={t(key("label"))}
            desc={t(key("desc"))}
            selected_id={rvcBlockChoiceId(currentRvcBlockMs.data)}
            list={rvcBlockChoices(t(key("automatic")), ms => t(key("length"), { ms }))}
            selectFunction={(selection: DropdownSelection) => setRvcBlockMs(Number(selection.selected_id))}
            state={currentRvcBlockMs.state}
        />
    );
};

export const OscIpAddressContainer = () => {
    const { t } = useI18n();
    const { currentOscIpAddress, setOscIpAddress } = useAdvancedSettings();

    const { variable, onChangeFunction, saveFunction, leaveFunction, revert, error } = useSaveButtonLogic({
        variable: currentOscIpAddress.data,
        state: currentOscIpAddress.state,
        setFunction: setOscIpAddress,
        endpoint: "/set/data/osc_ip_address",
        validate: value => { const key = oscAddressProblem(value); return key ? t(key) : null; },
    });

    return (
        <EntryWithSaveButtonContainer
            label={t("config_page.advanced_settings.osc_ip_address.label")}
            variable={fieldValue(variable)}
            saveFunction={saveFunction}
            leaveFunction={leaveFunction}
            onRevert={revert}
            error={error}
            onChangeFunction={onChangeFunction}
            state={currentOscIpAddress.state}
            width="14rem"
        />
    );
};

export const OscPortContainer = () => {
    const { t } = useI18n();
    const { currentOscPort, setOscPort } = useAdvancedSettings();

    const { variable, onChangeFunction: rawOnChange, saveFunction, leaveFunction, revert, error } = useSaveButtonLogic({
        variable: currentOscPort.data,
        state: currentOscPort.state,
        setFunction: (value: unknown) => setOscPort(parsePortInput(value)),
        endpoint: "/set/data/osc_port",
        validate: value => { const key = wholeNumberProblem(1, 65535, "backend_errors.VALIDATION_OSC_PORT_INVALID")(value); return key ? t(key) : null; },
    });

    const onChangeFunction = (value: string) => {
        if (value === "" || parsePortInput(value) !== null) rawOnChange(value);
    };

    return (
        <EntryWithSaveButtonContainer
            label={t("config_page.advanced_settings.osc_port.label")}
            variable={fieldValue(variable)}
            saveFunction={saveFunction}
            leaveFunction={leaveFunction}
            onRevert={revert}
            error={error}
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

// Conversation log folder (#1096, #1115, #1118): editable path, native folder picker, reset to
// default, and open-folder action. Auto-saves on Enter, blur, folder pick, and reset (#1111);
// invalid paths are never saved and show an inline validation message explaining what is wrong
// and what value is acceptable.
export const LogDestinationContainer = () => {
    const { t } = useI18n();
    const { currentPathLogs, setPathLogs } = useAdvancedSettings();
    const { openFolder_MessageLogs } = useOpenFolder();
    const labelId = useId();
    const errorId = useId();

    const savedPath = typeof currentPathLogs.data?.path === "string" ? currentPathLogs.data.path : "";
    const backendError = typeof currentPathLogs.data?.error_code === "string" ? currentPathLogs.data.error_code : null;
    const [edited, setEdited] = useState<string | null>(null);
    const [localError, setLocalError] = useState<string | null>(null);
    const [picking, setPicking] = useState(false);

    const busy = currentPathLogs.state === "pending" || picking;
    const shownPath = edited ?? savedPath;
    const activeError = localError ?? (edited === null ? backendError : null);
    const label = t("config_page.others.auto_export_message_logs.destination_label");

    const submitPath = async (nextPath: string) => {
        const response = await setPathLogs(nextPath);
        const reply = answerOf(response);
        if (reply?.status === 200) {
            setEdited(null);
            setLocalError(null);
            return;
        }
        setEdited(nextPath);
        setLocalError(errorCodeOf(reply?.result) ?? "log_directory_invalid");
    };

    const commitEdited = async (draft: string | null) => {
        if (draft === null || busy) return;
        const trimmed = draft.trim();
        if (trimmed === savedPath && trimmed !== "") {
            setEdited(null);
            setLocalError(null);
            return;
        }
        const checked = validateLogDirectoryInput(draft);
        if (!checked.ok) {
            setLocalError(checked.error_code);
            return;
        }
        await submitPath(checked.path);
    };

    const chooseFolder = async () => {
        if (busy) return;
        setLocalError(null);
        setPicking(true);
        try {
            const picked = await pickLogDirectory(
                savedPath || null,
                t("config_page.others.auto_export_message_logs.choose_folder"),
            );
            if (!picked.ok) {
                setLocalError(picked.error_code);
                return;
            }
            if (picked.path !== null) {
                await submitPath(picked.path);
            }
        } finally {
            setPicking(false);
        }
    };

    const resetFolder = async () => {
        if (busy) return;
        const response = await setPathLogs(null);
        const reply = answerOf(response);
        if (reply?.status === 200) {
            setEdited(null);
            setLocalError(null);
            return;
        }
        setLocalError(errorCodeOf(reply?.result) ?? "log_directory_invalid");
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Escape") {
            setEdited(null);
            setLocalError(null);
        }
    };

    const handleBlur = (event: FocusEvent<HTMLInputElement>) => {
        const next = event.relatedTarget as HTMLElement | null;
        if (next?.dataset?.skipBlurCommit === "true") return;
        return commitEdited(edited);
    };

    return (
        <div
            className={styles.log_destination_row}
            data-setting-id="message_logs_destination"
            data-setting-label={label}
            data-hint-row
        >
            <LabelComponent label={label} label_id={labelId} />
            <div className={styles.log_destination_control} data-invalid={activeError ? "true" : undefined}>
                <_Entry
                    label={label}
                    aria-labelledby={labelId}
                    aria-invalid={activeError ? true : undefined}
                    aria-describedby={activeError ? errorId : undefined}
                    ui_variable={shownPath}
                    readOnly={busy}
                    aria-busy={busy}
                    aria-disabled={busy}
                    onChange={event => {
                        setEdited(event.target.value);
                        if (localError) setLocalError(null);
                    }}
                    onEnterPressed={() => commitEdited(edited)}
                    onKeyDown={handleKeyDown}
                    onBlur={handleBlur}
                />
                <div className={styles.log_destination_actions}>
                    <button
                        type="button"
                        className={styles.log_destination_button}
                        data-skip-blur-commit="true"
                        disabled={busy}
                        onClick={() => chooseFolder()}
                    >
                        {t("config_page.others.auto_export_message_logs.choose_folder")}
                    </button>
                    <button
                        type="button"
                        className={styles.log_destination_button}
                        data-skip-blur-commit="true"
                        disabled={busy}
                        onClick={() => resetFolder()}
                    >
                        {t("config_page.others.auto_export_message_logs.reset_folder")}
                    </button>
                    <ActionButton
                        label={label}
                        action_label={t("config_page.others.auto_export_message_logs.open_folder")}
                        IconComponent={OpenFolderSvg}
                        ClickedIconComponent={CheckMarkSvg}
                        clicked_duration={1000}
                        onclickFunction={openFolder_MessageLogs}
                    />
                </div>
                {activeError && (
                    <p id={errorId} role="alert" className={styles.log_destination_error}>
                        {t(logDirectoryErrorKey(activeError))}
                    </p>
                )}
            </div>
        </div>
    );
};

// Read-only config file path (#1096, #1115, #1118) with open-folder action.
export const OpenConfigFolderContainer = () => {
    const { t } = useI18n();
    const { currentPathConfig } = useAdvancedSettings();
    const { openFolder_ConfigFile } = useOpenFolder();
    const configPath = typeof currentPathConfig.data === "string" && currentPathConfig.data ? currentPathConfig.data : undefined;

    return (
        <ActionButtonContainer
            setting_id="config_file_destination"
            label={t("config_page.advanced_settings.open_config_filepath.label")}
            desc={configPath}
            keep_desc={Boolean(configPath)}
            action_label={t("config_page.advanced_settings.open_config_filepath.open_folder")}
            IconComponent={OpenFolderSvg}
            ClickedIconComponent={CheckMarkSvg}
            clicked_duration={1000}
            onclickFunction={openFolder_ConfigFile}
        />
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
                // What leaves the PC is read before the box is ticked: one sentence stays on screen,
                // and what goes with it and what is never sent are the label's hint.
                lead={t("config_page.advanced_settings.telemetry.lead")}
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

    const { variable, onChangeFunction, saveFunction, leaveFunction, revert, error } = useSaveButtonLogic({
        variable: currentWebsocketHost.data,
        state: currentWebsocketHost.state,
        setFunction: setWebsocketHost,
        endpoint: "/set/data/websocket_host",
        validate: value => { const key = websocketHostProblem(value); return key ? t(key) : null; },
    });

    return (
        <EntryWithSaveButtonContainer
            label={t("config_page.advanced_settings.websocket_host.label")}
            desc={t("config_page.advanced_settings.websocket_host.desc")}
            variable={fieldValue(variable)}
            saveFunction={saveFunction}
            leaveFunction={leaveFunction}
            onRevert={revert}
            error={error}
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
    // What is wrong with the pair, said under it (#1111): a refused check, or the core's refusal.
    const [problem, setProblem] = useState<string | null>(null);
    const saved = useMemo<TlsPaths>(() => ({
        cert_file: currentWebsocketTls.data?.cert_file ?? "", key_file: currentWebsocketTls.data?.key_file ?? "",
    }), [currentWebsocketTls.data]);
    const label = (name: string) => t(`config_page.advanced_settings.websocket_tls_${name}.label`);
    const write = async (value: DraftWriteValue<TlsPaths>) => {
        // The refusal of this save is said under the pair, not as a notice too (fieldErrors.ts).
        awaitInlineAnswer(TLS_ENDPOINT);
        const response = await setWebsocketTls(value);
        const answer = answerOf(response);
        if (!(answer?.status && answer.status !== 200)) settleInlineAnswer(TLS_ENDPOINT);
        if (answer?.status !== 200) {
            const code = errorCodeOf(answer?.result);
            updateError(code || "save_unconfirmed");
            setProblem(code ? t(refusalKeys(code)) : t("config_page.auto_save.save_failed"));
        }
        return response;
    };
    // Saves by itself as a pair (#1111, decided 3): when focus leaves both fields, or on Enter,
    // once both paths are given or both are empty. The core takes the two only together.
    const form = useSettingsDraft(saved, error, updateError, { });
    // The pair's rows, to tell focus moving between the two from focus leaving the pair.
    const group = useRef<TargetHolder>(null);
    const draft = form.draft;
    if (!draft) return null;
    const commit = () => {
        if (!form.dirty || form.saving) return;
        const refused = tlsPairProblem(draft.cert_file, draft.key_file);
        setProblem(refused ? t(refused) : null);
        if (!refused) return form.submit(write);
    };
    const field = (name: TlsField) => ({
        setting_id: `websocket_tls_${name}`,
        label: label(name),
        desc: t(`config_page.advanced_settings.websocket_tls_${name}.desc`),
        variable: draft[name],
        state: form.saving || currentWebsocketTls.state === "pending" ? "pending" : "ok",
        onChangeFunction: (value: string) => {
            setProblem(null);
            form.setDraft(previous => previous && ({ ...previous, [name]: value }));
        },
        saveFunction: commit,
        // Leaving one field for the other saves nothing yet: the group saves when focus leaves it.
        leaveFunction: (event?: FocusEvent<HTMLInputElement>) => {
            if (event?.relatedTarget && group.current?.contains(event.relatedTarget)) return;
            return commit();
        },
        onRevert: () => { form.discard(); setProblem(null); },
    });
    return <div className={styles.field_group} ref={element => { group.current = element; }}>
        <EntryWithSaveButtonContainer {...field("cert_file")} remove_border_bottom={true} />
        {/* The pair's problem is said once, under the pair. */}
        <EntryWithSaveButtonContainer {...field("key_file")} error={problem} />
    </div>;
};


const WebsocketPortContainer = () => {
    const { t } = useI18n();
    const { currentWebsocketPort, setWebsocketPort } = useAdvancedSettings();

    const { variable, onChangeFunction: rawOnChange, saveFunction, leaveFunction, revert, error } = useSaveButtonLogic({
        variable: currentWebsocketPort.data,
        state: currentWebsocketPort.state,
        setFunction: (value: unknown) => setWebsocketPort(parsePortInput(value)),
        endpoint: "/set/data/websocket_port",
        validate: value => { const key = wholeNumberProblem(1, 65535, "backend_errors.WEBSOCKET_PORT_INVALID")(value); return key ? t(key) : null; },
    });

    const onChangeFunction = (value: string) => {
        if (value === "" || parsePortInput(value) !== null) rawOnChange(value);
    };

    return (
        <EntryWithSaveButtonContainer
            label={t("config_page.advanced_settings.websocket_port.label")}
            variable={fieldValue(variable)}
            saveFunction={saveFunction}
            leaveFunction={leaveFunction}
            onRevert={revert}
            error={error}
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
            // The address in use, not a description: it stays on screen.
            desc={shown}
            keep_desc
            // The label names the address; the button says what pressing does.
            action_label={t("config_page.advanced_settings.websocket_url.copy")}
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
    const { currentWebsocketHost, currentObsBrowserSourcePort, currentWebsocketAuthToken, currentEnableObsBrowserSource } = useAdvancedSettings();

    const { url, shown } = buildObsBrowserSourceUrl(
        currentWebsocketHost.data, currentObsBrowserSourcePort.data, currentWebsocketAuthToken.data,
    );

    return (
        <>
            <ActionButtonContainer
                label={t("config_page.advanced_settings.obs_browser_source_url.label")}
                // The address in use, not a description: it stays on screen.
                desc={shown}
                keep_desc
                action_label={t("config_page.advanced_settings.obs_browser_source_url.copy")}
                IconComponent={CopyThinSvg}
                ClickedIconComponent={CheckMarkSvg}
                clicked_duration={1000}
                onclickFunction={() => copyToClipboard(url)}
            />
            {/* The address changed for those who use the source: said only while it is on. */}
            {currentEnableObsBrowserSource.data === true && <Description
                text={t("config_page.advanced_settings.obs_browser_source_url.desc")}
                className={styles.obs_url_description}
                fold={false}
            />}
        </>
    );
};

const ObsBrowserSourcePortContainer = () => {
    const { t } = useI18n();
    const { currentObsBrowserSourcePort, setObsBrowserSourcePort } = useAdvancedSettings();

    const { variable, onChangeFunction: rawOnChange, saveFunction, leaveFunction, revert, error } = useSaveButtonLogic({
        variable: currentObsBrowserSourcePort.data,
        state: currentObsBrowserSourcePort.state,
        setFunction: (value: unknown) => setObsBrowserSourcePort(parsePortInput(value)),
        endpoint: "/set/data/obs_browser_source_port",
        validate: value => { const key = wholeNumberProblem(1, 65535, "backend_errors.OBS_BROWSER_SOURCE_PORT_INVALID")(value); return key ? t(key) : null; },
    });

    const onChangeFunction = (value: string) => {
        if (value === "" || parsePortInput(value) !== null) rawOnChange(value);
    };

    return (
        <EntryWithSaveButtonContainer
            label={t("config_page.advanced_settings.obs_browser_source_port.label")}
            variable={fieldValue(variable)}
            saveFunction={saveFunction}
            leaveFunction={leaveFunction}
            onRevert={revert}
            error={error}
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

    const { variable, onChangeFunction: rawOnChange, saveFunction, leaveFunction, revert, error } = useSaveButtonLogic({
        variable: currentObsBrowserSourceMaxMessages.data,
        state: currentObsBrowserSourceMaxMessages.state,
        setFunction: setObsBrowserSourceMaxMessages,
        endpoint: "/set/data/obs_browser_source_max_messages",
        validate: value => { const key = wholeNumberProblem(1, 50, "backend_errors.OBS_BROWSER_SOURCE_MAX_MESSAGES_INVALID")(value); return key ? t(key) : null; },
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
            leaveFunction={leaveFunction}
            onRevert={revert}
            error={error}
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

    const { variable, onChangeFunction: rawOnChange, saveFunction, leaveFunction, revert, error } = useSaveButtonLogic({
        variable: currentObsBrowserSourceDisplayDuration.data,
        state: currentObsBrowserSourceDisplayDuration.state,
        setFunction: setObsBrowserSourceDisplayDuration,
        endpoint: "/set/data/obs_browser_source_display_duration",
        validate: value => { const key = wholeNumberProblem(1, 120, "backend_errors.OBS_BROWSER_SOURCE_DISPLAY_DURATION_INVALID")(value); return key ? t(key) : null; },
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
            leaveFunction={leaveFunction}
            onRevert={revert}
            error={error}
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

    const { variable, onChangeFunction: rawOnChange, saveFunction, leaveFunction, revert, error } = useSaveButtonLogic({
        variable: currentObsBrowserSourceFadeoutDuration.data,
        state: currentObsBrowserSourceFadeoutDuration.state,
        setFunction: setObsBrowserSourceFadeoutDuration,
        endpoint: "/set/data/obs_browser_source_fadeout_duration",
        validate: value => { const key = wholeNumberProblem(0, 120, "backend_errors.OBS_BROWSER_SOURCE_FADEOUT_DURATION_INVALID")(value); return key ? t(key) : null; },
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
            leaveFunction={leaveFunction}
            onRevert={revert}
            error={error}
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

    const { variable, onChangeFunction: rawOnChange, saveFunction, leaveFunction, revert, error } = useSaveButtonLogic({
        variable: currentObsBrowserSourceFontSize.data,
        state: currentObsBrowserSourceFontSize.state,
        setFunction: setObsBrowserSourceFontSize,
        endpoint: "/set/data/obs_browser_source_font_size",
        validate: value => { const key = wholeNumberProblem(10, 200, "backend_errors.OBS_BROWSER_SOURCE_FONT_SIZE_INVALID")(value); return key ? t(key) : null; },
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
            leaveFunction={leaveFunction}
            onRevert={revert}
            error={error}
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

    const { variable, onChangeFunction, saveFunction, revert, error } = useSaveButtonLogic({
        variable: currentObsBrowserSourceFontColor.data,
        state: currentObsBrowserSourceFontColor.state,
        setFunction: setObsBrowserSourceFontColor,
        endpoint: "/set/data/obs_browser_source_font_color",
        validate: value => { const key = hexColorProblem("backend_errors.OBS_BROWSER_SOURCE_FONT_COLOR_INVALID")(value); return key ? t(key) : null; },
    });

    return (
        <ColorEntryWithSaveButtonContainer
            label={t("config_page.advanced_settings.obs_browser_source_font_color.label")}
            variable={fieldText(variable)}
            saveFunction={saveFunction}
            onRevert={revert}
            error={error}
            onChangeFunction={onChangeFunction}
            state={currentObsBrowserSourceFontColor.state}
            width="10rem"
        />
    );
};

const ObsBrowserSourceFontOutlineThicknessContainer = () => {
    const { t } = useI18n();
    const { currentObsBrowserSourceFontOutlineThickness, setObsBrowserSourceFontOutlineThickness } = useAdvancedSettings();

    const { variable, onChangeFunction: rawOnChange, saveFunction, leaveFunction, revert, error } = useSaveButtonLogic({
        variable: currentObsBrowserSourceFontOutlineThickness.data,
        state: currentObsBrowserSourceFontOutlineThickness.state,
        setFunction: setObsBrowserSourceFontOutlineThickness,
        endpoint: "/set/data/obs_browser_source_font_outline_thickness",
        validate: value => { const key = wholeNumberProblem(0, 20, "backend_errors.OBS_BROWSER_SOURCE_FONT_OUTLINE_THICKNESS_INVALID")(value); return key ? t(key) : null; },
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
            leaveFunction={leaveFunction}
            onRevert={revert}
            error={error}
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

    const { variable, onChangeFunction, saveFunction, revert, error } = useSaveButtonLogic({
        variable: currentObsBrowserSourceFontOutlineColor.data,
        state: currentObsBrowserSourceFontOutlineColor.state,
        setFunction: setObsBrowserSourceFontOutlineColor,
        endpoint: "/set/data/obs_browser_source_font_outline_color",
        validate: value => { const key = hexColorProblem("backend_errors.OBS_BROWSER_SOURCE_FONT_OUTLINE_COLOR_INVALID")(value); return key ? t(key) : null; },
    });

    return (
        <ColorEntryWithSaveButtonContainer
            label={t("config_page.advanced_settings.obs_browser_source_font_outline_color.label")}
            variable={fieldText(variable)}
            saveFunction={saveFunction}
            onRevert={revert}
            error={error}
            onChangeFunction={onChangeFunction}
            state={currentObsBrowserSourceFontOutlineColor.state}
            width="10rem"
        />
    );
};
