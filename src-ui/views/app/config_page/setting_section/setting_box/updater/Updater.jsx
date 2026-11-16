import { useEffect } from "react";
import { useI18n } from "@useI18n";
import { useSoftwareVersion, useNotificationStatus } from "@logics_common";
import { useOthers } from "@logics_configs";
import { useAppUpdate } from "../../../../../../logics/common/useAppUpdate";
import { downloadPercent } from "../../../../../../logics/common/appUpdate.ts";
import styles from "./Updater.module.scss";
import { SectionLabelComponent } from "../_components";
import { EnvReadout } from "../_components/env_readout/EnvReadout";
import { _OpenWebpageButton } from "../_components/_atoms/_open_webpage_button/_OpenWebpageButton";
import { CheckboxContainer } from "../_templates/Templates";

const RELEASES_URL = "https://github.com/kein5/VRCT-VOX/releases";
const BUSY = ["checking", "downloading", "installing"];
const OFFERED = ["available", "downloading", "installing"];

// What this copy can do about updates, from how it was installed (src-tauri/src/app_update.rs):
// the installer and the AppImage update here, the ZIP and the tar.gz are told and link to the
// release page, a deb or rpm is updated by its package manager and never checks.
const policyKey = info => {
    if (!info) return null;
    if (info.mode === "install") return "install";
    if (info.mode === "package_manager") return "package_manager";
    if (["windows_portable", "linux_archive", "appimage_read_only"].includes(info.kind)) return info.kind;
    return "disabled";
};

const statusLine = (t, state) => {
    switch (state.status) {
        case "checking": return t("app_update.status.checking");
        case "up_to_date": return t("app_update.status.up_to_date");
        case "available": return t("app_update.status.available", { version: state.version });
        case "downloading": {
            const percent = downloadPercent(state.progress);
            return percent === null
                ? t("app_update.status.downloading")
                : t("app_update.status.downloading_percent", { percent });
        }
        case "installing": return t("app_update.status.installing");
        default: return null;
    }
};

const toneOf = state => {
    if (state.error) return "failed";
    if (OFFERED.includes(state.status)) return "active";
    return "neutral";
};

export const Updater = () => {
    const { t } = useI18n();
    const { currentSoftwareVersion } = useSoftwareVersion();
    const { showNotification_Error } = useNotificationStatus();
    const { currentEnableCheckSoftwareUpdates, toggleEnableCheckSoftwareUpdates } = useOthers();
    const { appUpdate, loadAppUpdateInfo, checkAppUpdate, installAppUpdate } = useAppUpdate();

    useEffect(() => { loadAppUpdateInfo(); }, []);

    const info = appUpdate.info;
    const policy = policyKey(info);
    const checks = info?.mode === "install" || info?.mode === "manual";
    const busy = BUSY.includes(appUpdate.status);
    const canInstall = info?.mode === "install" && OFFERED.includes(appUpdate.status);
    const version = info?.current_version ?? currentSoftwareVersion.data;
    const status = statusLine(t, appUpdate);

    const install = async () => {
        const code = await installAppUpdate();
        // The app is still the old one and keeps running; say why in a notice too.
        if (code) showNotification_Error(t(`app_update.errors.${code}`), { category_id: "app_update" });
    };

    return (
        <div className={styles.container}>
            <SectionLabelComponent label={t("config_page.side_menu_labels.updater")} />
            <EnvReadout tone={toneOf(appUpdate)} progress={busy ? "working" : undefined}>
                <p>
                    ASTAROT {version}
                    {info?.channel === "beta" && <span className={styles.channel}> {t("app_update.beta_channel")}</span>}
                </p>
                {status && <p>{status}</p>}
                {appUpdate.error && <p>{t(`app_update.errors.${appUpdate.error}`)}</p>}
            </EnvReadout>
            {policy && <p className={styles.policy}>{t(`app_update.policy.${policy}`)}</p>}
            {checks &&
                <div className={styles.actions}>
                    {canInstall &&
                        <button type="button" className={styles.install_button} disabled={busy} onClick={install}>
                            {t("app_update.install", { version: appUpdate.version })}
                        </button>}
                    <button type="button" className={styles.check_button} disabled={busy} onClick={() => checkAppUpdate()}>
                        {t("app_update.check")}
                    </button>
                </div>}
            <_OpenWebpageButton
                webpage_url={appUpdate.release_url ?? RELEASES_URL}
                open_webpage_label={appUpdate.release_url
                    ? t("app_update.release_page", { version: appUpdate.version })
                    : t("fork_distribution.releases")}
            />
            {checks &&
                <CheckboxContainer
                    setting_id="check_software_updates"
                    label={t("app_update.check_at_start")}
                    desc={t("app_update.check_at_start_desc")}
                    variable={currentEnableCheckSoftwareUpdates}
                    toggleFunction={toggleEnableCheckSoftwareUpdates}
                />}
        </div>
    );
};
