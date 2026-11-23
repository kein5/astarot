import type { ChangeEvent, ReactNode } from "react";
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
}

// Saved from the config page top bar; Enter saves this one field.
export const EntryWithSaveButton = (props: EntryWithSaveButtonProps) => {
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

    return (
        <div className={styles.container}>
            <_Entry label={props.label} width={props.width} type={props.type} min={props.min} max={props.max} step={props.step} onChange={onChangeFunction} onEnterPressed={handleEnterPressed} ui_variable={props.variable} readOnly={is_disabled} aria-busy={is_disabled} aria-disabled={is_disabled} aria-describedby={props["aria-describedby"]}/>
        </div>
    );
};