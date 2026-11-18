import { useStdoutToPython } from "@useStdoutToPython";

export const useUpdateSoftware = () => {
    const { asyncStdoutToPython } = useStdoutToPython();
    // target_version: the version to install, as the update page offers it.
    const updateSoftware = (target_version?: unknown) => {
        asyncStdoutToPython("/run/update_software", target_version);
    };

    const updateSoftware_CUDA = (target_version?: unknown) => {
        asyncStdoutToPython("/run/update_cuda_software", target_version);
    };

    return {
        updateSoftware,
        updateSoftware_CUDA,
    };
};
