import { useEffect, useState } from "react";
import styles from "./ThresholdComponent.module.scss";
import { SliderAndMeter } from "./slider_and_meter/SliderAndMeter";
import { ThresholdEntry } from "./threshold_entry/ThresholdEntry";
import { VolumeCheckButton } from "./volume_check_button/VolumeCheckButton";
import type { UiThreshold } from "./slider_and_meter/SliderAndMeter";
import { useVolume } from "@logics_common";
import MicSvg from "@images/mic.svg?react";
import HeadphonesSvg from "@images/headphones.svg?react";
import {
    useDevice,
} from "@logics_configs";
import { useI18n } from "@useI18n";

export interface ThresholdComponentProps {
    // Which threshold: "mic_threshold", or the speaker's otherwise.
    id: string;
    min: number;
    max: number;
    // A voice activity filter cuts instead of the threshold.
    is_vad_active?: boolean;
}

export const ThresholdComponent = (props: ThresholdComponentProps) => {
    return (
        <div className={styles.container}>
            {props.id === "mic_threshold"
                ? <MicComponent {...props} />
                : <SpeakerComponent {...props} />
            }
        </div>
    );
};

const MicComponent = (props: ThresholdComponentProps) => {
    const { t } = useI18n();
    const {
        currentMicThreshold,
        setMicThreshold,
        currentEnableAutomaticMicThreshold,
    } = useDevice();
    const [ui_threshold, setUiThreshold] = useState<UiThreshold>(currentMicThreshold.data);
    const {
        volumeCheckStart_Mic,
        volumeCheckStop_Mic,
        currentMicThresholdCheckStatus,
    } = useVolume();


    // The words for an automatic threshold are said again in a new UI language (#904).
    useEffect(() => {
        if (currentMicThreshold.state === "pending") return;
        if (currentEnableAutomaticMicThreshold.data === true || props.is_vad_active === true) {
            setUiThreshold(t("config_page.device.mic_dynamic_energy_threshold.option_auto"));
        } else {
            setUiThreshold(currentMicThreshold.data);
        }
    }, [currentMicThreshold, currentEnableAutomaticMicThreshold, props.is_vad_active, t]);

    const setUiThresholdFunction = (payload_ui_threshold: UiThreshold) => {
        setUiThreshold(payload_ui_threshold);
    };
    const setThresholdFunction = (payload_threshold: UiThreshold) => {
        setMicThreshold(payload_threshold);
    };

    const is_disable = currentEnableAutomaticMicThreshold.data === true || props.is_vad_active === true ? true : false;

    return (
        <>
            <VolumeCheckButton
                {...props}
                SvgComponent={MicSvg}
                startFunction={volumeCheckStart_Mic}
                stopFunction={volumeCheckStop_Mic}
                isChecking={currentMicThresholdCheckStatus}
            />
            <SliderAndMeter
                {...props}
                ui_threshold={ui_threshold}
                setUiThresholdFunction={setUiThresholdFunction}
                setThresholdFunction={setThresholdFunction}
            />
            <ThresholdEntry
                {...props}
                aria-label={t("vr_panel.mic_threshold")}
                confirmedThreshold={currentMicThreshold}
                ui_threshold={ui_threshold}
                setUiThresholdFunction={setUiThresholdFunction}
                setThresholdFunction={setThresholdFunction}
                is_disable={is_disable}
            />
        </>
    );
};

const SpeakerComponent = (props: ThresholdComponentProps) => {
    const { t } = useI18n();
    const {
        currentSpeakerThreshold,
        setSpeakerThreshold,
        currentEnableAutomaticSpeakerThreshold,
    } = useDevice();
    const [ui_threshold, setUiThreshold] = useState<UiThreshold>(currentSpeakerThreshold.data);
    const {
        volumeCheckStart_Speaker,
        volumeCheckStop_Speaker,
        currentSpeakerThresholdCheckStatus,
    } = useVolume();

    // The words for an automatic threshold are said again in a new UI language (#904).
    useEffect(() => {
        if (currentSpeakerThreshold.state === "pending") return;
        if (currentEnableAutomaticSpeakerThreshold.data === true || props.is_vad_active === true) {
            setUiThreshold(t("config_page.device.speaker_dynamic_energy_threshold.option_auto"));
        } else {
            setUiThreshold(currentSpeakerThreshold.data);
        }
    }, [currentSpeakerThreshold, currentEnableAutomaticSpeakerThreshold, props.is_vad_active, t]);

    const setUiThresholdFunction = (payload_ui_threshold: UiThreshold) => {
        setUiThreshold(payload_ui_threshold);
    };
    const setThresholdFunction = (payload_threshold: UiThreshold) => {
        setSpeakerThreshold(payload_threshold);
    };

    const is_disable = currentEnableAutomaticSpeakerThreshold.data === true || props.is_vad_active === true ? true : false;

    return (
        <>
            <VolumeCheckButton
                {...props}
                SvgComponent={HeadphonesSvg}
                startFunction={volumeCheckStart_Speaker}
                stopFunction={volumeCheckStop_Speaker}
                isChecking={currentSpeakerThresholdCheckStatus}
            />
            <SliderAndMeter
                {...props}
                ui_threshold={ui_threshold}
                setUiThresholdFunction={setUiThresholdFunction}
                setThresholdFunction={setThresholdFunction}
            />
            <ThresholdEntry
                {...props}
                aria-label={t("vr_panel.speaker_threshold")}
                confirmedThreshold={currentSpeakerThreshold}
                ui_threshold={ui_threshold}
                setUiThresholdFunction={setUiThresholdFunction}
                setThresholdFunction={setThresholdFunction}
                is_disable={is_disable}
            />
        </>
    );
};