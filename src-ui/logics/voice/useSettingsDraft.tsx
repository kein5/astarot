import { useEffect, useId, useRef, useState } from "react";
import type { Dispatch, KeyboardEvent, ReactElement, SetStateAction } from "react";
import type { TargetHolder } from "../common/targetHolder.ts";
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
    // Saves by itself (#1111): the group saves when focus leaves it (leave) and a choice in it at
    // once (change), so nothing waits for the save bar and leaving the page asks nothing first
    // (decided 3 and 4).
    autoSave?: boolean;
}

// A choice: it saves at once. A slider saves when it is let go.
const choosesAtOnce = (target: unknown): boolean => isRecord(target) &&
    (target.tagName === "SELECT" || (target.tagName === "INPUT" && ["checkbox", "radio"].includes(String(target.type))));
const slides = (target: unknown): boolean => isRecord(target) && target.tagName === "INPUT" && target.type === "range";

// The handlers of the element around a group (a form or a fieldset) that saves by itself.
export interface DraftGroupProps {
    onBlur: (event: { currentTarget: TargetHolder; relatedTarget: EventTarget | null }) => void;
    onKeyDown: (event: Pick<KeyboardEvent<HTMLElement>, "key" | "target" | "preventDefault">) => void;
    onChange: (event: { target: EventTarget }) => void;
    onPointerUp: (event: { target: EventTarget }) => void;
    onKeyUp: (event: { target: EventTarget }) => void;
}

// What takes typed text, where Escape puts the group's saved values back.
const typesText = (target: unknown): boolean => {
    if (!isRecord(target)) return false;
    if (target.tagName === "TEXTAREA") return true;
    return target.tagName === "INPUT" && !["checkbox", "radio", "range", "button", "submit", "reset", "color", "file"].includes(String(target.type));
};

export interface SettingsDraft<T> {
    draft: DraftState<T>;
    setDraft: Dispatch<SetStateAction<DraftState<T>>>;
    dirty: boolean;
    saving: boolean;
    discard: () => void;
    submit: (send: DraftWrite<T>) => Promise<void>;
    saveState: SaveState;
    navigationDialog: ReactElement | null;
    // With autoSave (#1111, decided 3). `commit` saves the draft if it is changed and accepted, or
    // once the save that waits ends. `change` edits the draft and saves it at once (a choice, a
    // switch, a word added to a list). `group` is the element around the group's fields: `leave`
    // (its blur, or a field's) saves when focus goes outside it, and Escape in a text field of the
    // group (`escape`, its key down) puts the saved values back.
    commit: (send?: DraftWrite<T>) => void;
    change: (update: SetStateAction<DraftState<T>>) => void;
    group: (element: TargetHolder | null) => void;
    leaves: (event?: { relatedTarget: EventTarget | null }) => boolean;
    leave: (event?: { relatedTarget: EventTarget | null }) => void;
    escape: (event: Pick<KeyboardEvent<HTMLElement>, "key" | "target" | "preventDefault">) => void;
    // Spread on the element around a group whose fields are drawn by other parts: focus leaving the
    // element saves, a choice in it (a list, a check box) saves at once, a slider when let go, and
    // Escape in its text fields puts the saved values back.
    groupProps: DraftGroupProps;
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
// `_error` is the caller's error state, which the draft does not read: it reports through updateError.
export function useSettingsDraft<T>(saved: T | null | undefined, _error: unknown, updateError: (code: string | null) => void,
    { write, canSave = true, label = path => path.join("."), pending = [], savedFromResponse, patch = false, autoSave = false }: SettingsDraftOptions<T> = {}): SettingsDraft<T> {
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
    // #1111, decided 3. `committing`: a save started and not ended, even before a render shows
    // `saving`, so a second blur from an element around the first (or the same leave twice) waits
    // for it instead of sending again. `again`: an edit asked to be saved meanwhile, saved once the
    // save ends, through a render that has it (changeCount).
    const committing = useRef(false);
    const again = useRef(false);
    const [changeCount, setChangeCount] = useState(0);
    const settled = () => {
        committing.current = false;
        if (again.current) { again.current = false; setChangeCount(count => count + 1); }
    };
    useEffect(() => {
        if (!saving) return;
        const timer = setTimeout(() => { setSaving(false); setFailed(true); updateError("save_unconfirmed"); settled(); }, 5000);
        return () => clearTimeout(timer);
    }, [saving, updateError]);
    const [leaving, setLeaving] = useState<(() => void) | null | undefined>(null);
    const dialog = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        if (autoSave || (!dirty && !saving)) return;
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
    }, [dirty, saving, autoSave]);
    useEffect(() => { if (leaving) dialog.current?.showModal(); }, [leaving]);
    const discard = () => { setDraft(saved); setSaving(false); setFailed(false); setAwaitingResponse(false); submitted.current = null; updateError(null);
        committing.current = false; again.current = false; };
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
                settled();
            } else if (response === false || reply?.status) {
                setSaving(false);
                setFailed(true);
                submitted.current = null;
                settled();
                // Keep failed writes dirty even if a refresh has the same value.
            }
        } catch {
            if (submitted.current !== request) return;
            setSaving(false);
            setFailed(true);
            submitted.current = null;
            setAwaitingResponse(false);
            updateError("save_unconfirmed");
            settled();
        }
    };
    // #1111, decided 3: the group saves when focus leaves it, a choice at once, and an edit made
    // while a save waits once that save ends.
    const accepted = (value: DraftState<T>) => value !== null && value !== undefined && !!(typeof canSave === "function" ? canSave(value) : canSave);
    const commit = (send: DraftWrite<T> | undefined = write) => {
        if (!autoSave || !send || !dirty) return;
        if (saving || committing.current) { again.current = true; return; }
        if (!accepted(draft)) return;
        committing.current = true;
        void submit(send);
    };
    const change = (update: SetStateAction<DraftState<T>>) => { setDraft(update); setChangeCount(count => count + 1); };
    // The render after a change has the changed draft, which this render's commit reads.
    const latestCommit = useRef(commit);
    latestCommit.current = commit;
    useEffect(() => { if (changeCount) latestCommit.current(); }, [changeCount]);
    const groupElement = useRef<TargetHolder | null>(null);
    const group = (element: TargetHolder | null) => { groupElement.current = element; };
    // Whether a blur takes focus outside the group (not from one of its fields to another).
    const leaves = (event?: { relatedTarget: EventTarget | null }) => {
        const next = event?.relatedTarget ?? null;
        return !(next && groupElement.current?.contains(next));
    };
    const leave = (event?: { relatedTarget: EventTarget | null }) => { if (leaves(event)) commit(); };
    const escapeKey = (event: Pick<KeyboardEvent<HTMLElement>, "key" | "target" | "preventDefault">) => {
        if (!autoSave || event.key !== "Escape" || !dirty || saving || !typesText(event.target)) return;
        event.preventDefault();
        discard();
    };
    // In a group around fields drawn by other parts, Enter in a one-line text field saves too (#1111,
    // decided 1): a form with several fields and no submit button does not submit on Enter itself.
    const groupKeyDown = (event: Pick<KeyboardEvent<HTMLElement>, "key" | "target" | "preventDefault">) => {
        if (autoSave && event.key === "Enter" && typesText(event.target) && isRecord(event.target) && event.target.tagName === "INPUT") {
            event.preventDefault();
            commit();
            return;
        }
        escapeKey(event);
    };
    const saveSoon = () => setChangeCount(count => count + 1);
    const groupProps: DraftGroupProps = {
        onBlur: event => { if (!event.currentTarget.contains(event.relatedTarget)) commit(); },
        onKeyDown: groupKeyDown,
        // The field's own handler has changed the draft; the render after both has the choice.
        onChange: event => { if (choosesAtOnce(event.target)) saveSoon(); },
        onPointerUp: event => { if (slides(event.target)) saveSoon(); },
        onKeyUp: event => { if (slides(event.target)) saveSoon(); },
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
        if (!write || autoSave) return;
        // Callbacks read the latest render, so only visible state republishes.
        setSaveBarEntry(id, { ...entryRef.current, save: () => entryRef.current.save(), discard: () => entryRef.current.discard() });
    }, [id, entryKey, !write]);
    useEffect(() => () => setSaveBarEntry(id, null), [id]);
    return {
        draft, setDraft, dirty, saving, discard, submit, saveState, commit, change, group, leaves, leave, escape: escapeKey, groupProps,
        // The form's own confirmation, for a page without the save bar's (Topbar.tsx), which asks
        // first where it is. Its two answers are one row, as the save bar's are.
        navigationDialog: leaving ? <dialog ref={dialog} onCancel={() => setLeaving(null)} aria-label={t("voice_ui.leave_title")}>
            <p>{t("voice_ui.leave_hint")}</p>
            <div data-leave-actions>
                <button type="button" autoFocus onClick={() => setLeaving(null)}>{t("voice_ui.keep_editing")}</button>
                <button type="button" onClick={() => { const proceed = leaving; discard(); setLeaving(null); proceed(); }}>{t("voice_ui.discard_leave")}</button>
            </div>
        </dialog> : null,
    };
}
