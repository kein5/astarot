import { atom, useAtom, useStore } from "jotai";
import { useCallback, useRef } from "react";
import { useStdoutToPython } from "@useStdoutToPython";
import { isTranscriptionCatalog } from "./transcriptionCatalog.ts";
import type { TranscriptionCatalog } from "./transcriptionCatalog.ts";

// A change waiting for its answer.
export interface PendingAsrCatalogChange {
    readonly endpoint: string;
    readonly id: unknown;
}

// The speech recognition APIs the user added (#414) as the backend sends them, null until the
// first answer.
const catalogAtom = atom<TranscriptionCatalog | null>(null);
// The fixed code of the last refusal, and the request waiting for its answer.
const errorAtom = atom<string | null>(null), pendingAtom = atom<PendingAsrCatalogChange | null>(null);

export const useTranscriptionCatalog = () => {
    const store = useStore();
    const [catalog] = useAtom(catalogAtom);
    const [error, setError] = useAtom(errorAtom), [pending, setPending] = useAtom(pendingAtom);
    const { asyncStdoutToPython } = useStdoutToPython();
    const transport = useRef(asyncStdoutToPython);
    transport.current = asyncStdoutToPython;

    const updateCatalog = useCallback((value: Partial<TranscriptionCatalog> | null | undefined) => {
        if (isTranscriptionCatalog(value)) store.set(catalogAtom, value);
    }, [store]);
    // The answer to adding, using or removing an entry: the entries as they are now.
    const acknowledge = useCallback((value: Partial<TranscriptionCatalog> | null | undefined) => {
        updateCatalog(value);
        setPending(null);
        setError(value?.warning ?? null);
    }, [updateCatalog, setPending, setError]);
    const fail = useCallback((code: string | null | undefined) => {
        setError(code || "transcription_catalog_failed");
        setPending(null);
    }, [setError, setPending]);
    const reset = useCallback(() => {
        store.set(catalogAtom, null); store.set(errorAtom, null); store.set(pendingAtom, null);
    }, [store]);
    // One change at a time: the buttons wait for the answer.
    const send = useCallback(async (endpoint: string, data?: { readonly id?: unknown; readonly [key: string]: unknown }): Promise<void> => {
        if (endpoint.startsWith("/run/")) {
            if (store.get(pendingAtom)) return;
            setError(null); setPending({ endpoint, id: data?.id ?? null });
        }
        if (!await transport.current(endpoint, data)) fail("backend_unavailable");
    }, [store, setError, setPending, fail]);
    return { catalog, error, pending, send, updateCatalog, acknowledge, fail, reset };
};
