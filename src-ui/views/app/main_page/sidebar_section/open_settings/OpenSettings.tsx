import { useI18n } from "@useI18n";
import * as styles from "./OpenSettings.css.ts";
import { useOpenSettings } from "../../../../../logics/common/useOpenSettings.ts";
import ConfigurationSvg from "@images/configuration.svg?react";
import { Tooltip } from "../../../../common_components/tooltip/Tooltip";
import { Button } from "../../../../kit/index.ts";

export const OpenSettings = () => {
    const { t } = useI18n();
    // The settings window in the app, opened or brought to the front (#1236); the page in a browser.
    const openSettings = useOpenSettings();
    const openConfigPage = () => openSettings();

    return (
        <div className={styles.container}>
            <Tooltip bare placement="right" title={t("studio.open_settings")}>
                <Button size="icon" data-open-settings aria-label={t("studio.open_settings")} onClick={openConfigPage}>
                    <ConfigurationSvg aria-hidden="true" className={styles.configurationSvg} />
                </Button>
            </Tooltip>
        </div>
    );
};
