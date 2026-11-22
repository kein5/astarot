import { useI18n } from "@useI18n";
import { useIsBackendReady } from "@logics_common";
import { useIsMainPageCompactMode } from "@logics_main";
import WarningSvg from "@images/warning.svg?react";
import { useIsStartingUp } from "../../startupContext";
import { EnvReadout } from "../../../config_page/setting_section/setting_box/_components/env_readout/EnvReadout";
import { Tooltip } from "../../../../common_components/tooltip/Tooltip";
import * as styles from "./EngineReadout.css.ts";

// The engine is gone: every switch of the rail is greyed out for the one same reason. The rail
// says it once, at its head (#766), not under each switch, so no row grows and the reason is
// announced once. Each switch keeps the words in its own name and tooltip (MainFunctionSwitch).
// While the engine starts, the switches are placeholders and nothing is said here.
// The icon rail has no room for the words: a warning mark stands for them, with the words as
// its name and its tooltip, and it takes keyboard focus so the tooltip can be opened.
export const EngineReadout = () => {
    const { t } = useI18n();
    const { currentIsBackendReady } = useIsBackendReady();
    const { currentIsMainPageCompactMode } = useIsMainPageCompactMode();
    const starting = useIsStartingUp();
    if (currentIsBackendReady.data === true || starting) return null;
    const words = t("main_page.backend_disconnected");
    if (currentIsMainPageCompactMode.data) return (
        <div className={styles.compact} role="status">
            <Tooltip bare placement="right" title={words}>
                <span className={styles.mark} role="img" aria-label={words} tabIndex={0}>
                    <WarningSvg aria-hidden="true" className={styles.markSvg} />
                </span>
            </Tooltip>
        </div>
    );
    return <EnvReadout tone="warning" className={styles.readout}>{words}</EnvReadout>;
};
