import React, { useState, useEffect, useRef } from "react";
import { useI18n } from "@useI18n";
import clsx from "clsx";
import styles from "./Vr.module.scss";
import { ui_configs } from "@ui_configs";
import { Slider } from "../_components";
import { FormRow } from "../_components/form_row/FormRow";
import {
    RadioButtonContainer,
    CheckboxContainer,
} from "../_templates/Templates";
import { PagePointer } from "../_components/page_pointer/PagePointer";
import { AdvancedSection } from "../_components/advanced_section/AdvancedSection";

import {
    SectionLabelComponent,
} from "../_components";

import { ResetButton } from "@common_components";

import {
    useVr,
} from "@logics_configs";
import { useIsOpenedConfigPage } from "@logics_common";

import SquareSvg from "@images/square.svg?react";
import TriangleSvg from "@images/triangle.svg?react";
import { randomIntMinMax } from "@utils";
import { DesktopCaptionOverlay } from "./DesktopCaptionOverlay";
import { OverlayFontFamily } from "./OverlayFontFamily";

export const Vr = () => {
    const { t } = useI18n();
    const [is_opened_small_settings, setIsOpenedSmallSettings] = useState(true);
    const resetEditor = useRef(null);
    const toggleIsOpenedSmallSettings = () => {
        setIsOpenedSmallSettings(!is_opened_small_settings);
    };

    const {
        currentIsEnabledOverlayLargeLog,
        toggleIsEnabledOverlayLargeLog,
        currentIsEnabledOverlaySmallLog,
        toggleIsEnabledOverlaySmallLog,
        currentOverlayLargeLogSettings,
        setOverlayLargeLogSettings,
        currentOverlaySmallLogSettings,
        setOverlaySmallLogSettings,
        currentOverlayShowOnlyTranslatedMessages,
        currentVoiceTypingMode,
    } = useVr();
    const onOff = current => t(current?.data === true ? "config_page.advanced_status.on" : "config_page.advanced_status.off");


    const restoreDefaultSettings = () => {
        resetEditor.current?.();
        setOverlaySmallLogSettings(ui_configs.overlay_small_log_default_settings);
        setOverlayLargeLogSettings(ui_configs.overlay_large_log_default_settings);
    };

    // What a first start turns on is in sight: the captions in VR and on the desktop. Where they
    // sit, how they look and what they show are set once, in 「詳細設定」 (#554).
    return (
        <div className={styles.container}>
            <div>
                <SectionLabelComponent label={t("config_page.vr.section_label_overlay")} />
                <CheckboxContainer
                    setting_id="overlay_small_log"
                    label={t("config_page.vr.overlay_enable_single")}
                    variable={currentIsEnabledOverlaySmallLog}
                    toggleFunction={toggleIsEnabledOverlaySmallLog}
                />
                <CheckboxContainer
                    setting_id="overlay_large_log"
                    label={t("config_page.vr.overlay_enable_multi")}
                    variable={currentIsEnabledOverlayLargeLog}
                    toggleFunction={toggleIsEnabledOverlayLargeLog}
                />
            </div>
            <DesktopCaptionOverlay part="enable" />
            <AdvancedSection status={t("config_page.advanced_status.vr", {
                only: onOff(currentOverlayShowOnlyTranslatedMessages), typing: onOff(currentVoiceTypingMode) })}>
            {/* The settings search leads here for the overlay's position, rotation, size and timing. */}
            <div className={styles.overlay_section} data-setting-id="vr_overlay">
                <SectionLabelComponent sub label={t("config_page.vr.section_label_overlay_look")} />
                <div className={styles.wrapper}>
                    <PageSwitcherContainer
                        toggleFunction={toggleIsOpenedSmallSettings}
                        is_selected={is_opened_small_settings}
                        label_1={t("config_page.vr.single_line")}
                        label_2={t("config_page.vr.multi_lines")}
                    />
                    {is_opened_small_settings ? (
                        <OverlaySettingsContainer
                            key="small"
                            resetRef={resetEditor}
                            id="overlay_settings_small"
                            ui_configs={ui_configs.overlay_small_log}
                            default_ui_configs={ui_configs.overlay_small_log_default_settings}
                            state={currentOverlaySmallLogSettings.state}
                            current_overlay_settings={currentOverlaySmallLogSettings.data}
                            setOverlaySettings={setOverlaySmallLogSettings}
                        />
                    ) : (
                        <OverlaySettingsContainer
                            key="large"
                            resetRef={resetEditor}
                            id="overlay_settings_large"
                            ui_configs={ui_configs.overlay_large_log}
                            default_ui_configs={ui_configs.overlay_large_log_default_settings}
                            state={currentOverlayLargeLogSettings.state}
                            current_overlay_settings={currentOverlayLargeLogSettings.data}
                            setOverlaySettings={setOverlayLargeLogSettings}
                        />
                    )}
                </div>
            </div>
            <DesktopCaptionOverlay part="details" />
            <CommonSettingsContainer />
            <button
                className={styles.restore_default_settings_button}
                data-setting-id="restore_default_settings"
                onClick={restoreDefaultSettings}
            >
                {t("config_page.vr.restore_default_settings")}
            </button>
            </AdvancedSection>
            {/* The VR panel (VR UI) is on trial: it moved to the experimental features (#554, Q-05). */}
            <PagePointer label={t("config_page.vr.vr_panel_pointer.label")} description={t("config_page.vr.vr_panel_pointer.desc")}
                tab="experimental_features" action={t("config_page.vr.vr_panel_pointer.action")} />
        </div>
    );
};

const OverlaySettingsContainer = ({
    current_overlay_settings,
    state,
    setOverlaySettings,
    ui_configs,
    default_ui_configs,
    id,
    resetRef,
}) => {
    const { t } = useI18n();
    const [settings, setSettings] = useState(current_overlay_settings);
    const settingsRef = useRef(settings);
    const timerRef = useRef(null);
    const editVersion = useRef(0);
    const pendingWrites = useRef(0);
    const confirmedRef = useRef(current_overlay_settings);
    confirmedRef.current = current_overlay_settings;

    useEffect(() => {
        if (state !== "pending" && timerRef.current === null && !pendingWrites.current) {
            settingsRef.current = current_overlay_settings;
            setSettings(current_overlay_settings);
        }
    }, [current_overlay_settings, state]);


    const [is_opened_position_controller, setIsOpenedPositionController] = useState(true);
    const togglePositionRotationController = () => {
        setIsOpenedPositionController(!is_opened_position_controller);
    };

    useEffect(() => () => { clearTimeout(timerRef.current); editVersion.current++; }, []);
    useEffect(() => {
        resetRef.current = () => {
            clearTimeout(timerRef.current);
            timerRef.current = null;
            editVersion.current++;
            settingsRef.current = default_ui_configs;
            setSettings(default_ui_configs);
        };
        return () => { resetRef.current = null; };
    }, [resetRef, default_ui_configs]);

    const updateSettings = (key, value) => {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        editVersion.current++;
        settingsRef.current = { ...settingsRef.current, [key]: value };
        setSettings(settingsRef.current);
    };
    const sendSettings = async () => {
        const version = editVersion.current;
        pendingWrites.current++;
        try {
            const response = await setOverlaySettings(settingsRef.current);
            if (version !== editVersion.current) return;
            const confirmed = response?.status === 200 ? response.result
                : response === false || response?.status ? confirmedRef.current : null;
            if (confirmed) {
                settingsRef.current = confirmed;
                setSettings(confirmed);
            }
        } finally {
            pendingWrites.current--;
        }
    };
    const onChangeFunction = (key, value) => {
        updateSettings(key, value);
        timerRef.current = setTimeout(() => {
            timerRef.current = null;
            sendSettings();
        }, 50);
    };
    const selectFunction = (key, value) => {
        updateSettings(key, value);
        sendSettings();
    };


    return (
        <>
            {/* The axes are one row of the label and field columns: the name and what it does on
                the left, the position or rotation diagram in the field column (#568). */}
            <FormRow className={styles.axis_row} group
                label={t("config_page.vr.position_rotation.label")}
                description={t("config_page.vr.position_rotation.desc")}>
                <PageSwitcherContainer
                    toggleFunction={togglePositionRotationController}
                    is_selected={is_opened_position_controller}
                    label_1={t("config_page.vr.position")}
                    label_2={t("config_page.vr.rotation")}
                />
                <div className={styles.position_rotation_controls_box}>
                    {is_opened_position_controller ? (
                        <PositionControls settings={settings} onChangeFunction={onChangeFunction} ui_configs={ui_configs} default_ui_configs={default_ui_configs} selectFunction={selectFunction}/>
                    ) : (
                        <RotationControls settings={settings} onChangeFunction={onChangeFunction} ui_configs={ui_configs} default_ui_configs={default_ui_configs} selectFunction={selectFunction}/>
                    )}
                </div>
            </FormRow>
            <FormRow className={styles.sample_row} group label={t("config_page.vr.sample_text_button.label")} description={t("config_page.vr.sample_text_button.desc")}>
                <SendSampleTextToggleButton />
            </FormRow>
            <OtherControls settings={settings} onChangeFunction={onChangeFunction} ui_configs={ui_configs} />
            <RadioButtonContainer
                label={t("config_page.vr.tracker")}
                selectFunction={(value) => selectFunction("tracker", value)}
                name={id}
                options={[
                    { id: "HMD", label: t("config_page.vr.hmd") },
                    { id: "LeftHand", label: t("config_page.vr.left_hand") },
                    { id: "RightHand", label: t("config_page.vr.right_hand") },
                ]}
                checked_variable={{data: settings.tracker}}
                column={true}
            />
        </>
    );
};


const PageSwitcherContainer = (props) => {
    const toggle_button_class_names__position = clsx(styles.controller_type_switcher, {
        [styles.is_selected]: props.is_selected,
    });
    const toggle_button_class_names__rotation = clsx(styles.controller_type_switcher, {
        [styles.is_selected]: !props.is_selected,
    });

    // Two pressable halves; choosing the shown half changes nothing.
    const half = (selected, className, label) => {
        const choose = () => { if (!selected) props.toggleFunction(); };
        return (
            <div className={className} role="button" tabIndex={0} aria-pressed={selected} onClick={choose}
                onKeyDown={event => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); choose(); } }}>
                <p className={styles.controller_switcher_label}>{label}</p>
            </div>
        );
    };

    return (
        <div className={styles.controller_type_switch}>
            {half(props.is_selected, toggle_button_class_names__position, props.label_1)}
            {half(!props.is_selected, toggle_button_class_names__rotation, props.label_2)}
        </div>
    );
};


export const PositionControls = ({ settings, onChangeFunction, selectFunction, ui_configs, default_ui_configs }) => {
    const { t } = useI18n();

    const {
        variable_display: x_variable_display,
        is_max: is_max_position_x,
        is_min: is_min_position_x,
        countUp: countUpPositionX,
        countDown: countDownPositionX,
    } = useVariableControl("x_pos", settings, onChangeFunction, ui_configs);

    const {
        variable_display: y_variable_display,
        is_max: is_max_position_y,
        is_min: is_min_position_y,
        countUp: countUpPositionY,
        countDown: countDownPositionY,
    } = useVariableControl("y_pos", settings, onChangeFunction, ui_configs);

    const {
        variable_display: z_variable_display,
        is_max: is_max_position_z,
        is_min: is_min_position_z,
        countUp: countUpPositionZ,
        countDown: countDownPositionZ,
    } = useVariableControl("z_pos", settings, onChangeFunction, ui_configs);

    return (
        <div className={styles.position_controls}>
            <div className={styles.position_wrapper}>
                <p className={clsx(styles.slider_label, styles.x_position_label)}>
                    {t("config_page.vr.x_position")}
                    <ResetButton onClickFunction={() => selectFunction("x_pos", default_ui_configs.x_pos)} label={`${t("config_page.vr.x_position")}: ${t("common.reset_to_default")}`} />
                </p>
                <Slider
                    aria-label={t("config_page.vr.x_position")}
                    className={styles.x_position_slider}
                    no_padding={true}
                    variable={settings.x_pos}
                    step={ui_configs.x_pos.step}
                    min={ui_configs.x_pos.min}
                    max={ui_configs.x_pos.max}
                    setterFunction={(value) => onChangeFunction("x_pos", value)}
                    setter_timing="on_change"
                    debounce_ms={0}
                    valueLabelDisplay={x_variable_display}
                    valueLabelDisplayLocation="top"
                />
                <AdjustButtonContainer
                    wrapper_class_name={styles.x_position_button_wrapper}
                    label={t("config_page.vr.x_position")}
                    is_max={is_max_position_x}
                    is_min={is_min_position_x}
                    countUp={countUpPositionX}
                    countDown={countDownPositionX}
                />
            </div>

            <div className={styles.position_wrapper}>
                <p className={clsx(styles.slider_label, styles.y_position_label)}>
                    {t("config_page.vr.y_position")}
                    <ResetButton onClickFunction={() => selectFunction("y_pos", default_ui_configs.y_pos)} label={`${t("config_page.vr.y_position")}: ${t("common.reset_to_default")}`} />
                </p>
                <Slider
                    aria-label={t("config_page.vr.y_position")}
                    className={styles.y_position_slider}
                    no_padding={true}
                    variable={settings.y_pos}
                    step={ui_configs.y_pos.step}
                    min={ui_configs.y_pos.min}
                    max={ui_configs.y_pos.max}
                    setterFunction={(value) => onChangeFunction("y_pos", value)}
                    setter_timing="on_change"
                    debounce_ms={0}
                    orientation="vertical"
                    valueLabelDisplay={y_variable_display}
                    valueLabelDisplayLocation="right"
                />
                <AdjustButtonContainer
                    wrapper_class_name={styles.y_position_button_wrapper}
                    label={t("config_page.vr.y_position")}
                    is_max={is_max_position_y}
                    is_min={is_min_position_y}
                    countUp={countUpPositionY}
                    countDown={countDownPositionY}
                />
            </div>

            <div className={styles.position_wrapper}>
                <p className={clsx(styles.slider_label, styles.z_position_label)}>
                    {t("config_page.vr.z_position")}
                    <ResetButton onClickFunction={() => selectFunction("z_pos", default_ui_configs.z_pos)} label={`${t("config_page.vr.z_position")}: ${t("common.reset_to_default")}`} />
                </p>
                <Slider
                    aria-label={t("config_page.vr.z_position")}
                    className={styles.z_position_slider}
                    no_padding={true}
                    variable={settings.z_pos}
                    step={ui_configs.z_pos.step}
                    min={ui_configs.z_pos.min}
                    max={ui_configs.z_pos.max}
                    setterFunction={(value) => onChangeFunction("z_pos", value)}
                    setter_timing="on_change"
                    debounce_ms={0}
                    orientation="vertical"
                    valueLabelDisplay={z_variable_display}
                    valueLabelDisplayLocation="left"
                />
                <AdjustButtonContainer
                    wrapper_class_name={styles.z_position_button_wrapper}
                    label={t("config_page.vr.z_position")}
                    is_max={is_max_position_z}
                    is_min={is_min_position_z}
                    countUp={countUpPositionZ}
                    countDown={countDownPositionZ}
                />
            </div>
        </div>
    );
};

export const RotationControls = ({ settings, onChangeFunction, selectFunction, ui_configs, default_ui_configs }) => {
    const { t } = useI18n();

    const {
        variable_display: x_variable_display,
        is_max: is_max_rotation_x,
        is_min: is_min_rotation_x,
        countUp: countUpRotationX,
        countDown: countDownRotationX,
    } = useVariableControl("x_rotation", settings, onChangeFunction, ui_configs);

    const {
        variable_display: y_variable_display,
        is_max: is_max_rotation_y,
        is_min: is_min_rotation_y,
        countUp: countUpRotationY,
        countDown: countDownRotationY,
    } = useVariableControl("y_rotation", settings, onChangeFunction, ui_configs);

    const {
        variable_display: z_variable_display,
        is_max: is_max_rotation_z,
        is_min: is_min_rotation_z,
        countUp: countUpRotationZ,
        countDown: countDownRotationZ,
    } = useVariableControl("z_rotation", settings, onChangeFunction, ui_configs);

    return (
        <div className={styles.rotation_controls}>
            <div className={styles.rotation_wrapper}>
                <p className={clsx(styles.slider_label, styles.x_rotation_label)}>
                    {t("config_page.vr.x_rotation")}
                    <ResetButton onClickFunction={() => selectFunction("x_rotation", default_ui_configs.x_rotation)} label={`${t("config_page.vr.x_rotation")}: ${t("common.reset_to_default")}`} />
                </p>
                <Slider
                    aria-label={t("config_page.vr.x_rotation")}
                    className={styles.x_rotation_slider}
                    no_padding={true}
                    variable={-settings.x_rotation}
                    valueLabelFunction={(val) => -val}
                    step={ui_configs.x_rotation.step}
                    min={ui_configs.x_rotation.min}
                    max={ui_configs.x_rotation.max}
                    setterFunction={(value) => onChangeFunction("x_rotation", -value)}
                    setter_timing="on_change"
                    debounce_ms={0}
                    orientation="vertical"
                    valueLabelDisplay={x_variable_display}
                    valueLabelDisplayLocation="right"
                />
                <AdjustButtonContainer
                    wrapper_class_name={styles.x_rotation_button_wrapper}
                    label={t("config_page.vr.x_rotation")}
                    up_decreases
                    is_max={is_min_rotation_x}
                    is_min={is_max_rotation_x}
                    countUp={countDownRotationX}
                    countDown={countUpRotationX}
                />
            </div>

            <div className={styles.rotation_wrapper}>
                <p className={clsx(styles.slider_label, styles.y_rotation_label)}>
                    {t("config_page.vr.y_rotation")}
                    <ResetButton onClickFunction={() => selectFunction("y_rotation", default_ui_configs.y_rotation)} label={`${t("config_page.vr.y_rotation")}: ${t("common.reset_to_default")}`} />
                </p>
                <Slider
                    aria-label={t("config_page.vr.y_rotation")}
                    className={styles.y_rotation_slider}
                    no_padding={true}
                    variable={settings.y_rotation}
                    step={ui_configs.y_rotation.step}
                    min={ui_configs.y_rotation.min}
                    max={ui_configs.y_rotation.max}
                    setterFunction={(value) => onChangeFunction("y_rotation", value)}
                    setter_timing="on_change"
                    debounce_ms={0}
                    valueLabelDisplay={y_variable_display}
                    valueLabelDisplayLocation="top"
                />
                <AdjustButtonContainer
                    wrapper_class_name={styles.y_rotation_button_wrapper}
                    label={t("config_page.vr.y_rotation")}
                    is_max={is_max_rotation_y}
                    is_min={is_min_rotation_y}
                    countUp={countUpRotationY}
                    countDown={countDownRotationY}
                />
            </div>

            <div className={styles.rotation_wrapper}>
                <p className={clsx(styles.slider_label, styles.z_rotation_label)}>
                    {t("config_page.vr.z_rotation")}
                    <ResetButton onClickFunction={() => selectFunction("z_rotation", default_ui_configs.z_rotation)} label={`${t("config_page.vr.z_rotation")}: ${t("common.reset_to_default")}`} />
                </p>
                <Slider
                    aria-label={t("config_page.vr.z_rotation")}
                    className={styles.z_rotation_slider}
                    no_padding={true}
                    variable={settings.z_rotation}
                    step={ui_configs.z_rotation.step}
                    min={ui_configs.z_rotation.min}
                    max={ui_configs.z_rotation.max}
                    setterFunction={(value) => onChangeFunction("z_rotation", value)}
                    setter_timing="on_change"
                    debounce_ms={0}
                    orientation="vertical"
                    valueLabelDisplay={z_variable_display}
                    valueLabelDisplayLocation="left"
                />
                <AdjustButtonContainer
                    wrapper_class_name={styles.z_rotation_button_wrapper}
                    label={t("config_page.vr.z_rotation")}
                    is_max={is_max_rotation_z}
                    is_min={is_min_rotation_z}
                    countUp={countUpRotationZ}
                    countDown={countDownRotationZ}
                />
            </div>
        </div>
    );
};

// Step buttons beside a VR position or rotation slider; `label` names the axis.
const AdjustButtonContainer = ({ wrapper_class_name, is_max, is_min, countUp, countDown, label, up_decreases = false }) => {
    const { t } = useI18n();
    const step = (disabled, run, key, extra) => (
        <div
            className={clsx(styles.button_wrapper, { [styles.is_disabled]: disabled, ...extra })}
            role="button" tabIndex={0} aria-disabled={disabled || undefined}
            aria-label={label ? t(`vr_panel.settings.${key}`, { label }) : undefined}
            onClick={run}
            onKeyDown={event => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); run(); } }}
        >
            <TriangleSvg className={styles.adjust_button_triangle_svg} aria-hidden="true" />
        </div>
    );
    return (
        <div className={wrapper_class_name}>
            {/* X rotation's upper button lowers the value; the names follow the action. */}
            {step(is_max, countUp, up_decreases ? "decrease" : "increase", { [styles.up]: true })}
            {step(is_min, countDown, up_decreases ? "increase" : "decrease", {})}
        </div>
    );
};


const OtherControls = ({settings, onChangeFunction, ui_configs}) => {
    const { t } = useI18n();

    const ui_variable_opacity = (settings.opacity * 100).toFixed(0);
    const ui_variable_ui_scaling = (settings.ui_scaling * 100).toFixed(0);

    return(
        <div className={styles.other_controls}>
            <div className={styles.other_controls_wrapper}>
                <p className={clsx(styles.other_controls_slider_label, styles.opacity_label)}>
                    {t("config_page.vr.opacity")}
                    <span className={styles.other_controls_value}>{ui_variable_opacity}%</span>
                </p>
                <Slider
                    aria-label={t("config_page.vr.opacity")}
                    className={clsx(styles.other_controls_slider, styles.opacity_slider)}
                    no_padding={true}
                    variable={settings.opacity * 100}
                    valueLabelFunction={(val) => val.toFixed(0)}
                    valueLabelFormat="value %"
                    step={5}
                    min={10}
                    max={100}
                    setterFunction={(value) => onChangeFunction("opacity", value / 100)}
                    setter_timing="on_change"
                    debounce_ms={0}
                />
            </div>
            <div className={styles.other_controls_wrapper}>
                <p className={clsx(styles.other_controls_slider_label, styles.ui_scaling_label)}>
                    {t("config_page.vr.ui_scaling")}
                    <span className={styles.other_controls_value}>{ui_variable_ui_scaling}%</span>
                </p>
                <Slider
                    aria-label={t("config_page.vr.ui_scaling")}
                    className={clsx(styles.other_controls_slider, styles.ui_scaling_slider)}
                    no_padding={true}
                    variable={settings.ui_scaling * 100}
                    valueLabelFunction={(val) => val.toFixed(0)}
                    valueLabelFormat="value %"
                    step={ui_configs.ui_scaling.step}
                    min={ui_configs.ui_scaling.min}
                    max={ui_configs.ui_scaling.max}
                    setterFunction={(value) => onChangeFunction("ui_scaling", value / 100)}
                    setter_timing="on_change"
                    debounce_ms={0}
                />
            </div>
            <div className={styles.other_controls_wrapper}>
                <p className={clsx(styles.other_controls_slider_label, styles.display_duration_label)}>{t("config_page.vr.display_duration")}
                    <span className={styles.other_controls_value}>{t("config_page.common.duration_seconds", { count: settings.display_duration })}</span></p>
                <Slider
                    aria-label={t("config_page.vr.display_duration")}
                    className={clsx(styles.other_controls_slider, styles.display_duration_slider)}
                    no_padding={true}
                    variable={settings.display_duration}
                    valueLabelFormat={value => t("config_page.common.duration_seconds", { count: value })}
                    step={1}
                    min={1}
                    max={60}
                    setterFunction={(value) => onChangeFunction("display_duration", value)}
                    setter_timing="on_change"
                    debounce_ms={0}
                />
            </div>
            <div className={styles.other_controls_wrapper}>
                <p className={clsx(styles.other_controls_slider_label, styles.fadeout_duration_label)}>{t("config_page.vr.fadeout_duration")}
                    <span className={styles.other_controls_value}>{t("config_page.common.duration_seconds", { count: settings.fadeout_duration })}</span></p>
                <Slider
                    aria-label={t("config_page.vr.fadeout_duration")}
                    className={clsx(styles.other_controls_slider, styles.fadeout_duration_slider)}
                    no_padding={true}
                    variable={settings.fadeout_duration}
                    valueLabelFormat={value => t("config_page.common.duration_seconds", { count: value })}
                    step={1}
                    min={0}
                    max={5}
                    setterFunction={(value) => onChangeFunction("fadeout_duration", value)}
                    setter_timing="on_change"
                    debounce_ms={0}
                />
            </div>
        </div>
    );
};


const CommonSettingsContainer = () => {
    const { t } = useI18n();
    const {
        currentOverlayShowOnlyTranslatedMessages,
        toggleOverlayShowOnlyTranslatedMessages,
        currentVoiceTypingMode,
        toggleVoiceTypingMode,
    } = useVr();

    return (
        <div className={styles.common_container}>
            <SectionLabelComponent sub label={t("config_page.vr.common_settings")} />
            <CheckboxContainer
                label={t("config_page.vr.overlay_show_only_translated_messages.label")}
                variable={currentOverlayShowOnlyTranslatedMessages}
                toggleFunction={toggleOverlayShowOnlyTranslatedMessages}
            />
            <CheckboxContainer
                label={t("config_page.vr.voice_typing_mode.label")}
                desc={t("config_page.vr.voice_typing_mode.desc")}
                variable={currentVoiceTypingMode}
                toggleFunction={toggleVoiceTypingMode}
            />
            <OverlayFontFamily />
        </div>
    );
};


const SendSampleTextToggleButton = () => {
    const { t } = useI18n();
    const { sendTextToOverlay } = useVr();
    const { currentIsOpenedConfigPage } = useIsOpenedConfigPage();
    const [is_started, setIsStarted] = useState(false);
    // Closing settings only hides this page; it stays mounted, so stop the
    // samples here. Reopening settings does not restart them: only this button
    // starts sending. The button follows is_sending, the same value as the
    // interval, so it never says "stop" while nothing is being sent.
    const is_settings_open = currentIsOpenedConfigPage.data === true;
    const is_sending = is_started && is_settings_open;

    useEffect(() => {
        if (!is_settings_open) setIsStarted(false);
    }, [is_settings_open]);

    useEffect(() => {
        if (!is_sending) return undefined;
        const interval_id = setInterval(() => {
            const text_data = Array.from(
                { length: randomIntMinMax(1, 5) },
                () => t("config_page.vr.sample_text_button.sample_text")
            ).join(" ");
            sendTextToOverlay(text_data);
        }, 1000);
        return () => clearInterval(interval_id);
    }, [is_sending]);

    const toggleFunction = () => {
        setIsStarted(is_settings_open && !is_started);
    };

    const label = is_sending
        ? t("config_page.vr.sample_text_button.stop")
        : t("config_page.vr.sample_text_button.start");

    // A plain button whose words say what pressing it does; the row beside it says why.
    return (
        <div className={styles.sample_text_button_wrapper}>
            <button
                type="button"
                className={clsx(styles.sample_text_button, { [styles.is_started]: is_sending })}
                onClick={toggleFunction}
                aria-label={label}
            >
                {is_sending ? (
                    <SquareSvg className={styles.sample_text_button_square_svg} aria-hidden="true" />
                ) : (
                    <TriangleSvg className={styles.sample_text_button_triangle_svg} aria-hidden="true" />
                )}
                {label}
            </button>
        </div>
    );
};



const useVariableControl = (key, settings, onChangeFunction, ui_configs) => {
    const [variable_display, setVariableDisplay] = useState("auto");

    const [is_max, setIsMax] = useState(settings[key] >= ui_configs[key].max);
    const [is_min, setIsMin] = useState(settings[key] <= ui_configs[key].min);

    const timerRef = useRef();

    useEffect(() => {
        return () => {
            clearTimeout(timerRef.current);
        };
    }, []);

    const triggerDisplay = () => {
        setVariableDisplay("on");
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
            setVariableDisplay("auto");
        }, 2000);
    };

    useEffect(() => {
        setIsMax(settings[key] >= ui_configs[key].max);
        setIsMin(settings[key] <= ui_configs[key].min);
    }, [settings[key]]);

    const countUp = () => {
        if (is_max) return;
        const step = ui_configs[key].step;
        const new_value = parseFloat((settings[key] + step).toFixed(2));
        onChangeFunction(key, new_value);
        triggerDisplay();
    };

    const countDown = () => {
        if (is_min) return;
        const step = ui_configs[key].step;
        const new_value = parseFloat((settings[key] - step).toFixed(2));
        onChangeFunction(key, new_value);
        triggerDisplay();
    };

    return {
        variable_display,
        is_max,
        is_min,
        countUp,
        countDown,
    };
};
