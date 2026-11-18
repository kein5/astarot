import { useCallback } from "react";
import { getDefaultStore } from "jotai";
import { Atom_GpuMemory, useStore_GpuMemory } from "@store";
import { readGpuMemory } from "./gpuMemory.ts";

// The GPUs' memory of the flow panel (#448). Kept apart from useIoFlow: the VR window reads that
// hook, and this state is the main window's only, so it is never mirrored to VR.
export const useGpuMemory = () => {
    const { currentGpuMemory } = useStore_GpuMemory();

    // Polled every 2 s while the panel is open. The age changes on every answer, so only the
    // state and the numbers decide whether the panel draws again.
    const updateGpuMemory = useCallback(result => {
        const memory = readGpuMemory(result);
        if (!memory) return;
        const atoms = getDefaultStore();
        const previous = atoms.get(Atom_GpuMemory);
        const same = previous.state === "ok" && previous.data?.state === memory.state
            && JSON.stringify(previous.data?.gpus) === JSON.stringify(memory.gpus);
        if (!same) atoms.set(Atom_GpuMemory, { state: "ok", data: memory });
    }, []);

    return { currentGpuMemory, updateGpuMemory };
};
