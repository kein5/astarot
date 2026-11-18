import { VoiceRouteSettings } from "./VoiceRouteSettings";
import { AdvancedSection } from "../_components/advanced_section/AdvancedSection";
import { PagePointer } from "../_components/page_pointer/PagePointer";
import { useI18n } from "@useI18n";
import styles from "./Device.module.scss";
import clsx from "clsx";
import { useStore_IsBreakPoint } from "@store";
import { ui_configs } from "@ui_configs";
import {
    useDevice,
} from "@logics_configs";

import {
    MultiDropdownMenuContainer,
} from "../_templates/Templates";

import {
    SectionLabelComponent,
    LabelComponent,
    DropdownMenu,
    ThresholdComponent,
    RadioButton,
} from "../_components";
import { Checkbox } from "@common_components";

// "Auto select" in a device row: a settings checkbox with its name beside it, like
// every other on/off setting (#436).
export const AutoSelectCheckbox = ({ secondary_label, variable, toggleFunction }) => (
    <Checkbox show_label label={secondary_label} variable={variable} toggleFunction={toggleFunction}
        size="2.4rem" padding="0.8rem" />
);

// The microphone and the speaker are chosen first; how sensitive each is, and the voice route,
// are set once, in 「詳細設定」, whose line shows them (#554). A part of MicContainer and
// SpeakerContainer is drawn in each place, so each keeps its state in one component.
export const Device = () => {
    const { t } = useI18n();
    const { currentMicVadFilter, currentEnableAutomaticMicThreshold, currentSpeakerVadFilter,
        currentEnableAutomaticSpeakerThreshold, currentVadAvailable } = useDevice();
    const mode = (vad, automatic) => currentVadAvailable.data === true && vad.data === true ? "option_vad"
        : automatic.data === true ? "option_auto" : "option_manual";
    return (
        <div className={styles.container}>
            <MicContainer part="device" />
            <SpeakerContainer part="device" />
            <AdvancedSection status={t("config_page.advanced_status.device", {
                mic: t(`config_page.device.mic_dynamic_energy_threshold.${mode(currentMicVadFilter, currentEnableAutomaticMicThreshold)}`),
                speaker: t(`config_page.device.speaker_dynamic_energy_threshold.${mode(currentSpeakerVadFilter, currentEnableAutomaticSpeakerThreshold)}`) })}>
                <MicContainer part="sensitivity" />
                <SpeakerContainer part="sensitivity" />
                <VoiceRouteSettings subheading />
                {/* Mute sync lives on the VRChat page, which it is about (IA-03). */}
                <PagePointer label={t("config_page.others.vrc_mic_mute_sync.label")} description={t("config_page.device.mute_sync_pointer")}
                    tab="vrchat" target="vrc_mic_mute_sync" action={t("config_page.device.mute_sync_action")} />
            </AdvancedSection>
        </div>
    );
};

const MicContainer = ({ part }) => {
    const { t } = useI18n();
    const {
        currentEnableAutoMicSelect,
        toggleEnableAutoMicSelect,
        currentMicDeviceOptions,
        currentMicHostList,

        currentSelectedMicHost,
        setSelectedMicHost,
        currentSelectedMicDeviceId,
        setSelectedMicDeviceId,

        currentMicVadFilter,
        toggleMicVadFilter,
        currentEnableAutomaticMicThreshold,
        toggleEnableAutomaticMicThreshold,
        currentVadAvailable,
    } = useDevice();

    const selectFunction_host = (selected_data) => {
        setSelectedMicHost(selected_data.selected_id);
    };

    const selectFunction_device = (selected_data) => {
        setSelectedMicDeviceId(selected_data.selected_id);
    };

    const is_disabled_selector = currentEnableAutoMicSelect.data === true || currentEnableAutoMicSelect.state === "pending";

    // Without a VAD engine a saved VAD switch cuts nothing: show the mode that applies.
    const is_vad_available = currentVadAvailable.data === true;
    const is_mic_vad_active = is_vad_available && currentMicVadFilter.data === true;

    const getMicSensitivityMode = () => {
        if (is_mic_vad_active) return "vad";
        if (currentEnableAutomaticMicThreshold.data === true) return "auto";
        return "manual";
    };

    const setMicSensitivityMode = (id) => {
        if (id === "vad") {
            if (!currentMicVadFilter.data) toggleMicVadFilter();
            return;
        }
        if (currentMicVadFilter.data) toggleMicVadFilter();
        if (currentEnableAutomaticMicThreshold.data !== (id === "auto")) {
            toggleEnableAutomaticMicThreshold();
        }
    };

    const mic_sensitivity_mode = getMicSensitivityMode();
    const mic_sensitivity_variable = {
        data: mic_sensitivity_mode,
        state: currentMicVadFilter.state === "pending" || currentEnableAutomaticMicThreshold.state === "pending" ? "pending" : currentMicVadFilter.state,
    };

    if (part === "device") return (
        <div className={styles.mic_container}>
            <SectionLabelComponent label={t("config_page.device.section_label_mic")} />
            <MultiDropdownMenuContainer
                setting_id="mic_host_device"
                label={t("config_page.device.mic_host_device.label")}
                // Say what this choice drives; only Linux lists PipeWire inputs.
                desc={currentSelectedMicHost.data === "PipeWire" ? t("config_page.device.mic_host_device.desc_pipewire") : t("config_page.device.mic_host_device.desc")}
                dropdown_settings={[
                    {
                        insert_component: AutoSelectCheckbox,
                        insert_component_props: {
                            secondary_label: t("config_page.device.label_auto_select"),
                            variable: currentEnableAutoMicSelect,
                            toggleFunction: toggleEnableAutoMicSelect,
                        },
                        insert_to: "before",
                    },
                    {
                        dropdown_id: "mic_host",
                        secondary_label: t("config_page.device.label_host"),
                        selected_id: currentSelectedMicHost.data,
                        list: currentMicHostList.data,
                        selectFunction: selectFunction_host,
                        state: currentSelectedMicHost.state,
                        is_disabled: is_disabled_selector,
                    },
                    {
                        dropdown_id: "mic_device",
                        secondary_label: t("config_page.device.label_device"),
                        selected_id: currentSelectedMicDeviceId.data,
                        list: currentMicDeviceOptions.data,
                        selectFunction: selectFunction_device,
                        state: currentSelectedMicDeviceId.state,
                        is_disabled: is_disabled_selector,
                    }
                ]}
            />
        </div>
    );

    return (
        <div className={styles.mic_container}>
            <SectionLabelComponent sub label={t("config_page.device.section_label_mic_sensitivity")} />
            <div className={styles.threshold_container} data-setting-id="mic_dynamic_energy_threshold">
                <div className={styles.threshold_switch_section}>
                    <LabelComponent label={t("config_page.device.mic_dynamic_energy_threshold.label")} />
                    <RadioButton
                        name="mic_sensitivity_mode"
                        checked_variable={mic_sensitivity_variable}
                        selectFunction={setMicSensitivityMode}
                        options={[
                            {
                                id: "vad",
                                label: t("config_page.device.mic_dynamic_energy_threshold.option_vad"),
                                desc: is_vad_available
                                    ? t("config_page.device.mic_dynamic_energy_threshold.desc_for_vad")
                                    : t("config_page.device.desc_vad_unavailable"),
                                disabled: !is_vad_available,
                            },
                            {
                                id: "auto",
                                label: t("config_page.device.mic_dynamic_energy_threshold.option_auto"),
                                desc: t("config_page.device.mic_dynamic_energy_threshold.desc_for_automatic"),
                            },
                            {
                                id: "manual",
                                label: t("config_page.device.mic_dynamic_energy_threshold.option_manual"),
                                desc: t("config_page.device.mic_dynamic_energy_threshold.desc_for_manual"),
                            },
                        ]}
                    />
                </div>
                <div className={styles.threshold_section}>
                    <ThresholdComponent
                        id="mic_threshold"
                        min={ui_configs.mic_threshold_min}
                        max={ui_configs.mic_threshold_max}
                        is_vad_active={is_mic_vad_active}
                    />
                </div>
            </div>
        </div>
    );
};

const SpeakerContainer = ({ part }) => {
    const { t } = useI18n();
    const {
        currentEnableAutoSpeakerSelect,
        toggleEnableAutoSpeakerSelect,
        currentSpeakerDeviceOptions,
        currentSelectedSpeakerDeviceId,
        setSelectedSpeakerDeviceId,
        currentSpeakerVadFilter,
        toggleSpeakerVadFilter,
        currentEnableAutomaticSpeakerThreshold,
        toggleEnableAutomaticSpeakerThreshold,
        currentVadAvailable,
    } = useDevice();

    const selectFunction = (selected_data) => {
        setSelectedSpeakerDeviceId(selected_data.selected_id);
    };

    const is_disabled_selector = currentEnableAutoSpeakerSelect.data === true || currentEnableAutoSpeakerSelect.state === "pending";

    const is_vad_available = currentVadAvailable.data === true;
    const is_speaker_vad_active = is_vad_available && currentSpeakerVadFilter.data === true;

    const getSpeakerSensitivityMode = () => {
        if (is_speaker_vad_active) return "vad";
        if (currentEnableAutomaticSpeakerThreshold.data === true) return "auto";
        return "manual";
    };

    const setSpeakerSensitivityMode = (id) => {
        if (id === "vad") {
            if (!currentSpeakerVadFilter.data) toggleSpeakerVadFilter();
            return;
        }
        if (currentSpeakerVadFilter.data) toggleSpeakerVadFilter();
        if (currentEnableAutomaticSpeakerThreshold.data !== (id === "auto")) {
            toggleEnableAutomaticSpeakerThreshold();
        }
    };

    const { currentIsBreakPoint } = useStore_IsBreakPoint();
    const device_container_class = clsx(styles.device_container, {
        [styles.is_break_point]: currentIsBreakPoint.data,
    });

    const speaker_sensitivity_mode = getSpeakerSensitivityMode();
    const speaker_sensitivity_variable = {
        data: speaker_sensitivity_mode,
        state: currentSpeakerVadFilter.state === "pending" || currentEnableAutomaticSpeakerThreshold.state === "pending" ? "pending" : currentSpeakerVadFilter.state,
    };

    if (part === "device") return (
        <div className={styles.speaker_container}>
            <SectionLabelComponent label={t("config_page.device.section_label_speaker")} />
            <div className={device_container_class} data-setting-id="speaker_device">
                <LabelComponent label={t("config_page.device.speaker_device.label")} />
                <div className={styles.device_contents}>
                    <AutoSelectCheckbox
                        secondary_label={t("config_page.device.label_auto_select")}
                        variable={currentEnableAutoSpeakerSelect}
                        toggleFunction={toggleEnableAutoSpeakerSelect}
                    />
                    <DropdownMenu
                        dropdown_id="speaker_device"
                        secondary_label={t("config_page.device.label_device")}
                        label={t("config_page.device.speaker_device.label")}
                        selected_id={currentSelectedSpeakerDeviceId.data}
                        list={currentSpeakerDeviceOptions.data}
                        selectFunction={selectFunction}
                        state={currentSelectedSpeakerDeviceId.state}
                        is_disabled={is_disabled_selector}
                    />
                </div>
            </div>
        </div>
    );

    return (
        <div className={styles.speaker_container}>
            <SectionLabelComponent sub label={t("config_page.device.section_label_speaker_sensitivity")} />
            <div className={styles.threshold_container} data-setting-id="speaker_dynamic_energy_threshold">
                <div className={styles.threshold_switch_section}>
                    <LabelComponent label={t("config_page.device.speaker_dynamic_energy_threshold.label")} />
                    <RadioButton
                        name="speaker_sensitivity_mode"
                        checked_variable={speaker_sensitivity_variable}
                        selectFunction={setSpeakerSensitivityMode}
                        options={[
                            {
                                id: "vad",
                                label: t("config_page.device.speaker_dynamic_energy_threshold.option_vad"),
                                desc: is_vad_available
                                    ? t("config_page.device.speaker_dynamic_energy_threshold.desc_for_vad")
                                    : t("config_page.device.desc_vad_unavailable"),
                                disabled: !is_vad_available,
                            },
                            {
                                id: "auto",
                                label: t("config_page.device.speaker_dynamic_energy_threshold.option_auto"),
                                desc: t("config_page.device.speaker_dynamic_energy_threshold.desc_for_automatic"),
                            },
                            {
                                id: "manual",
                                label: t("config_page.device.speaker_dynamic_energy_threshold.option_manual"),
                                desc: t("config_page.device.speaker_dynamic_energy_threshold.desc_for_manual"),
                            },
                        ]}
                    />
                </div>
                <div className={styles.threshold_section}>
                    <ThresholdComponent
                        id="speaker_threshold"
                        min={ui_configs.speaker_threshold_min}
                        max={ui_configs.speaker_threshold_max}
                        is_vad_active={is_speaker_vad_active}
                    />
                </div>
            </div>
        </div>
    );
};
