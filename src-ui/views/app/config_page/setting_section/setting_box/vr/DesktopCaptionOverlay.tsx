import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useI18n } from "@useI18n";
import { useVr } from "@logics_configs";
import { ui_configs } from "@ui_configs";
import { SectionLabelComponent } from "../_components";
import { ActionButtonContainer, SwitchContainer, RadioButtonContainer, SliderContainer } from "../_templates/Templates";
import { placementOf } from "../../../../../../logics/captionOverlay/adjust";
import type { OverlayDesktopSettings, SettingValues } from "../../../../../../logics/configs/config_page_setter/settingTypes.ts";
import RedoSvg from "@images/redo.svg?react";
import CheckMarkSvg from "@images/check_mark.svg?react";
import * as styles from "./Vr.css.ts";

// Captions over the desktop, for VRChat without a headset. The section is
// shown only where the overlay window exists (Windows for now), so nobody is
// offered a switch that does nothing.
// part: "enable" is the switch, in sight on the page; "details" is where the captions sit and
// how they look, in the page's 「詳細設定」 (#554).
type IoFlowOverlaySettings = SettingValues["IoFlowOverlaySettings"];

type DesktopCaptionOverlayProps = {
    part: "enable" | "details";
};

export const DesktopCaptionOverlay = ({ part }: DesktopCaptionOverlayProps) => {
    const { t } = useI18n();
    const {
        currentIsEnabledOverlayDesktop,
        toggleIsEnabledOverlayDesktop,
        currentOverlayDesktopSettings,
        setOverlayDesktopSettings,
        currentOverlayDesktopPlacement,
        setOverlayDesktopPlacement,
        currentIoFlowOverlaySettings,
        setIoFlowOverlaySettings,
    } = useVr();
    const [supported, setSupported] = useState(false);
    useEffect(() => {
        let disposed = false;
        invoke("caption_overlay_supported").then(value => { if (!disposed) setSupported(value === true); }, () => {});
        return () => { disposed = true; };
    }, []);
    if (!supported) return null;

    const settings = currentOverlayDesktopSettings.data;
    const state = currentOverlayDesktopSettings.state;
    const change = <K extends keyof OverlayDesktopSettings>(key: K, value: OverlayDesktopSettings[K]) =>
        setOverlayDesktopSettings({ ...settings, [key]: value });
    const moved = placementOf(currentOverlayDesktopPlacement?.data) !== null;
    const unplace = () => setOverlayDesktopPlacement(ui_configs.overlay_desktop_default_placement);
    // Choosing an edge puts a dragged window back on it, so the choice is seen to work.
    const choosePosition = (value: string) => {
        change("position", value);
        if (moved) unplace();
    };
    // Undoes what Ctrl and a drag or + / - changed; the edge and the other settings stay.
    const resetAdjustment = async () => {
        const size = ui_configs.overlay_desktop_default_settings.font_size;
        await Promise.all([
            moved ? unplace() : null,
            settings.font_size !== size ? setOverlayDesktopSettings({ ...settings, font_size: size }) : null,
        ]);
    };
    // The flow strip shares the caption window; it can be on while captions are off.
    const flow = currentIoFlowOverlaySettings.data;
    const flowState = currentIoFlowOverlaySettings.state;
    const changeFlow = <K extends keyof IoFlowOverlaySettings>(key: K, value: IoFlowOverlaySettings[K]) =>
        setIoFlowOverlaySettings({ ...flow, [key]: value });
    if (part === "enable") return (
        <div className={styles.common_container}>
            <SectionLabelComponent label={t("config_page.vr.section_label_desktop_overlay")} />
            <SwitchContainer
                setting_id="desktop_overlay"
                label={t("config_page.vr.desktop_overlay.label")}
                desc={t("config_page.vr.desktop_overlay.desc")}
                variable={currentIsEnabledOverlayDesktop}
                toggleFunction={toggleIsEnabledOverlayDesktop}
            />
        </div>
    );
    return (
        <div className={styles.common_container}>
            <SectionLabelComponent sub label={t("config_page.vr.section_label_desktop_overlay")} />
            <RadioButtonContainer
                setting_id="desktop_overlay_position"
                label={t("config_page.vr.desktop_overlay_position.label")}
                desc={t("config_page.vr.desktop_overlay_position.desc")}
                selectFunction={choosePosition}
                name="desktop_overlay_position"
                options={[
                    { id: "bottom", label: t("config_page.vr.desktop_overlay_position.bottom") },
                    { id: "top", label: t("config_page.vr.desktop_overlay_position.top") },
                ]}
                checked_variable={{ data: settings.position, state }}
            />
            <SliderContainer
                setting_id="desktop_overlay_font_size"
                label={t("config_page.vr.desktop_overlay_font_size.label")}
                desc={t("config_page.vr.desktop_overlay_font_size.desc")}
                valueLabelFormat="value px"
                state={state}
                variable={settings.font_size}
                setterFunction={value => change("font_size", value)}
                min={16}
                max={72}
                step={2}
                show_label_values={[16, 28, 40, 56, 72]}
            />
            <ActionButtonContainer
                setting_id="desktop_overlay_reset_adjustment"
                label={t("config_page.vr.desktop_overlay_reset_adjustment.label")}
                desc={t("config_page.vr.desktop_overlay_reset_adjustment.desc")}
                IconComponent={RedoSvg}
                ClickedIconComponent={CheckMarkSvg}
                clicked_duration={1000}
                onclickFunction={resetAdjustment}
            />
            <SliderContainer
                setting_id="desktop_overlay_display_duration"
                label={t("config_page.vr.desktop_overlay_display_duration.label")}
                valueLabelFormat={value => t("config_page.common.duration_seconds", { count: Number(value) })}
                state={state}
                variable={settings.display_duration}
                setterFunction={value => change("display_duration", value)}
                min={1}
                max={60}
                step={1}
                show_label_values={[1, 10, 20, 30, 40, 50, 60]}
            />
            <SliderContainer
                setting_id="desktop_overlay_opacity"
                label={t("config_page.vr.desktop_overlay_opacity.label")}
                desc={t("config_page.vr.desktop_overlay_opacity.desc")}
                valueLabelFormat="value %"
                state={state}
                variable={Math.round(settings.opacity * 100)}
                setterFunction={value => change("opacity", value / 100)}
                min={0}
                max={100}
                step={5}
                show_label_values={[0, 20, 40, 60, 80, 100]}
            />
            <SwitchContainer
                setting_id="io_flow_overlay"
                label={t("io_flow.settings.desktop")}
                desc={t("io_flow.settings.desktop_description")}
                variable={{ data: flow.desktop === true, state: flowState }}
                toggleFunction={() => changeFlow("desktop", flow.desktop !== true)}
            />
            <RadioButtonContainer
                setting_id="io_flow_overlay_count"
                label={t("io_flow.settings.count")}
                selectFunction={value => changeFlow("count", value)}
                name="io_flow_overlay_count"
                options={[1, 2, 3].map(count => ({ id: count, label: t("io_flow.settings.count_value", { count }) }))}
                checked_variable={{ data: flow.count, state: flowState }}
            />
        </div>
    );
};
