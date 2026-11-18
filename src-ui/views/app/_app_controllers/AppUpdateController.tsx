import { useEffect } from "react";
import { useIsBackendReady } from "@logics_common";
import { useOthers } from "@logics_configs";
import { useAppUpdate } from "../../../logics/common/useAppUpdate";

// Checks for a new version once per run, after the backend has delivered the settings and only
// while "Check for updates at start" is on. A failure here stays quiet (the update page says it
// when the user checks); a found update shows in the top bar.
let checkedThisRun = false;

export const AppUpdateController = () => {
    const { currentIsBackendReady } = useIsBackendReady();
    const { currentEnableCheckSoftwareUpdates } = useOthers();
    const { loadAppUpdateInfo, checkAppUpdate } = useAppUpdate();
    const ready = currentIsBackendReady.data === true;
    const enabled = currentEnableCheckSoftwareUpdates.data === true;

    useEffect(() => { loadAppUpdateInfo(); }, []);

    useEffect(() => {
        if (!ready || !enabled || checkedThisRun) return;
        checkedThisRun = true;
        checkAppUpdate({ silent: true });
    }, [ready, enabled]);

    return null;
};
