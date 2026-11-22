import { useEffect, useRef } from "react";
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
    const { loadAppUpdateInfo, checkAppUpdate, switchAppUpdateChannel } = useAppUpdate();
    const ready = currentIsBackendReady.data === true;
    const enabled = currentEnableCheckSoftwareUpdates.data === true;

    useEffect(() => { loadAppUpdateInfo(); }, []);

    // The restart is not one the user asked for, so it is said first. The stop of the backend for
    // the installer raised the "stopped unexpectedly" notice; that one goes, as the restart answers it.
    const { t } = useI18n();
    const { showNotification_Error, dismissNotification } = useNotificationStatus();
    // The listener lives as long as the window, so it reads the latest of these. react-i18next
    // fixes t to the language it was drawn in, and the first drawing comes before the saved UI
    // language: a t kept from then would say the notice in the system's language.
    const latest = useRef({ t, showNotification_Error, dismissNotification });
    latest.current = { t, showNotification_Error, dismissNotification };
    useEffect(() => {
        let stop: (() => void) | null = null, gone = false;
        listen(UPDATE_RESTARTING_EVENT, () => {
            const { t, showNotification_Error, dismissNotification } = latest.current;
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

    // A channel the user sets is checked at once (#466): the user asked about updates, so the check
    // at start being off does not hold it back. The channel the settings came with is not a change.
    const channel = currentReleaseChannel.data ?? null;
    const lastChannel = useRef<string | null | undefined>(undefined);
    useEffect(() => {
        if (!ready) return;
        const before = lastChannel.current;
        lastChannel.current = channel;
        if (before !== undefined && before !== channel) void switchAppUpdateChannel(channel);
    }, [ready, channel]);

    return null;
};
