import { useEffect } from "react";
import { useVoice, sourceKey } from "../../../../../logics/voice/useVoice";
import { directRouteReady, usesOutputDevice } from "../../../../../logics/voice/routeState";
import { rvcStartOptions } from "../../../../../logics/voice/rvcStartOptions";
import { useNotificationStatus } from "../../../../../logics/common/useNotificationStatus";
import { voiceActions, voiceSwitchStates } from "../../../../../logics/voice/voiceActions.ts";
import { splitFeatureLabel } from "../../../../../logics/common/featureLabel.ts";
import { voiceErrorText } from "../../../../../logics/voice/voiceErrorText.ts";
import { useSwitchBlocks } from "../../../../../logics/main/useSwitchBlocks";
import { activeSwitchBlock } from "../../../../../logics/main/switchBlocks";
import { useI18n } from "@useI18n";
import { useIsBackendReady } from "@logics_common";
import { useIsStartingUp } from "../../startupContext";
import { store } from "@store";
import clsx from "clsx";
import styles from "./MainFunctionSwitch.module.scss";
import TranslationSvg from "@images/translation.svg?react";
import MicSvg from "@images/mic.svg?react";
import HeadphonesSvg from "@images/headphones.svg?react";
import ChatTranscribeSvg from "@images/chat_transcribe.svg?react";
import TtsSpeakerSvg from "@images/tts_speaker.svg?react";
import VoiceConversionSvg from "@images/voice_conversion.svg?react";
import {
    useIsMainPageCompactMode,
    useMainFunction,
} from "@logics_main";
import { ToggleSwitch } from "../../../../common_components/toggle_switch/ToggleSwitch";

export const MainFunctionSwitch = () => {
    const { t, i18n } = useI18n();
    const { currentIsBackendReady } = useIsBackendReady();
    // While starting, the switches have no state yet: placeholders, not "disconnected".
    const starting = useIsStartingUp();

    const {
        toggleTranslation, currentTranslationStatus,
        toggleTranscriptionSend, currentTranscriptionSendStatus,
        toggleTranscriptionReceive, currentTranscriptionReceiveStatus,
        toggleOcrCapture, currentOcrCaptureStatus,
    } = useMainFunction();


    const voice = useVoice();
    const { blocks, prepare } = useSwitchBlocks();
    const { showNotification_Error } = useNotificationStatus();
    // Known codes get their next step; the code stays visible for support.
    const notify = (code, page) => {
        // After the engine stops, its own notice already says so.
        if (code === "backend_unavailable" && !store.backend_subprocess) return;
        showNotification_Error(voiceErrorText(code, page, t, key => i18n.exists(key)));
    };
    const ttsName = t("main_page.tts"), rvcName = t("main_page.rvc");
    useEffect(() => { if (voice.ttsError) notify(voice.ttsError, ttsName); }, [voice.ttsError]);
    useEffect(() => { if (voice.directError) notify(voice.directError, rvcName); }, [voice.directError]);
    const rvcOwnsInput = voice.directOwner === "rvc";
    useEffect(() => {
        if (rvcOwnsInput && voice.directState.error) notify(voice.directState.error, rvcName);
    }, [rvcOwnsInput, voice.directState.error]);
    const toggleTts = () => {
        if (!store.backend_subprocess || store.backend_stopped) return;
        if (voice.ttsPending?.intent === false) return;
        if (voice.status.tts_enabled || voice.ttsPending?.intent) return voice.send("/run/disable_tts");
        if (!Number.isSafeInteger(voice.status.tts_generation)) return notify(t("voice_ui.state_unknown"), ttsName);
        voice.send("/run/enable_tts", { generation: voice.status.tts_generation });
    };
    const toggleRvc = () => {
        if (!store.backend_subprocess || store.backend_stopped) return;
        if (rvcOwnsInput && voice.directPending?.intent === false) return;
        if (rvcOwnsInput && (voice.directState.requested || voice.directState.pending || voice.directPending?.intent))
            return voice.send("/run/stop_direct_voice");
        if (voice.directPending || voice.directState.requested || voice.directState.pending || voice.directState.stopping)
            return notify(t("voice_ui.input_conflict"), rvcName);
        if (voice.directDraftBlocked) return notify(t("voice_ui.save_direct_first"), rvcName);
        const cfg = voice.directState.settings;
        const source = voice.directSources.sources?.find(item => sourceKey(item.id) === voice.selectedSource);
        if (!directRouteReady(voice.settings, voice.directState) || !voice.directState.observation_id ||
            voice.directSources.error || !source || cfg?.mode !== "converted" || cfg?.engine !== "rvc" ||
            !cfg.rvc_runtime || !cfg.rvc_model)
            return notify(t(usesOutputDevice(voice.directState) ? "voice_ui.rvc_not_ready_device" : "voice_ui.rvc_not_ready"), rvcName);
        voice.send("/run/start_direct_voice", { source: source.id, mode: "converted", options: rvcStartOptions(cfg) });
    };
    // Hotkeys press the same switches, with today's state (logics/voice/voiceActions.js).
    useEffect(() => { voiceActions.toggleTts = toggleTts; voiceActions.toggleRvc = toggleRvc; });
    const switch_items = [
        {
            switch_id: "translation",
            label: t("main_page.translation"),
            SvgComponent: TranslationSvg,
            currentState: currentTranslationStatus,
            toggleFunction: toggleTranslation,
        },
        {
            switch_id: "transcription_send",
            label: t("main_page.transcription_send"),
            SvgComponent: MicSvg,
            currentState: currentTranscriptionSendStatus,
            toggleFunction: toggleTranscriptionSend,
        },
        {
            switch_id: "transcription_receive",
            label: t("main_page.transcription_receive"),
            SvgComponent: HeadphonesSvg,
            currentState: currentTranscriptionReceiveStatus,
            toggleFunction: toggleTranscriptionReceive,
        },
        {
            switch_id: "ocr",
            label: t("main_page.ocr"),
            SvgComponent: ChatTranscribeSvg,
            currentState: currentOcrCaptureStatus,
            toggleFunction: toggleOcrCapture,
        },
        { switch_id: "tts", label: ttsName, SvgComponent: TtsSpeakerSvg, toggleFunction: toggleTts, cancellable: true, disabled: !Number.isSafeInteger(voice.status.tts_generation),
          statusText: voice.ttsPending?.intent && voice.status.tts_server_starting === true ? t("voice_ui.tts_server_starting") : null,
          currentState: { data: voice.status.tts_enabled === true, state: voice.ttsPending || voice.status.tts_stopping ? "pending" : "ok" } },
        { switch_id: "rvc", label: rvcName, SvgComponent: VoiceConversionSvg, toggleFunction: toggleRvc, cancellable: true, disabled: !voice.directState.observation_id,
          currentState: { data: rvcOwnsInput && !!voice.directState.requested,
            state: rvcOwnsInput && (voice.directPending || voice.directState.pending || voice.directState.stopping) ? "pending" : "ok" } },
    ];
    // Other views of these switches (the tray companion) read the TTS and voice changer state here.
    const switchState = id => { const value = switch_items.find(item => item.switch_id === id)?.currentState;
        return { on: value?.data === true, pending: value?.state === "pending" }; };
    useEffect(() => { voiceSwitchStates.publish({ tts: switchState("tts"), rvc: switchState("rvc") }); });

    return (
        <div className={styles.container}>
            {switch_items.map(item => {
                // Only a switch that is off and waits for nothing is held off (activeSwitchBlock).
                const ready = currentIsBackendReady.data === true;
                const block = ready ? activeSwitchBlock(blocks, item.switch_id, item.currentState) : undefined;
                const blockedReason = block ? t(`main_page.switch_blocked.${block.reason}`) : null;
                // The icon leads to the place the switch needs now, otherwise to its settings.
                const destination = block?.action ?? SETTINGS_DESTINATION[item.switch_id];
                return <SwitchRow
                    key={item.switch_id}
                    switch_id={item.switch_id}
                    cancellable={item.cancellable}
                    disabled={item.disabled}
                    unavailable={!ready}
                    starting={starting}
                    blockedReason={blockedReason}
                    switchLabel={item.label}
                    currentState={item.currentState}
                    statusText={ready ? item.statusText : starting ? null : t("main_page.backend_disconnected")}
                    toggleFunction={item.toggleFunction}
                    SvgComponent={item.SvgComponent}
                    settingsLabel={settingsLabel(destination, t)}
                    openSettings={() => prepare(destination)}
                />;
            })}
        </div>
    );
};

// Where each feature's icon leads when nothing is missing: the translator list for translation,
// the feature's settings page for the others. A missing setup sends the icon to the place that
// provides it instead (switchBlocks.ts).
export const SETTINGS_DESTINATION = {
    translation: "translator",
    transcription_send: "transcription",
    transcription_receive: "transcription",
    ocr: "ocr",
    tts: "tts",
    rvc: "rvc",
};

// The icon button's name and tooltip: what pressing it does.
export const settingsLabel = (destination, t) => {
    if (destination === "translator") return t("main_page.feature_settings.translator");
    if (destination === "translation") return t("main_page.feature_settings.translation_model");
    const page = destination === "ocr_models" ? "ocr" : destination;
    return t("main_page.feature_settings.open_page", { page: t(`config_page.side_menu_labels.${page}`) });
};

// One row of the wide rail: the feature's icon is a button that opens its settings, the rest
// of the row is the switch. The two are siblings because a switch cannot hold a button (its
// children are not read out). The icon button is the same size in every state, so nothing
// moves when the engine's state arrives. The icon rail has no room for two targets: there the
// icon stays part of the switch and the settings open from the gear at the rail's foot.
export const SwitchRow = ({ settingsLabel: label, openSettings, ...props }) => {
    const { currentIsMainPageCompactMode } = useIsMainPageCompactMode();
    if (currentIsMainPageCompactMode.data) return <SwitchContainer {...props} />;
    const { SvgComponent, currentState, unavailable } = props;
    const active = !unavailable && currentState.data === true;
    const pending = !unavailable && currentState.state === "pending";
    return (
        <div className={clsx(styles.switch_row, {
            [styles.is_active]: active,
            [styles.is_unavailable]: unavailable || !!props.blockedReason,
        })}>
            <button type="button" className={styles.settings_button} data-feature-settings={props.switch_id}
                aria-label={label} title={label} onClick={openSettings}>
                <SvgComponent aria-hidden="true" className={clsx(styles.switch_svg, {
                    [styles.is_active]: active, [styles.is_pending]: pending })} />
            </button>
            <SwitchContainer {...props} inRow />
        </div>
    );
};

// blockedReason: why the switch cannot be turned on yet and where to provide it. The switch is
// then disabled and says so in its tooltip and to screen readers; it keeps its place in the
// tab order so that the reason can be heard.
// starting: the engine has not sent the switch's state yet; the toggle is a placeholder.
// inRow: the icon is drawn by SwitchRow as its own button; the row draws the background.
export const SwitchContainer = ({ switchLabel, switch_id, children, currentState, toggleFunction, SvgComponent, cancellable = false, disabled = false, unavailable = false, starting = false, statusText = null, blockedReason = null, inRow = false }) => {
    const { currentIsMainPageCompactMode } = useIsMainPageCompactMode();
    const reasonId = `main_switch_${switch_id}_reason`;
    // A long name breaks before its short name in brackets, never in the middle of a word.
    const label = splitFeatureLabel(switchLabel);
    const active = !unavailable && currentState.data === true;
    const pending = !unavailable && currentState.state === "pending";
    const greyed = unavailable || !!blockedReason;
    // The icon rail has no label: its tooltip names the switch before the reason.
    const blockedTitle = blockedReason && (currentIsMainPageCompactMode.data ? `${switchLabel}: ${blockedReason}` : blockedReason);
    const blocked = greyed || disabled || (!cancellable && pending);

    const getClassNames = (baseClass) => clsx(baseClass, {
        [styles.is_compact_mode]: currentIsMainPageCompactMode.data,
        [styles.is_active]: active,
        [styles.is_pending]: pending,
        [styles.is_unavailable]: greyed,
        [styles.cancellable]: cancellable,
        [styles.in_row]: inRow,
    });

    return (
        <div
            className={getClassNames(styles.switch_container)}
            role="switch" aria-label={unavailable && statusText ? `${switchLabel}: ${statusText}` : switchLabel} aria-checked={active}
            aria-busy={pending} aria-disabled={blocked} tabIndex={0}
            aria-describedby={blockedReason ? reasonId : undefined}
            title={blockedTitle ?? statusText ?? (currentIsMainPageCompactMode.data ? switchLabel : undefined)}
            onClick={() => { if (!blocked) toggleFunction(); }}
            onKeyDown={event => {
                if (event.key === " " || event.key === "Enter") {
                    event.preventDefault();
                    if (!event.repeat && !blocked) toggleFunction();
                }
            }}
        >
            <div className={styles.label_wrapper}>
                {!inRow && <SvgComponent className={getClassNames(styles.switch_svg)} />}
                <p className={getClassNames(styles.switch_label)}>
                    {label.name}
                    {label.abbr && <span className={getClassNames(styles.switch_label_abbr)}
                        data-bracket={label.abbr.startsWith("（") || undefined}>{label.abbr}</span>}
                </p>
                {statusText && <span className={getClassNames(styles.switch_status)} role="status">{statusText}</span>}
                {blockedReason && <span id={reasonId} className={styles.visually_hidden}>{blockedReason}</span>}
                {children}
            </div>

            <ToggleSwitch
                isActive={active}
                isPending={pending}
                skeleton={starting}
                className={getClassNames(styles.toggle_control)}
            />

            <div className={getClassNames(styles.switch_indicator)}></div>
            {pending && (
                <span className={styles.loader}></span>
            )}
        </div>
    );
};
