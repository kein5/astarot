import { useStdoutToPython } from "@useStdoutToPython";

export const useUpdateSoftware = () => {
    const { asyncStdoutToPython } = useStdoutToPython();
    // target_version: the version to install, as the update page offers it.
    // There is one package (#288). The core keeps /run/update_cuda_software for the IPC
    // contract, but it makes the same update, so the UI no longer calls it.
    const updateSoftware = (target_version?: unknown) => {
        asyncStdoutToPython("/run/update_software", target_version);
    };

    return {
        updateSoftware,
    };
};
