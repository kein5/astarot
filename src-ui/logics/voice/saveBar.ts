import { useSyncExternalStore } from "react";

// What the save bar shows for a form: "saved" and "unsaved" by the draft, "saving" while a
// write runs and "save_failed" when it was refused or not confirmed.
export type SaveState = "saved" | "unsaved" | "saving" | "save_failed";

export interface SaveBarEntry {
    // Something would be saved: an edit, or a change the page proposes (e.g. selecting RVC).
    dirty: boolean;
    // The user edited the form or its write is unconfirmed; leaving would lose it. Missing: as dirty.
    edited?: boolean;
    saving: boolean;
    saveState: SaveState;
    // The names of the changed settings, as shown to the user.
    changes: string[];
    canSave: boolean;
    save: () => void;
    discard: () => void;
}

// Settings forms with a draft register here so the config page top bar can
// show what changed and save or discard every open form in one place.
const entries = new Map<string, SaveBarEntry>();
const listeners = new Set<() => void>();
let snapshot: readonly SaveBarEntry[] = [];

const publish = (): void => {
    snapshot = [...entries.values()];
    listeners.forEach(listener => { listener(); });
};

export const setSaveBarEntry = (id: string, entry: SaveBarEntry | null): void => {
    if (entry) entries.set(id, entry);
    else entries.delete(id);
    publish();
};

const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

export const useSaveBarEntries = (): readonly SaveBarEntry[] => useSyncExternalStore(subscribe, () => snapshot);

const record = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);

// Paths of the leaves that differ, e.g. [["profiles", "asr", "model"]].
export const changedPaths = (saved: unknown, draft: unknown, path: string[] = []): string[][] => {
    if (JSON.stringify(saved) === JSON.stringify(draft)) return [];
    if (!record(saved) || !record(draft)) return [path];
    const keys = new Set([...Object.keys(saved), ...Object.keys(draft)]);
    return [...keys].flatMap(key => changedPaths(saved[key], draft[key], [...path, key]));
};
