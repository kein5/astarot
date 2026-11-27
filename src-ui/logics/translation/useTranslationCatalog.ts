import { atom, useAtom, useStore } from "jotai";
import { useCallback, useRef } from "react";
import { useStdoutToPython } from "@useStdoutToPython";
import { catalogAtom } from "./translationCatalogState.ts";
import type { TranslationCatalog } from "./translationCatalog.ts";

// What a page sends with a request, as far as it is read here: the entry and its group.
export interface TranslationCatalogRequestData {
    readonly id?: unknown;
    readonly group?: unknown;
    readonly [key: string]: unknown;
}

// A change waiting for its answer.
export interface PendingCatalogChange {
    readonly endpoint: string;
    readonly id: unknown;
    readonly group: unknown;
}

// The catalog as the backend sends it. Only the two groups are checked, as before.
const hasGroups = (value: Partial<TranslationCatalog> | null | undefined): value is TranslationCatalog =>
    Array.isArray(value?.engine) && Array.isArray(value?.api);

// The fixed code of the last refusal, and the request waiting for its answer.
const errorAtom = atom<string | null>(null), pendingAtom = atom<PendingCatalogChange | null>(null);
// The group of the last change sent: a refusal is said in that group's part of the page (#1266).
const changedGroupAtom = atom<unknown>(null);

export const useTranslationCatalog = () => {
    const store = useStore();
    const [catalog] = useAtom(catalogAtom);
    const [error, setError] = useAtom(errorAtom), [pending, setPending] = useAtom(pendingAtom);
    const [changedGroup, setChangedGroup] = useAtom(changedGroupAtom);
    const { asyncStdoutToPython } = useStdoutToPython();
    const transport = useRef(asyncStdoutToPython);
    transport.current = asyncStdoutToPython;

    const updateCatalog = useCallback((value: Partial<TranslationCatalog> | null | undefined) => {
        if (hasGroups(value)) store.set(catalogAtom, value);
    }, [store]);
    // The answer to adding, using or removing an entry: the catalog as it is now.
    const acknowledge = useCallback((value: Partial<TranslationCatalog> | null | undefined) => {
        updateCatalog(value);
        setPending(null);
        setError(value?.warning ?? null);
    }, [updateCatalog, setPending, setError]);
    const fail = useCallback((code: string | null | undefined) => {
        setError(code || "translation_catalog_failed");
        setPending(null);
    }, [setError, setPending]);
    const reset = useCallback(() => {
        store.set(catalogAtom, null); store.set(errorAtom, null); store.set(pendingAtom, null); store.set(changedGroupAtom, null);
    }, [store]);
    // One change at a time: the buttons wait for the answer.
    const send = useCallback(async (endpoint: string, data?: TranslationCatalogRequestData): Promise<void> => {
        if (endpoint.startsWith("/run/")) {
            if (store.get(pendingAtom)) return;
            setError(null); setPending({ endpoint, id: data?.id ?? null, group: data?.group ?? null }); setChangedGroup(data?.group ?? null);
        }
        if (!await transport.current(endpoint, data)) {
            // A reading that did not go out is the catalog's own, not a group's.
            if (!endpoint.startsWith("/run/")) setChangedGroup(null);
            fail("backend_unavailable");
        }
    }, [store, setError, setPending, setChangedGroup, fail]);
    // The group a refusal belongs to: the last change's, or none for the catalog's own reading.
    const errorGroup = error ? changedGroup : null;
    return { catalog, error, errorGroup, pending, send, updateCatalog, acknowledge, fail, reset };
};
