import { useEffect, useId, useRef, useState } from "react";
import type { Dispatch, ReactElement, SetStateAction } from "react";
import { useI18n } from "@useI18n";
import type { StdoutResult } from "@useStdoutToPython";
import { rebaseDraft } from "./draftRebase";
import { changedPaths, setSaveBarEntry } from "./saveBar";
import type { SaveBarEntry, SaveState } from "./saveBar";

// The draft: null until the saved value first arrives (undefined while the saved value is undefined).
export type DraftState<T> = T | null | undefined;

// What a write sends: the draft, or with `patch` only its changed top-level fields.
export type DraftWriteValue<T> = DraftState<T> | Readonly<Record<string, unknown>>;
export type DraftWrite<T> = (value: DraftWriteValue<T>) => Promise<StdoutResult> | StdoutResult;

export interface SettingsDraftOptions<T> {
    write?: DraftWrite<T>;
    canSave?: boolean | ((draft: T) => unknown);
    label?: (path: string[]) => string;
    pending?: readonly string[] | ((draft: T) => readonly string[]);
    // Turns the backend's answer to a write into the saved value.
    savedFromResponse?: (result: unknown) => T;
    patch?: boolean;
}

export interface SettingsDraft<T> {
    draft: DraftState<T>;
    setDraft: Dispatch<SetStateAction<DraftState<T>>>;
    dirty: boolean;
    saving: boolean;
    discard: () => void;
    submit: (send: DraftWrite<T>) => Promise<void>;
    saveState: SaveState;
    navigationDialog: ReactElement | null;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null;
const isAction = (value: unknown): value is () => void => typeof value === "function";

// The page change a "vrct:settings-leave" event waits with (requestSettingsNavigation).
const leaveAction = (event: Event): (() => void) | undefined => {
    const detail = "detail" in event ? event.detail : undefined;
    if (!isRecord(detail) || !isAction(detail.proceed)) return undefined;
    return detail.proceed;
};

// The saved value the backend answered a write with. Without savedFromResponse the answer is the
// saved value itself; like the atoms' values it is declared here, not checked.
function answeredValue<T>(result: unknown, savedFromResponse?: (result: unknown) => T): T;
function answeredValue(result: unknown, savedFromResponse?: (result: unknown) => unknown): unknown {
    return savedFromResponse ? savedFromResponse(result) : result;
}

// A write is confirmed by its own response, including backend normalization.
// `write` sends a draft; with it the form is saved from the config page top
// bar, which lists the changed fields by `label(path)`. `canSave` may be a
// function of the draft. `pending` (a list, or a function of the draft) names
// changes that are not in the draft,
// e.g. an engine the backend has not selected yet.
// `patch` sends only changed top-level fields to setters that merge them.
export function useSettingsDraft<T>(saved: T | null | undefined, error: unknown, updateError: (code: string | null) => void,
    { write, canSave = true, label = path => path.join("."), pending = [], savedFromResponse, patch = false }: SettingsDraftOptions<T> = {}): SettingsDraft<T> {
    const { t } = useI18n();
    const [draft, setDraft] = useState<DraftState<T>>(null);
    const [saving, setSaving] = useState(false);
    const submitted = useRef<{ draft: DraftState<T> } | null>(null);
    const [awaitingResponse, setAwaitingResponse] = useState(false);
    const savedKey = JSON.stringify(saved);
    const previousSavedKey = useRef(savedKey);
    const dirty = draft !== null && (JSON.stringify(draft) !== savedKey || awaitingResponse);
    const current = useRef({ draft, dirty });
    current.current = { draft, dirty };
    useEffect(() => {
        if (saved == null) return;
        if (current.current.draft === null) setDraft(saved);
        else {
            const previous: unknown = JSON.parse(previousSavedKey.current);
            const rebased = rebaseDraft(previous, current.current.draft, saved);
            // Even a newer edit back to the old saved value must survive the
            // atom update that arrives just before this write's response.
            setDraft(submitted.current ? rebaseDraft(submitted.current.draft, current.current.draft, rebased) : rebased);
        }
        previousSavedKey.current = savedKey;
    }, [savedKey, saved]);
    // Only this form's own write decides its save state. `error` is shared with other requests
    // (mute, status polls) on the same page, so it never ends saving or marks a failure (#458).
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        if (!saving) return;
        const timer = setTimeout(() => { setSaving(false); setFailed(true); updateError("save_unconfirmed"); }, 5000);
        return () => clearTimeout(timer);
    }, [saving, updateError]);
    const [leaving, setLeaving] = useState<(() => void) | null | undefined>(null);
    const dialog = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        if (!dirty && !saving) return;
        const guard = (event: Event) => {
            if (event.defaultPrevented) return;
            event.preventDefault();
            setLeaving(() => leaveAction(event));
        };
        const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
        window.addEventListener("vrct:settings-leave", guard);
        window.addEventListener("beforeunload", unload);
        return () => {
            window.removeEventListener("vrct:settings-leave", guard);
            window.removeEventListener("beforeunload", unload);
        };
    }, [dirty, saving]);
    useEffect(() => { if (leaving) dialog.current?.showModal(); }, [leaving]);
    const discard = () => { setDraft(saved); setSaving(false); setFailed(false); setAwaitingResponse(false); submitted.current = null; updateError(null); };
    useEffect(() => () => { submitted.current = null; }, []);
    const submit = async (send: DraftWrite<T>): Promise<void> => {
        if (saving) return;
        updateError(null);
        const request = { draft };
        submitted.current = request;
        setAwaitingResponse(true);
        setFailed(false);
        setSaving(true);
        try {
            const changed = (): Readonly<Record<string, unknown>> => {
                if (draft === null || draft === undefined) throw new TypeError("There is no draft to save.");
                const fields: [string, unknown][] = Object.entries(draft);
                return Object.fromEntries(fields.filter(([key, value]) =>
                    JSON.stringify(value) !== JSON.stringify(isRecord(saved) ? saved[key] : undefined)));
            };
            const value: DraftWriteValue<T> = patch ? changed() : draft;
            const response = await send(value);
            if (submitted.current !== request) return;
            const reply = typeof response === "object" && response !== null ? response : null;
            if (reply?.status === 200) {
                const canonical = answeredValue(reply.result, savedFromResponse);
                setDraft(value => rebaseDraft(request.draft, value, canonical));
                previousSavedKey.current = JSON.stringify(canonical);
                setSaving(false);
                setFailed(false);
                submitted.current = null;
                setAwaitingResponse(false);
                updateError(null);
            } else if (response === false || reply?.status) {
                setSaving(false);
                setFailed(true);
                submitted.current = null;
                // Keep failed writes dirty even if a refresh has the same value.
            }
        } catch {
            if (submitted.current !== request) return;
            setSaving(false);
            setFailed(true);
            submitted.current = null;
            setAwaitingResponse(false);
            updateError("save_unconfirmed");
        }
    };
    const saveState: SaveState = failed || (!saving && awaitingResponse) ? "save_failed" : saving ? "saving" : dirty ? "unsaved" : "saved";
    const id = useId();
    // Fields saved together under one name (an engine voice's id and names) count as one change.
    const changes = draft === null || draft === undefined ? [] : [...new Set([...changedPaths(saved, draft).map(path => label(path)),
        ...(typeof pending === "function" ? pending(draft) : pending)])];
    // `edited`: the draft differs or its write is unconfirmed. A `pending` change alone (e.g. the RVC
    // page selecting RVC) is not an edit the user would lose by leaving.
    const entry: SaveBarEntry = { dirty: dirty || changes.length > 0, edited: dirty, saving, saveState, changes,
        canSave: !!write && draft !== null && draft !== undefined && !!(typeof canSave === "function" ? canSave(draft) : canSave),
        // The bar lists this form only with a write (see below). A save returns the write's promise.
        save: () => write ? submit(write) : undefined, discard };
    const entryRef = useRef(entry);
    entryRef.current = entry;
    const entryKey = JSON.stringify([entry.dirty, dirty, saving, saveState, changes, entry.canSave]);
    useEffect(() => {
        if (!write) return;
        // Callbacks read the latest render, so only visible state republishes.
        setSaveBarEntry(id, { ...entryRef.current, save: () => entryRef.current.save(), discard: () => entryRef.current.discard() });
    }, [id, entryKey, !write]);
    useEffect(() => () => setSaveBarEntry(id, null), [id]);
    return {
        draft, setDraft, dirty, saving, discard, submit, saveState,
        navigationDialog: leaving ? <dialog ref={dialog} onCancel={() => setLeaving(null)} aria-label={t("voice_ui.leave_title")}>
            <p>{t("voice_ui.leave_hint")}</p>
            <button type="button" autoFocus onClick={() => setLeaving(null)}>{t("voice_ui.keep_editing")}</button>
            <button type="button" onClick={() => { const proceed = leaving; discard(); setLeaving(null); proceed(); }}>{t("voice_ui.discard_leave")}</button>
        </dialog> : null,
    };
}
