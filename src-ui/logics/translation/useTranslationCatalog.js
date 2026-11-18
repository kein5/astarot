import { atom, useAtom, useStore } from "jotai";
import { useCallback, useRef } from "react";
import { useStdoutToPython } from "@useStdoutToPython";

// The translation catalog (#413) as the backend sends it, null until the first answer.
const catalogAtom = atom(null);
// The fixed code of the last refusal, and the request waiting for its answer.
const errorAtom = atom(null), pendingAtom = atom(null);

export const useTranslationCatalog = () => {
    const store = useStore();
    const [catalog] = useAtom(catalogAtom);
    const [error, setError] = useAtom(errorAtom), [pending, setPending] = useAtom(pendingAtom);
    const { asyncStdoutToPython } = useStdoutToPython();
    const transport = useRef(asyncStdoutToPython);
    transport.current = asyncStdoutToPython;

    const updateCatalog = useCallback(value => {
        if (Array.isArray(value?.engine) && Array.isArray(value?.api)) store.set(catalogAtom, value);
    }, [store]);
    // The answer to adding, using or removing an entry: the catalog as it is now.
    const acknowledge = useCallback(value => {
        updateCatalog(value);
        setPending(null);
        setError(value?.warning ?? null);
    }, [updateCatalog, setPending, setError]);
    const fail = useCallback(code => {
        setError(code || "translation_catalog_failed");
        setPending(null);
    }, [setError, setPending]);
    const reset = useCallback(() => {
        store.set(catalogAtom, null); store.set(errorAtom, null); store.set(pendingAtom, null);
    }, [store]);
    // One change at a time: the buttons wait for the answer.
    const send = useCallback(async (endpoint, data) => {
        if (endpoint.startsWith("/run/")) {
            if (store.get(pendingAtom)) return;
            setError(null); setPending({ endpoint, id: data?.id ?? null, group: data?.group ?? null });
        }
        if (!await transport.current(endpoint, data)) fail("backend_unavailable");
    }, [store, setError, setPending, fail]);
    return { catalog, error, pending, send, updateCatalog, acknowledge, fail, reset };
};
