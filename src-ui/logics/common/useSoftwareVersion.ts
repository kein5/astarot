import { useStore_SoftwareVersion, useStore_LatestSoftwareVersionInfo } from "@store";
import { useStdoutToPython } from "@useStdoutToPython";

// /run/software_update_info (docs/spec/external-interfaces.md): whether a newer version is out, and which.
export interface SoftwareUpdateInfo {
    is_update_available: boolean;
    new_version?: string | null;
}

export const useSoftwareVersion = () => {
    const { asyncStdoutToPython } = useStdoutToPython();
    const { currentLatestSoftwareVersionInfo, updateLatestSoftwareVersionInfo } = useStore_LatestSoftwareVersionInfo();
    const { currentSoftwareVersion, updateSoftwareVersion, pendingSoftwareVersion } = useStore_SoftwareVersion();

    const getSoftwareVersion = () => {
        pendingSoftwareVersion();
        asyncStdoutToPython("/get/data/version");
    };

    const updateSoftwareVersionInfo = (payload: SoftwareUpdateInfo) => {
        updateLatestSoftwareVersionInfo(prev => ({
            is_update_available: payload.is_update_available,
            new_version: payload.new_version || prev.data.new_version,
        }));
    };

    return {
        currentSoftwareVersion,
        getSoftwareVersion,
        updateSoftwareVersion,

        updateSoftwareVersionInfo,
        currentLatestSoftwareVersionInfo,
        updateLatestSoftwareVersionInfo,
    };
};
