import styles from "./ConnectionCheckButton.module.scss";
import { useI18n } from "@useI18n";
import { EnvReadout } from "../env_readout/EnvReadout";
import { StableWords } from "../../../../../../common_components/stable_words/StableWords";

// The connection state is an environment readout in words (DESIGN.md); its
// color repeats the words. The check is the shared secondary settings button. The words take the
// longest state's width, so the button beside them stays put while a check runs (#912).
export interface ConnectionCheckButtonProps {
    // true while the last check reached the server.
    variable?: boolean;
    // "pending" while a check runs.
    state?: string;
    checkFunction?: () => void;
    "aria-describedby"?: string;
}

const STATES = ["checking", "connected", "disconnected"] as const;

export const ConnectionCheckButton = (props: ConnectionCheckButtonProps) => {
    const { t } = useI18n();
    const pending = props.state === "pending";
    const state = pending ? "checking" : props.variable === true ? "connected" : "disconnected";

    return (
        <EnvReadout
            className={styles.container}
            tone={state === "connected" ? "active" : "neutral"}
            actions={
                <button aria-describedby={props["aria-describedby"]} type="button" className={styles.button} disabled={pending} onClick={props.checkFunction}>
                    {t("config_page.common.connection_check.button_label")}
                </button>
            }
        >
            <p><StableWords current={t(`config_page.common.connection_check.${state}`)}
                words={STATES.map(word => t(`config_page.common.connection_check.${word}`))} /></p>
        </EnvReadout>
    );
};
