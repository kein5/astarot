import { useEffect } from "react";
import { store } from "@store";
import { useStdoutToPython } from "@useStdoutToPython";
import { useIsBackendReady } from "@logics_common";
import { useVr } from "@logics_configs";
import { useIoFlow } from "../../../logics/flow/useIoFlow";
import { GPU_MEMORY_POLL_MS } from "../../../logics/flow/gpuMemory.ts";

// The route map follows the settings, so it is read again every second while something
// shows it: the panel in this window, the desktop strip, or the VR window (which mirrors it).
// Stage times need no polling; the backend pushes them as messages go out.
export const IoFlowController = () => {
    const { asyncStdoutToPython } = useStdoutToPython();
    const { currentIsBackendReady } = useIsBackendReady();
    const { currentIsEnabledOverlayVrPanel, currentIoFlowOverlaySettings } = useVr();
    const { isPanelOpen } = useIoFlow();
    const shown = isPanelOpen || currentIoFlowOverlaySettings.data?.desktop === true
        || currentIsEnabledOverlayVrPanel.data === true;
    const ready = currentIsBackendReady.data === true;

    useEffect(() => {
        if (!ready || !shown) return undefined;
        const read = () => { if (!store.backend_stopped) asyncStdoutToPython("/get/data/io_flow"); };
        read();
        const timer = setInterval(read, 1000);
        return () => clearInterval(timer);
    }, [ready, shown]);

    // The GPUs' memory only while the panel in this window is open: the backend reads nothing
    // otherwise (#448). The desktop strip and the VR window do not show it.
    useEffect(() => {
        if (!ready || !isPanelOpen) return undefined;
        const read = () => { if (!store.backend_stopped) asyncStdoutToPython("/get/data/gpu_memory"); };
        read();
        const timer = setInterval(read, GPU_MEMORY_POLL_MS);
        return () => clearInterval(timer);
    }, [ready, isPanelOpen]);

    return null;
};
