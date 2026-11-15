import { store, useStore_BackendStartupState, useStore_BackendStartupFailure, useStore_IsBackendReady } from "@store";
import { startupPhase } from "./startupPhase.js";

export const useBackendStartup = () => {
    const { currentBackendStartupState } = useStore_BackendStartupState();
    const { currentBackendStartupFailure } = useStore_BackendStartupFailure();
    const { currentIsBackendReady } = useStore_IsBackendReady();
    const startupState = currentBackendStartupState.data;
    return {
        startupState,
        phase: startupPhase({ startupState, isBackendReady: currentIsBackendReady.data }),
        failure: currentBackendStartupFailure.data,
        retryStartup: () => store.backend_session_owner?.retry(),
    };
};
