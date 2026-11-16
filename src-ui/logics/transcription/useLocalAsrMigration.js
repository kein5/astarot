import { atom, useAtom, useStore } from "jotai";
import { useCallback } from "react";
import { useStdoutToPython } from "@useStdoutToPython";
import { normalizeOutcome, normalizeWeights } from "./localAsrMigration.ts";

// The one-time notice after a saved choice of the removed Whisper engine moved to
// speech.cpp, and the Whisper weights an older version left on disk (#288).
// null: not known yet. The notice never downloads anything; the weights are deleted
// only when the user asks and confirms.
const noticeAtom = atom(null);
const weightsAtom = atom(null);
const outcomeAtom = atom(null);
const deletingAtom = atom(false);
const errorAtom = atom(null);

export const useLocalAsrMigration = () => {
    const atoms = useStore();
    const [notice, setNotice] = useAtom(noticeAtom);
    const [weights, setWeights] = useAtom(weightsAtom);
    const [outcome, setOutcome] = useAtom(outcomeAtom);
    const [deleting, setDeleting] = useAtom(deletingAtom);
    const [error, setError] = useAtom(errorAtom);
    const { asyncStdoutToPython } = useStdoutToPython();

    const updateNotice = useCallback(value => setNotice(value === true), [setNotice]);
    const updateWeights = useCallback(value => {
        const normalized = normalizeWeights(value);
        setWeights(normalized);
        setError(normalized ? null : "invalid");
    }, [setWeights, setError]);
    const updateDeleted = useCallback(value => {
        setDeleting(false);
        const result = normalizeOutcome(value);
        if (!result) { setError("invalid"); return; }
        setWeights(normalizeWeights(value));
        setOutcome(result);
        setError(null);
    }, [setDeleting, setWeights, setOutcome, setError]);
    // A refused or failed request: the delete button can be pressed again.
    const failRequest = useCallback(code => {
        setDeleting(false);
        setError(typeof code === "string" && code ? code : "failed");
    }, [setDeleting, setError]);

    // Closing the notice in any way clears it for good; the settings keep what it pointed at.
    const dismissNotice = useCallback(() => {
        setNotice(false);
        return asyncStdoutToPython("/set/disable/local_asr_notice");
    }, [setNotice, asyncStdoutToPython]);
    const deleteWeights = useCallback(async () => {
        // The store, not this render's value: a second press may come before the next render.
        if (atoms.get(deletingAtom)) return false;
        setDeleting(true);
        setOutcome(null);
        setError(null);
        const sent = await asyncStdoutToPython("/run/delete_old_whisper_weights");
        if (sent === false) failRequest("backend_unavailable");
        return sent;
    }, [atoms, setDeleting, setOutcome, setError, asyncStdoutToPython, failRequest]);
    const refreshWeights = useCallback(() => asyncStdoutToPython("/get/data/old_whisper_weights"), [asyncStdoutToPython]);

    const reset = useCallback(() => {
        setNotice(null);
        setWeights(null);
        setOutcome(null);
        setDeleting(false);
        setError(null);
    }, [setNotice, setWeights, setOutcome, setDeleting, setError]);
    // The sidecar stopped: a delete under way can no longer be confirmed.
    const backendStopped = useCallback(() => {
        if (atoms.get(deletingAtom)) failRequest("backend_unavailable");
    }, [atoms, failRequest]);

    return { notice, weights, outcome, deleting, error, updateNotice, updateWeights, updateDeleted, failRequest,
        dismissNotice, deleteWeights, refreshWeights, reset, backendStopped };
};
