import { useEffect } from "react";

import { useI18n } from "@useI18n";
import { useAppearance } from "@logics_configs";
import { useIsBackendReady } from "@logics_common";

// waitForEngine (the main window): keep the provisional language from
// locales/config.js until the engine has sent the saved one, instead of
// switching to the setting's built-in default first.
export const UiLanguageController = ({ waitForEngine = false } = {}) => {
    const { currentUiLanguage } = useAppearance();
    const { currentIsBackendReady } = useIsBackendReady();
    const { i18n } = useI18n();
    const waiting = waitForEngine && currentIsBackendReady.data !== true;

    useEffect(() => {
        if (waiting) return;
        i18n.changeLanguage(currentUiLanguage.data);
    }, [currentUiLanguage.data, waiting]);
    return null;
};