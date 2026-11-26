import { useId } from "react";
import type { ChangeEvent, FocusEvent, KeyboardEvent, ReactNode } from "react";
import * as styles from "./EntryWithSaveButton.css.ts";
import { _Entry } from "../_atoms/_entry/_Entry";
import { FieldProblem } from "../field_problem/FieldProblem";
import * as problemStyles from "../field_problem/FieldProblem.css.ts";

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
    // value back (onRevert).
    onRevert?: () => void;
    // What leaving the field does, when it is not what Enter does (an API key, a field of a pair,
    // #1111). It gets the blur, which says where focus goes. saveFunction otherwise.
    leaveFunction?: (event?: FocusEvent<HTMLInputElement>) => unknown;
    // What is wrong with the value and what kind of value would do, said under the field (#1111).
    error?: string | null;
    // The field's own button beside it, at the row's right edge: a path's picker (#1231).
    trailing?: ReactNode;
}

// Saved from the config page top bar; Enter saves this one field. With it saves by itself.
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
    const error = props.error || null;
    const describedBy = [props["aria-describedby"], error ? errorId : null].filter(Boolean).join(" ") || undefined;

    const field = (
        <div className={styles.container}>
            <_Entry label={props.label} width={props.width} type={props.type} min={props.min} max={props.max} step={props.step} onChange={onChangeFunction} onEnterPressed={handleEnterPressed} ui_variable={props.variable} readOnly={is_disabled} aria-busy={is_disabled} aria-disabled={is_disabled} aria-describedby={describedBy}
                aria-invalid={error ? true : undefined}
                onBlur={(event: FocusEvent<HTMLInputElement>) => { if (is_disabled) return; if (props.leaveFunction) props.leaveFunction(event); else props.saveFunction(); }}
                onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => { if (event.key === "Escape") props.onRevert?.(); }} />
            {props.trailing}
        </div>
    );
    // The problem stays under the field, in words, until the value is changed or put back.
    return (
        <div className={problemStyles.field} data-invalid={error ? "true" : undefined}>
            {field}
            {error && <FieldProblem id={errorId} text={error} />}
        </div>
    );
};
