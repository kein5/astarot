import { useEffect, useState } from "react";
import { useI18n } from "@useI18n";
import { companionBridge, type CompanionBridge } from "../../logics/companion/bridge.ts";
import * as styles from "./CompanionHandle.css.ts";

// The small handle beside the captions in the tray companion (experimental feature
// "tray_companion", Issue #355). Its window never takes the focus; a click opens or closes
// the control panel.
export const CompanionHandle = ({ bridge = companionBridge }: { bridge?: CompanionBridge }) => {
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
        const changed = bridge.onChanged(() => { void refresh(); });
        changed.then(refresh, () => {});
        return () => { disposed = true; changed.then(off => off(), () => {}); };
    }, [bridge]);

    const label = t("companion.handle");
    return (
        <button type="button" className={styles.handle} data-listening={listening} aria-label={label} title={label}
            onClick={() => bridge.togglePanel().catch(error => console.warn("Companion panel could not be opened", error))}>
            <span className={styles.bars} aria-hidden="true">
                <i className={styles.bar} /><i className={styles.bar} /><i className={styles.bar} />
            </span>
        </button>
    );
};
