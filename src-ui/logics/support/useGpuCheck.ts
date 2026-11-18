import { atom, useAtom, useStore } from "jotai";
import { useCallback } from "react";
import { useStdoutToPython } from "@useStdoutToPython";
import { IDLE_GPU_CHECK, gpuCheckAfterAnswer, gpuCheckAfterState } from "./gpuCheck.ts";
import type { GpuCheckView } from "./gpuCheck.ts";

// The GPU check (#288). It runs only on the user's press, in the core, for a minute or more;
// the settings poll its state while it runs. Nothing is sent anywhere from here.
const gpuCheckAtom = atom<GpuCheckView>(IDLE_GPU_CHECK);

export const useGpuCheck = () => {
    const atoms = useStore();
    const [check] = useAtom(gpuCheckAtom);
    const { asyncStdoutToPython } = useStdoutToPython();

    const updateState = useCallback((value: unknown) => {
        atoms.set(gpuCheckAtom, view => gpuCheckAfterState(view, value));
    }, [atoms]);
    const updateAnswer = useCallback((value: unknown) => {
        atoms.set(gpuCheckAtom, view => gpuCheckAfterAnswer(view, value));
    }, [atoms]);
    const fail = useCallback((code: unknown) => {
        atoms.set(gpuCheckAtom, view => ({ ...view, phase: "idle", error: typeof code === "string" && code ? code : "gpu_check_failed" }));
    }, [atoms]);

    const start = useCallback(async () => {
        // The store, not this render's value: a second press may come before the next render.
        if (atoms.get(gpuCheckAtom).phase !== "idle") return false;
        atoms.set(gpuCheckAtom, view => ({ ...view, phase: "pending", error: null }));
        const sent = await asyncStdoutToPython("/run/start_gpu_check");
        if (sent === false) fail("backend_unavailable");
        return sent;
    }, [atoms, asyncStdoutToPython, fail]);
    const stop = useCallback(() => asyncStdoutToPython("/run/stop_gpu_check"), [asyncStdoutToPython]);
    const poll = useCallback(() => asyncStdoutToPython("/get/data/gpu_check_state"), [asyncStdoutToPython]);

    const reset = useCallback(() => atoms.set(gpuCheckAtom, IDLE_GPU_CHECK), [atoms]);
    // The engine stopped: a check in progress ended with it.
    const backendStopped = useCallback(() => {
        atoms.set(gpuCheckAtom, view => view.phase === "idle" ? view : { ...view, phase: "idle", error: "backend_unavailable" });
    }, [atoms]);

    return { check, start, stop, poll, updateState, updateAnswer, fail, reset, backendStopped };
};
