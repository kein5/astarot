import { useId } from "react";
import type { ChangeEvent, KeyboardEvent, ReactNode } from "react";
import * as styles from "./EntryWithSaveButton.css.ts";
import { _Entry } from "../_atoms/_entry/_Entry";

export interface EntryWithSaveButtonProps {
    label?: ReactNode;
    width?: string;
    type?: string;
    min?: number | string;
    max?: number | string;
    step?: number | string;
    // The value shown in the field.
    variable?: string | number | null;
    // "pending" while a save waits for the backend: the field cannot be edited then.
    state?: string;
    onChangeFunction?: (value: string) => void;
    saveFunction: () => unknown;
    "aria-describedby"?: string;
    // Saves by itself (#1111): leaving the field saves it as Enter does, and Escape puts the saved
    // value back (onRevert). Without it the field is saved from the config page top bar.
    autoSave?: boolean;
    onRevert?: () => void;
    // What is wrong with the value and what kind of value would do, said under the field (#1111).
    error?: string | null;
}

// Saved from the config page top bar; Enter saves this one field. With autoSave it saves by itself.
export const EntryWithSaveButton = (props: EntryWithSaveButtonProps) => {
    const errorId = useId();
    const onChangeFunction = (e: ChangeEvent<HTMLInputElement>) => {
        if (props.state === "pending") return;
        props.onChangeFunction?.(e.target.value);
    };
    const saveFunction = () => {
        props.saveFunction();
    };
    const is_disabled = props.state === "pending";

    const handleEnterPressed = () => {
        if (is_disabled) return;
        saveFunction();
    };
    const autoSave = !!props.autoSave;
    const error = autoSave && props.error ? props.error : null;
    const describedBy = [props["aria-describedby"], error ? errorId : null].filter(Boolean).join(" ") || undefined;

    const field = (
        <div className={styles.container}>
            <_Entry label={props.label} width={props.width} type={props.type} min={props.min} max={props.max} step={props.step} onChange={onChangeFunction} onEnterPressed={handleEnterPressed} ui_variable={props.variable} readOnly={is_disabled} aria-busy={is_disabled} aria-disabled={is_disabled} aria-describedby={describedBy}
                aria-invalid={error ? true : undefined}
                onBlur={autoSave ? () => { if (!is_disabled) saveFunction(); } : undefined}
                onKeyDown={autoSave ? (event: KeyboardEvent<HTMLInputElement>) => { if (event.key === "Escape") props.onRevert?.(); } : undefined} />
        </div>
    );
    if (!autoSave) return field;
    // The problem stays under the field, in words, until the value is changed or put back.
    return (
        <div className={styles.field} data-invalid={error ? "true" : undefined}>
            {field}
            {error && <p id={errorId} role="alert" className={styles.error}>{error}</p>}
        </div>
    );
};
