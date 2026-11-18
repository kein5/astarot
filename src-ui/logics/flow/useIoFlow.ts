import { useCallback } from "react";
import { getDefaultStore } from "jotai";
import { Atom_IoFlow, Atom_IoTraces, useStore_IoFlow, useStore_IoTraces, useStore_IsOpenedIoFlowPanel } from "@store";
import { mergeTrace } from "./ioFlow.ts";
import type { IoFlow, TraceCandidate } from "./ioFlow.ts";

// The map as /get/data/io_flow sends it. Only the two lanes are checked, as before; the panel
// reads their fields with fallbacks.
const hasBothLanes = (result: unknown): result is IoFlow => typeof result === "object" && result !== null
    && "voice" in result && !!result.voice && "chat" in result && !!result.chat;

// The flow panel's state lives in registered atoms, so the VR window mirrors it as it is.
export const useIoFlow = () => {
    const { currentIoFlow } = useStore_IoFlow();
    const { currentIoTraces } = useStore_IoTraces();
    const { currentIsOpenedIoFlowPanel, updateIsOpenedIoFlowPanel } = useStore_IsOpenedIoFlowPanel();

    // Polled every second; an unchanged map is not set again (the VR mirror sends every change).
    const updateIoFlow = useCallback((result: unknown) => {
        if (!hasBothLanes(result)) return;
        const atoms = getDefaultStore();
        const previous = atoms.get(Atom_IoFlow);
        if (previous.state === "ok" && JSON.stringify(previous.data) === JSON.stringify(result)) return;
        atoms.set(Atom_IoFlow, { state: "ok", data: result });
    }, []);

    const addIoTrace = useCallback((trace: TraceCandidate | null | undefined) => {
        const atoms = getDefaultStore();
        const previous = atoms.get(Atom_IoTraces);
        const next = mergeTrace(previous.data, trace);
        // mergeTrace gives back the list it was given (never null here) when the trace is not one.
        if (next && next !== previous.data) atoms.set(Atom_IoTraces, { state: "ok", data: next });
    }, []);

    return {
        currentIoFlow, currentIoTraces, updateIoFlow, addIoTrace,
        isPanelOpen: currentIsOpenedIoFlowPanel.data === true,
        togglePanel: () => updateIsOpenedIoFlowPanel(open => !(open.data === true)),
    };
};
