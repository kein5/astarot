import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useI18n } from "@useI18n";
import { useIsBackendReady, useNotificationStatus } from "@logics_common";
import { useExperimentalFeatures, useOthers } from "@logics_configs";
import { useAppUpdate } from "../../../logics/common/useAppUpdate";

// Rust says this when an update stopped the backend for the installer and the installer did not
// start (src-tauri/src/app_update.rs): the app restarts a few seconds later as it was (#561).
export const UPDATE_RESTARTING_EVENT = "app-update-restarting";

// Checks for a new version once per run, after the backend has delivered the settings and only
// while "Check for updates at start" is on. A failure here stays quiet (the update page says it
// when the user checks); a found update shows in the top bar.
let checkedThisRun = false;

export const AppUpdateController = () => {
    const { currentIsBackendReady } = useIsBackendReady();
    const { currentEnableCheckSoftwareUpdates } = useOthers();
    const { currentReleaseChannel } = useExperimentalFeatures();
    const { loadAppUpdateInfo, checkAppUpdate } = useAppUpdate();
    const ready = currentIsBackendReady.data === true;
    const enabled = currentEnableCheckSoftwareUpdates.data === true;

    useEffect(() => { loadAppUpdateInfo(); }, []);

    // The restart is not one the user asked for, so it is said first. The stop of the backend for
    // the installer raised the "stopped unexpectedly" notice; that one goes, as the restart answers it.
    const { t } = useI18n();
    const { showNotification_Error, dismissNotification } = useNotificationStatus();
    useEffect(() => {
        let stop: (() => void) | null = null, gone = false;
        listen(UPDATE_RESTARTING_EVENT, () => {
            dismissNotification("backend_stopped");
            showNotification_Error(t("app_update.restarting_after_failure"), { hide_duration: null, category_id: "app_update_restarting" });
        }).then(unlisten => { if (gone) unlisten(); else stop = unlisten; }).catch(() => {});
        return () => { gone = true; stop?.(); };
    }, []);

    useEffect(() => {
        if (!ready || !enabled || checkedThisRun) return;
        checkedThisRun = true;
        // The channel came with the settings, before the backend was ready (#466).
        checkAppUpdate({ silent: true, channel: currentReleaseChannel.data ?? null });
    }, [ready, enabled]);

    return null;
};
