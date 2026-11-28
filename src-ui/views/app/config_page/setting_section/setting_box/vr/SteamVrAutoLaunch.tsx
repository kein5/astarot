import { useEffect } from "react";
import { useI18n } from "@useI18n";
import { useVr } from "@logics_configs";
import { useIsOpenedConfigPage } from "@logics_common";
import { SectionLabelComponent } from "../_components";
import { SwitchContainer } from "../_templates/Templates";
import { StableWords } from "../../../../../common_components/stable_words/StableWords";
import { STEAMVR_NOTES, steamVrSwitchView } from "../../../../../../logics/configs/steamVrAutoLaunch.ts";
import * as styles from "./Vr.css.ts";

// "Start with SteamVR" (#1384): SteamVR starts ASTAROT when it starts. SteamVR keeps the flag and
// its own startup settings change it too, so the page asks the core each time the settings open,
// and the core tells it when SteamVR comes or goes. A build SteamVR cannot start (the Linux
// packages, a development build) draws no row, so nobody is offered a switch that does nothing;
// the start-up's answers say so before the page first draws.
export const SteamVrAutoLaunch = () => {
    const { t } = useI18n();
    const { currentSteamVrAutoLaunchSupported, currentSteamVrAutoLaunch, getSteamVrAutoLaunch, toggleSteamVrAutoLaunch } = useVr();
    const { currentIsOpenedConfigPage } = useIsOpenedConfigPage();
    const supported = currentSteamVrAutoLaunchSupported.data === true;

    useEffect(() => {
        if (supported && currentIsOpenedConfigPage.data === true) getSteamVrAutoLaunch();
    }, [supported, currentIsOpenedConfigPage.data]);

    const view = steamVrSwitchView(supported, currentSteamVrAutoLaunch);
    if (!view.shown) return null;
    return (
        <div className={styles.common_container}>
            <SectionLabelComponent label={t("config_page.vr.section_label_steamvr")} />
            <SwitchContainer
                setting_id="steamvr_auto_launch"
                label={t("config_page.vr.steamvr_auto_launch.label")}
                desc={t("config_page.vr.steamvr_auto_launch.desc")}
                note={<StableWords words={STEAMVR_NOTES.map(key => t(key))} current={view.note === null ? "" : t(view.note)} align="start" />}
                variable={view.variable}
                is_available={view.available}
                toggleFunction={toggleSteamVrAutoLaunch}
            />
        </div>
    );
};
