import { useI18n } from "@useI18n";
import * as styles from "./OpenSettings.css.ts";
import { useIsOpenedConfigPage } from "@logics_common";
import ConfigurationSvg from "@images/configuration.svg?react";
import { Tooltip } from "../../../../common_components/tooltip/Tooltip";

export const OpenSettings = () => {
    const { t } = useI18n();
    const { setIsOpenedConfigPage } = useIsOpenedConfigPage();

    const openConfigPage = () => {
        setIsOpenedConfigPage(true);
    };

    return (
        <div className={styles.container}>
            <Tooltip bare placement="right" title={t("studio.open_settings")}>
                <button data-open-settings type="button" aria-label={t("studio.open_settings")} className={styles.openConfigPageButton} onClick={openConfigPage}>
                    <ConfigurationSvg aria-hidden="true" className={styles.configurationSvg} />
                </button>
            </Tooltip>
        </div>
    );
};
