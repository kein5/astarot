import { useEffect, useId, useState } from "react";
import type { ComponentType, ReactNode, SVGProps } from "react";
import type { TFunction } from "i18next";
import type { AtomStatus } from "@store";
import type { SwitchBlockAction, SwitchBlockId } from "../../../../../logics/main/switchBlocks";
import { useVoice, sourceKey } from "../../../../../logics/voice/useVoice";
import { directRouteReady, usesOutputDevice } from "../../../../../logics/voice/routeState";
import { rvcStartOptions } from "../../../../../logics/voice/rvcStartOptions";
import { useNotificationStatus } from "../../../../../logics/common/useNotificationStatus";
import { voiceActions, voiceSwitchStates } from "../../../../../logics/voice/voiceActions.ts";
import { splitFeatureLabel } from "../../../../../logics/common/featureLabel.ts";
import { voiceErrorText } from "../../../../../logics/voice/voiceErrorText.ts";
import { useSwitchBlocks } from "../../../../../logics/main/useSwitchBlocks";
import { useSetupLeads } from "../../../../../logics/setup/useSetupLeads";
import { activeSwitchBlock } from "../../../../../logics/main/switchBlocks";
import { useI18n } from "@useI18n";
import { useIsBackendReady } from "@logics_common";
import { useIsStartingUp } from "../../startupContext";
import { useUsagePresets } from "@logics_configs";
import { isSwitchShown, pickedPresets } from "../../../../../logics/configs/usagePresets.ts";
import ArrowDownSvg from "@images/narrow_arrow_down.svg?react";
import { store } from "@store";
import clsx from "clsx";
import * as styles from "./MainFunctionSwitch.css.ts";
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
import { Tooltip } from "../../../../common_components/tooltip/Tooltip";
import { Button, Switch } from "../../../../kit/index.ts";

type SvgComponent = ComponentType<SVGProps<SVGSVGElement>>;

// A switch's state as the row draws it: on, and whether a change is on its way.
export interface SwitchState {
    data: boolean;
    state: AtomStatus;
}

interface SwitchItem {
    switch_id: SwitchBlockId;
    label: string;
    SvgComponent: SvgComponent;
    currentState: SwitchState;
    toggleFunction: () => void;
    cancellable?: boolean;
    disabled?: boolean;
    statusText?: string | null;
}

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
    const notify = (code: string, page: string) => {
        // After the engine stops, its own notice already says so.
        if (code === "backend_unavailable" && !store.backend_subprocess) return;
        showNotification_Error(voiceErrorText(code, page, t, key => i18n.exists(key)));
    };
    const ttsName = t("main_page.tts"), rvcName = t("main_page.rvc");
    useEffect(() => { if (voice.ttsError) notify(voice.ttsError, ttsName); }, [voice.ttsError]);
    useEffect(() => { if (voice.directError) notify(voice.directError, rvcName); }, [voice.directError]);
    const rvcOwnsInput = voice.directOwner === "rvc";
    useEffect(() => {
        if (rvcOwnsInput && voice.directState.error) notify(String(voice.directState.error), rvcName);
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
    const switch_items: SwitchItem[] = [
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
    // The uses picked in settings choose the switches in sight (usagePresets.ts, #554). A switch
    // that is on, or on its way on or off, always stays: it can always be turned off. The others
    // are under 「ほかの機能」, which shows them all in their usual order; showing them is not
    // saved and changes no setting (Q-10). A switch the first-run setup leads to (#955) stays in
    // sight too until it is turned on, so the lead is not hidden under 「ほかの機能」.
    const { currentUsagePresets } = useUsagePresets();
    const picked = pickedPresets(currentUsagePresets.data);
    const [showOthers, setShowOthers] = useState(false);
    const { leads, settle } = useSetupLeads();
    const inSight = (item: SwitchItem) => isSwitchShown(picked, item.switch_id,
        item.currentState?.data === true || item.currentState?.state === "pending" || leads.includes(item.switch_id));
    const hiddenCount = switch_items.filter(item => !inSight(item)).length;
    const rows = showOthers ? switch_items : switch_items.filter(inSight);
    // Other views of these switches (the tray companion) read the TTS and voice changer state here.
    const switchState = (id: SwitchBlockId) => { const value = switch_items.find(item => item.switch_id === id)?.currentState;
        return { on: value?.data === true, pending: value?.state === "pending" }; };
    useEffect(() => { voiceSwitchStates.publish({ tts: switchState("tts"), rvc: switchState("rvc") }); });
    // The switches the first-run setup leads to (#955) stand out until each is turned on.
    useEffect(() => { for (const id of leads) if (switchState(id).on) settle(id); });

    return (
        <div className={styles.container}>
            {/* One list of rows, the 「ほかの機能」 button last when some switch is left out. */}
            {[...rows.map(item => {
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
                    statusText={ready ? item.statusText : null}
                    unavailableText={ready || starting ? null : t("main_page.backend_disconnected")}
                    toggleFunction={item.toggleFunction}
                    SvgComponent={item.SvgComponent}
                    settingsLabel={settingsLabel(destination, t)}
                    openSettings={() => prepare(destination)}
                    lead={leads.includes(item.switch_id) && item.currentState.data !== true}
                />;
            }), ...(hiddenCount > 0 ? [<MoreFeaturesButton key="more_features" count={hiddenCount} expanded={showOthers}
                onToggle={() => setShowOthers(value => !value)} />] : [])]}
        </div>
    );
};

// Shows or hides the switches the uses picked in settings leave out: the kit's compact Button at
// the list's end. In the icon rail it is an icon whose tooltip and name say the same. What it does
// is its tooltip and its accessible description (the words stay in the page while the tooltip is
// closed).
export const MoreFeaturesButton = ({ count, expanded, onToggle }: { count: number; expanded: boolean; onToggle: () => void }) => {
    const { t } = useI18n();
    const { currentIsMainPageCompactMode } = useIsMainPageCompactMode();
    const compact = currentIsMainPageCompactMode.data;
    const label = expanded ? t("main_page.more_features_hide") : t("main_page.more_features", { number: count });
    const hint = t("main_page.more_features_hint");
    const hintId = useId();
    return (
        <Tooltip bare placement="right" title={`${label}: ${hint}`}>
            <Button size="compact" aria-expanded={expanded} aria-label={label} aria-describedby={hintId}
                data-more-features onClick={onToggle}>
                <ArrowDownSvg aria-hidden="true" className={clsx(styles.more_features_svg, { [styles.is_open]: expanded })} />
                {!compact && <span className={styles.more_features_label}>{label}</span>}
                <span id={hintId} hidden>{hint}</span>
            </Button>
        </Tooltip>
    );
};

// Where each feature's icon leads when nothing is missing: the translator list for translation,
// the feature's settings page for the others. A missing setup sends the icon to the place that
// provides it instead (switchBlocks.ts).
export const SETTINGS_DESTINATION: Record<SwitchBlockId, SwitchBlockAction> = {
    translation: "translator",
    transcription_send: "transcription",
    transcription_receive: "transcription",
    ocr: "ocr",
    tts: "tts",
    rvc: "rvc",
};

// The icon button's name and tooltip: what pressing it does.
export const settingsLabel = (destination: SwitchBlockAction, t: TFunction) => {
    if (destination === "translator") return t("main_page.feature_settings.translator");
    if (destination === "translation") return t("main_page.feature_settings.translation_model");
    if (destination === "recognition_setup") return t("main_page.feature_settings.recognition_models");
    const page = destination === "ocr_models" ? "ocr" : destination;
    return t("main_page.feature_settings.open_page", { page: t(`config_page.side_menu_labels.${page}`) });
};

// One row of the wide rail: the feature's icon is a button that opens its settings, the rest
// of the row is the switch's label. The two are siblings because a label names one control
// only. The icon button is the same size in every state, so nothing moves when the engine's
// state arrives. The icon rail has no room for two targets: there the icon stays part of the
// switch's label and the settings open from the gear at the rail's foot.
type SwitchRowProps = SwitchContainerProps & {
    settingsLabel: string;
    openSettings: () => void;
};

export const SwitchRow = ({ settingsLabel: label, openSettings, ...props }: SwitchRowProps) => {
    const { currentIsMainPageCompactMode } = useIsMainPageCompactMode();
    if (currentIsMainPageCompactMode.data) return <SwitchContainer {...props} />;
    const { SvgComponent, currentState, unavailable } = props;
    const active = !unavailable && currentState.data === true;
    const pending = !unavailable && currentState.state === "pending";
    return (
        <div className={clsx(styles.switch_row, {
            [styles.is_active]: active,
            [styles.is_unavailable]: unavailable || !!props.blockedReason,
        })} data-lead={props.lead || undefined}>
            {/* Beside the rail, level with the row: next to the icon it would cover the switch's name. */}
            <Tooltip bare placement="right" beside={`.${styles.switch_row}`} title={label}>
                <Button size="icon-xs" className={styles.settings_button} data-feature-settings={props.switch_id}
                    aria-label={label} onClick={openSettings}>
                    <SvgComponent aria-hidden="true" className={clsx(styles.switch_svg, {
                        [styles.is_active]: active, [styles.is_pending]: pending })} />
                </Button>
            </Tooltip>
            <SwitchContainer {...props} inRow />
        </div>
    );
};

// blockedReason: why the switch cannot be turned on yet and where to provide it. The switch is
// then disabled and says so in its tooltip and to screen readers; it keeps its place in the
// tab order so that the reason can be heard.
// starting: the engine has not sent the switch's state yet; the switch is a placeholder.
// unavailableText: why no switch can be used (the engine is gone). The rail says it once at its
// head (EngineReadout); the switch adds no line for it, and keeps it in its name and tooltip.
// inRow: the icon is drawn by SwitchRow as its own button; the row draws the background.
type SwitchContainerProps = {
    switchLabel: string;
    switch_id: SwitchBlockId;
    children?: ReactNode;
    currentState: SwitchState;
    toggleFunction: () => void;
    SvgComponent: SvgComponent;
    cancellable?: boolean;
    disabled?: boolean;
    unavailable?: boolean;
    starting?: boolean;
    statusText?: string | null;
    unavailableText?: string | null;
    blockedReason?: string | null;
    inRow?: boolean;
    // The first-run setup leads here (#955): the switch stands out until it is turned on.
    lead?: boolean;
};

// The row is the label of the kit's switch at its end (D-19, decided on 2026-11-25): pressing
// anywhere on it presses the switch, once. The switch is named as the row was (aria-label), and
// the row's words are read only as that name, not once more beside it: they are aria-hidden, as
// they were inside the row that was the switch. The icon rail has no room for the switch: there it
// is visually hidden, still focused and pressed through the row, whose ring shows its focus.
export const SwitchContainer = ({ switchLabel, switch_id, children, currentState, toggleFunction, SvgComponent, cancellable = false, disabled = false, unavailable = false, starting = false, statusText = null, unavailableText = null, blockedReason = null, inRow = false, lead = false }: SwitchContainerProps) => {
    const { currentIsMainPageCompactMode } = useIsMainPageCompactMode();
    const switchId = `main_switch_${switch_id}`;
    const reasonId = `${switchId}_reason`;
    // A long name breaks before its short name in brackets, never in the middle of a word.
    const label = splitFeatureLabel(switchLabel);
    const active = !unavailable && currentState.data === true;
    const pending = !unavailable && currentState.state === "pending";
    const greyed = unavailable || !!blockedReason;
    // The icon rail has no label: its tooltip names the switch before the reason.
    const blockedTitle = blockedReason && (currentIsMainPageCompactMode.data ? `${switchLabel}: ${blockedReason}` : blockedReason);
    const unavailableTitle = unavailable && unavailableText && (currentIsMainPageCompactMode.data ? `${switchLabel}: ${unavailableText}` : unavailableText);
    // The tooltip: why the switch is held off or cannot be used, else its state, else its name in
    // the icon rail. A state the wide rail prints under the name is not repeated in a bubble (Tooltip).
    const tooltip = blockedTitle ?? (unavailableTitle || null) ?? statusText ?? (currentIsMainPageCompactMode.data ? switchLabel : undefined);
    const blocked = greyed || disabled || (!cancellable && pending);

    const getClassNames = (baseClass: string | undefined) => clsx(baseClass, {
        [styles.is_compact_mode]: currentIsMainPageCompactMode.data,
        [styles.is_active]: active,
        [styles.is_pending]: pending,
        [styles.is_unavailable]: greyed,
        [styles.cancellable]: cancellable,
        [styles.in_row]: inRow,
    });

    return (
        <Tooltip bare placement="right" title={tooltip}>
            <label htmlFor={switchId} className={getClassNames(styles.switch_container)} data-lead={(lead && !inRow) || undefined}>
                <div className={styles.label_wrapper} aria-hidden="true">
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

                <span className={currentIsMainPageCompactMode.data ? styles.visually_hidden : styles.switch_slot}>
                    <Switch
                        id={switchId}
                        checked={active}
                        aria-label={unavailable && unavailableText ? `${switchLabel}: ${unavailableText}` : switchLabel}
                        aria-busy={pending} aria-disabled={blocked}
                        aria-describedby={blockedReason ? reasonId : undefined}
                        // Greyed out as the kit draws a switch that cannot be used, still in the tab order.
                        data-disabled={greyed ? "" : undefined}
                        // While the engine starts, a flat block of the switch's size (MainPage.css.ts).
                        data-skeleton={starting ? "" : undefined}
                        // A press anywhere on the row reaches the switch through its label: one press, one toggle.
                        onClick={() => { if (!blocked) toggleFunction(); }}
                        onKeyDown={event => {
                            if (event.key === " " || event.key === "Enter") {
                                event.preventDefault();
                                if (!event.repeat && !blocked) toggleFunction();
                            }
                        }}
                    />
                </span>

                <div className={getClassNames(styles.switch_indicator)}></div>
                {pending && (
                    <span className={styles.loader}></span>
                )}
            </label>
        </Tooltip>
    );
};
