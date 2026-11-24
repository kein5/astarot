import { useEffect, useRef, useState } from "react";
import type { Dispatch, KeyboardEvent, SetStateAction } from "react";
import type { TargetHolder } from "../common/targetHolder.ts";
import type { StdoutResult } from "@useStdoutToPython";
import { rebaseDraft } from "./draftRebase";

// A form's save: "saved" and "unsaved" by the draft, "saving" while a write runs and
// "save_failed" when it was refused or not confirmed.
export type SaveState = "saved" | "unsaved" | "saving" | "save_failed";

// The draft: null until the saved value first arrives (undefined while the saved value is undefined).
export type DraftState<T> = T | null | undefined;

// What a write sends: the draft, or with `patch` only its changed top-level fields.
export type DraftWriteValue<T> = DraftState<T> | Readonly<Record<string, unknown>>;
export type DraftWrite<T> = (value: DraftWriteValue<T>) => Promise<StdoutResult> | StdoutResult;

export interface SettingsDraftOptions<T> {
    write?: DraftWrite<T>;
    canSave?: boolean | ((draft: T) => unknown);
    // Turns the backend's answer to a write into the saved value.
    savedFromResponse?: (result: unknown) => T;
    patch?: boolean;
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
    // The form saves by itself (#1111, decided 3). `commit` saves the draft if it is changed and accepted, or
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

// The saved value the backend answered a write with. Without savedFromResponse the answer is the
// saved value itself; like the atoms' values it is declared here, not checked.
function answeredValue<T>(result: unknown, savedFromResponse?: (result: unknown) => T): T;
function answeredValue(result: unknown, savedFromResponse?: (result: unknown) => unknown): unknown {
    return savedFromResponse ? savedFromResponse(result) : result;
}

// A write is confirmed by its own response, including backend normalization.
// `write` sends a draft when the form saves itself (#1111): a choice at once, typed text when focus
// leaves the group or on Enter. `canSave` may be a function of the draft; a draft it refuses is
// not sent. `patch` sends only changed top-level fields to setters that merge them.
// `_error` is the caller's error state, which the draft does not read: it reports through updateError.
export function useSettingsDraft<T>(saved: T | null | undefined, _error: unknown, updateError: (code: string | null) => void,
    { write, canSave = true, savedFromResponse, patch = false }: SettingsDraftOptions<T> = {}): SettingsDraft<T> {
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
    // #1111, decided 3: the group saves when focus leaves it, a choice at once, and an edit made
    // while a save waits once that save ends.
    const accepted = (value: DraftState<T>) => value !== null && value !== undefined && !!(typeof canSave === "function" ? canSave(value) : canSave);
    const again = useRef(false);
    // A save started in this render, before `saving` shows it: a second blur from an element
    // around the first (or the same leave twice) waits for it instead of sending again.
    const committing = useRef(false);
    const commit = (send: DraftWrite<T> | undefined = write) => {
        if (!send || !dirty) return;
        if (saving || committing.current) { again.current = true; return; }
        if (!accepted(draft)) return;
        committing.current = true;
        void submit(send);
    };
    const [changeCount, setChangeCount] = useState(0);
    const change = (update: SetStateAction<DraftState<T>>) => { setDraft(update); setChangeCount(count => count + 1); };
    // The render after a change has the changed draft, which this render's commit reads.
    const latestCommit = useRef(commit);
    latestCommit.current = commit;
    useEffect(() => { if (changeCount) latestCommit.current(); }, [changeCount]);
    useEffect(() => {
        if (saving) return;
        committing.current = false;
        if (again.current) { again.current = false; latestCommit.current(); }
    }, [saving]);
    const groupElement = useRef<TargetHolder | null>(null);
    const group = (element: TargetHolder | null) => { groupElement.current = element; };
    // Whether a blur takes focus outside the group (not from one of its fields to another).
    const leaves = (event?: { relatedTarget: EventTarget | null }) => {
        const next = event?.relatedTarget ?? null;
        return !(next && groupElement.current?.contains(next));
    };
    const leave = (event?: { relatedTarget: EventTarget | null }) => { if (leaves(event)) commit(); };
    const escapeKey = (event: Pick<KeyboardEvent<HTMLElement>, "key" | "target" | "preventDefault">) => {
        if (event.key !== "Escape" || !dirty || saving || !typesText(event.target)) return;
        event.preventDefault();
        discard();
    };
    // In a group around fields drawn by other parts, Enter in a one-line text field saves too (#1111,
    // decided 1): a form with several fields and no submit button does not submit on Enter itself.
    const groupKeyDown = (event: Pick<KeyboardEvent<HTMLElement>, "key" | "target" | "preventDefault">) => {
        if (event.key === "Enter" && typesText(event.target) && isRecord(event.target) && event.target.tagName === "INPUT") {
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
    return {
        // The saved value until the draft is made from it, a render later: a form does not flash
        // its loading state when the value is already known (#912).
        draft: draft === null && saved != null ? saved : draft,
        setDraft, dirty, saving, discard, submit, saveState, commit, change, group, leaves, leave, escape: escapeKey, groupProps,
    };
}
