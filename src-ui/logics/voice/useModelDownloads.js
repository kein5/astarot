import { atom, useAtom, useStore } from "jotai";
import { useCallback, useRef } from "react";
import { useStdoutToPython } from "@useStdoutToPython";
import { acceptObservation, resetObservations, sameSnapshot } from "../common/polledState.ts";

const catalogAtom = atom(null), stateAtom = atom({ observation_id: "0", jobs: {} });
const errorAtom = atom(null), pendingAtom = atom(null);
const hardwareAtom = atom({ phase: 'unknown', devices: [], observation_id: '0' });
// The models the user registered under a name (#403): {models: [...]} as the backend sends it,
// null until the first answer.
const userModelsAtom = atom(null);
// Apply requests whose reply did not come in time (#563). Each is let go once a later state
// shows its job no longer verifying: the job was applied, failed or cancelled, or never left
// "ready", so a new command cannot overlap it. Without this, a lost reply kept every other
// download command blocked until a restart.
const overdueApplies = new WeakSet();
const APPLYING = ["verifying", "cancelling"];
const stillApplying = (request, jobs) => {
    const job = jobs?.[request.id];
    return job?.job_id === request.job_id && APPLYING.includes(job.phase);
};

export const useModelDownloads = () => {
    const store = useStore();
    const [catalog, setCatalog] = useAtom(catalogAtom), [state] = useAtom(stateAtom);
    const [error, setError] = useAtom(errorAtom), [pending, setPending] = useAtom(pendingAtom);
    const [hardware] = useAtom(hardwareAtom);
    const [userModels] = useAtom(userModelsAtom);
    const { asyncStdoutToPython } = useStdoutToPython();
    const transport = useRef(asyncStdoutToPython);
    transport.current = asyncStdoutToPython;
    const updateCatalog = useCallback(value => setCatalog(value), [setCatalog]);
    const updateHardware = useCallback(value => {
        if (!Array.isArray(value?.devices) || !acceptObservation(store, hardwareAtom, value)) return;
        store.set(hardwareAtom, previous => sameSnapshot(previous, value) ? previous : value);
    }, [store]);
    const updateState = useCallback(value => {
        if (!value?.jobs || !acceptObservation(store, stateAtom, value)) return false;
        store.set(stateAtom, previous => sameSnapshot(previous, value) ? previous : value);
        const pending = store.get(pendingAtom);
        if (pending?.some(request => overdueApplies.has(request) && !stillApplying(request, value.jobs))) {
            const remaining = pending.filter(request => !overdueApplies.has(request) || stillApplying(request, value.jobs));
            store.set(pendingAtom, remaining.length ? remaining : null);
        }
        return true;
    }, [store]);
    const settle = useCallback(endpoint => {
        setPending(previous => {
            if (!previous?.some(request => request.endpoint === endpoint)) return previous;
            const remaining = previous?.filter(request => request.endpoint !== endpoint);
            return remaining?.length ? remaining : null;
        });
    }, [setPending]);
    const acknowledge = useCallback((value, endpoint) => {
        // A poll can overtake the command response; it must not roll back state.
        updateState(value);
        settle(endpoint);
        setError(previous => previous === "request_unconfirmed" ? null : previous);
    }, [updateState, settle, setError]);
    const updateUserModels = useCallback(value => {
        if (Array.isArray(value?.models)) store.set(userModelsAtom, value);
    }, [store]);
    // The answer to a registration, a removal or a switch: the list as it is now.
    const acknowledgeUserModels = useCallback((value, endpoint) => {
        updateUserModels(value);
        settle(endpoint);
        setError(previous => previous === "request_unconfirmed" ? null : previous);
    }, [updateUserModels, settle, setError]);
    const updateError = useCallback((value, endpoint = "") => {
        setError(value); settle(endpoint);
        if (value && endpoint.includes("model_download_hardware"))
            store.set(hardwareAtom, previous => ({ ...previous, phase: "failed", error_code: value }));
    }, [store, setError, settle]);
    // No reply in time (#431): say so, and release the commands whose effect the state poll
    // shows anyway (start, cancel, the user's models), so the buttons work again. A pending
    // Apply stays while the polls show its job verifying (that can take this long, and its
    // Cancel is still allowed meanwhile); the next poll that shows it done releases it (#563).
    const expireUnconfirmed = useCallback(() => {
        setError("request_unconfirmed");
        setPending(previous => {
            const remaining = previous?.filter(request => request.endpoint === "/run/apply_model_download");
            remaining?.forEach(request => overdueApplies.add(request));
            return remaining?.length ? remaining : null;
        });
    }, [setError, setPending]);
    const backendStopped = useCallback(() => {
        updateError("backend_unavailable");
        store.set(pendingAtom, null);
        store.set(stateAtom, value => ({ ...value, jobs: Object.fromEntries(Object.entries(value.jobs).map(([id, job]) =>
            [id, ["queued", "downloading", "verifying", "cancelling"].includes(job.phase)
                ? { ...job, phase: "failed", error_code: "backend_unavailable" } : job])) }));
        store.set(hardwareAtom, value => value.phase === "probing" ? { ...value, phase: "failed", error_code: "backend_unavailable" } : value);
    }, [store, updateError]);
    const reset = useCallback(() => {
        resetObservations(store, [stateAtom, hardwareAtom]);
        store.set(catalogAtom, null); store.set(stateAtom, { observation_id: "0", jobs: {} });
        store.set(userModelsAtom, null);
        store.set(errorAtom, null); store.set(pendingAtom, null);
        store.set(hardwareAtom, { phase: 'unknown', devices: [], observation_id: '0' });
    }, [store]);
    const send = useCallback(async (endpoint, data) => {
        const isHardware = endpoint.includes('model_download_hardware');
        let request;
        if (endpoint.startsWith("/run/") && !isHardware) {
            const pending = store.get(pendingAtom);
            if (pending && !(endpoint === "/run/cancel_model_download" && pending.every(item =>
                item.endpoint === "/run/apply_model_download" && item.id === data.id && item.job_id === data.job_id))) return;
            request = { endpoint, id: data.id, job_id: data.job_id };
            setError(null); setPending([...(pending ?? []), request]);
        }
        if (isHardware && endpoint.startsWith('/run/')) store.set(hardwareAtom, { ...store.get(hardwareAtom), phase: 'probing' });
        if (!await transport.current(endpoint, data)) {
            if (isHardware) store.set(hardwareAtom, { ...store.get(hardwareAtom), phase: 'failed', error_code: 'backend_unavailable' });
            else if (!request || store.get(pendingAtom)?.includes(request)) updateError("backend_unavailable", endpoint);
        }
    }, [store, setPending, setError, updateError]);
    const ensureHardware = useCallback(() => {
        if (store.get(hardwareAtom).phase === 'unknown') send('/run/refresh_model_download_hardware', {});
    }, [store, send]);
    return { catalog, state, hardware, error, pending, userModels, send, ensureHardware, updateHardware, updateCatalog, updateState,
        acknowledge, updateUserModels, acknowledgeUserModels, updateError, expireUnconfirmed, reset, backendStopped };
};
