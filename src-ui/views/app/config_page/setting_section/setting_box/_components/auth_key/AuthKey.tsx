import * as styles from "./AuthKey.css.ts";
import { useI18n } from "@useI18n";
import { _Entry } from "../_atoms/_entry/_Entry";
import type { EntryHandle } from "../_atoms/_entry/_Entry";
import { FieldProblem } from "../field_problem/FieldProblem";
import * as problemStyles from "../field_problem/FieldProblem.css.ts";
import { useState, useRef, useEffect, useId } from "react";
import type { ChangeEvent, FocusEvent, KeyboardEvent, ReactNode } from "react";

export interface AuthKeyProps {
    label?: ReactNode;
    // The saved key; "" or null when there is none, and the field opens for typing.
    variable?: string | null;
    // "pending" while a save waits for the backend.
    state?: string;
    onChangeFunction: (value: string) => void;
    saveFunction: () => unknown;
    "aria-describedby"?: string;
    // Saves by itself (#1111): Enter saves (an empty field deletes the key), leaving the field
    // saves through leaveFunction (an empty field keeps the key), and Escape puts the saved key back.
    autoSave?: boolean;
    // It gets the blur, which says where focus goes (a key in a pair).
    leaveFunction?: (event?: FocusEvent<HTMLInputElement>) => unknown;
    onRevert?: () => void;
    // Why the key was not kept and what would do, said under the field (#1111).
    error?: string | null;
}

export const AuthKey = (props: AuthKeyProps) => {
    const { t } = useI18n();
    const [is_editable, seIsEditable] = useState(false);
    const entryRef = useRef<EntryHandle>(null);
    const errorId = useId();

    const revealEditAuthKey = () => {
        seIsEditable(true);
        entryRef.current?.focus();
    };

    const onChangeEntryAuthKey = (e: ChangeEvent<HTMLInputElement>) => {
        if (props.state === "pending") return;
        props.onChangeFunction(e.target.value);
    };
    const saveAuthKey = () => {
        props.saveFunction();
    };

    useEffect(() => {
        if (props.variable === "" || props.variable === null) {
            seIsEditable(true);
        }
    }, [props.variable]);

    const is_disabled = props.state === "pending";

    const handleEnterPressed = () => {
        if (is_disabled) return;
        saveAuthKey();
    };
    const autoSave = !!props.autoSave;
    const error = autoSave && props.error ? props.error : null;
    const describedBy = [props["aria-describedby"], error ? errorId : null].filter(Boolean).join(" ") || undefined;

    const field = (
        <div className={styles.container}>
            <div className={styles.entry_section_wrapper}>
                <_Entry ref={entryRef} label={props.label} spellCheck={false} autoComplete="off" onChange={onChangeEntryAuthKey} onEnterPressed={handleEnterPressed} ui_variable={props.variable} readOnly={is_disabled} aria-busy={is_disabled} aria-disabled={is_disabled} aria-describedby={describedBy}
                    aria-invalid={error ? true : undefined}
                    onBlur={autoSave ? (event: FocusEvent<HTMLInputElement>) => { if (is_disabled) return; if (props.leaveFunction) props.leaveFunction(event); else props.saveFunction(); } : undefined}
                    onKeyDown={autoSave ? (event: KeyboardEvent<HTMLInputElement>) => { if (event.key === "Escape") props.onRevert?.(); } : undefined} />
                {is_editable
                ? null
                :
                    <div className={styles.entry_edit_cover} onClick={revealEditAuthKey}>
                        <button type="button" className={styles.edit_button}>{t("config_page.common.edit_button_label")}</button>
                    </div>
                }
            </div>
        </div>
    );
    if (!autoSave) return field;
    return (
        <div className={problemStyles.field} data-invalid={error ? "true" : undefined}>
            {field}
            {error && <FieldProblem id={errorId} text={error} />}
        </div>
    );
};
