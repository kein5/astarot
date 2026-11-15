import { useEffect, useState } from "react";
import clsx from "clsx";
import { useI18n } from "@useI18n";
import { companionBridge } from "../../logics/companion/bridge";
import styles from "./CompanionHandle.module.scss";

// The small handle beside the captions in the experimental companion form (Issue #355).
// Faint until the pointer is on it, so it does not draw the eye from the captions.
// Its window never takes the focus; a click opens or closes the control panel.
export const CompanionHandle = ({ bridge = companionBridge }) => {
    const { t, i18n } = useI18n();
    const [listening, setListening] = useState(false);

    useEffect(() => {
        let disposed = false;
        const refresh = async () => {
            try {
                const status = await bridge.status();
                if (disposed) return;
                if (status.language !== i18n.language) await i18n.changeLanguage(status.language);
                setListening(status.ready && status.mic.on);
            } catch (error) { console.warn("Companion handle could not read the state", error); }
        };
        const changed = bridge.onChanged(refresh);
        changed.then(refresh, () => {});
        return () => { disposed = true; changed.then(off => off(), () => {}); };
    }, [bridge]);

    const label = t("companion.handle");
    return (
        <button type="button" className={clsx(styles.handle, { [styles.is_listening]: listening })}
            aria-label={label} title={label}
            onClick={() => bridge.togglePanel().catch(error => console.warn("Companion panel could not be opened", error))}>
            <span className={styles.bars} aria-hidden="true"><i /><i /><i /></span>
        </button>
    );
};
