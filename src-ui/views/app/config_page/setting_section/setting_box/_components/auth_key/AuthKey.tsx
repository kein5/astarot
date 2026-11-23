import * as styles from "./AuthKey.css.ts";
import { useI18n } from "@useI18n";
import { _Entry } from "../_atoms/_entry/_Entry";
import type { EntryHandle } from "../_atoms/_entry/_Entry";
import { useState, useRef, useEffect } from "react";
import type { ChangeEvent, ReactNode } from "react";

export interface AuthKeyProps {
    label?: ReactNode;
    // The saved key; "" or null when there is none, and the field opens for typing.
    variable?: string | null;
    // "pending" while a save waits for the backend.
    state?: string;
    onChangeFunction: (value: string) => void;
    saveFunction: () => unknown;
    "aria-describedby"?: string;
}

export const AuthKey = (props: AuthKeyProps) => {
    const { t } = useI18n();
    const [is_editable, seIsEditable] = useState(false);
    const entryRef = useRef<EntryHandle>(null);

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

    return (
        <div className={styles.container}>
            <div className={styles.entry_section_wrapper}>
                <_Entry ref={entryRef} label={props.label} spellCheck={false} autoComplete="off" onChange={onChangeEntryAuthKey} onEnterPressed={handleEnterPressed} ui_variable={props.variable} readOnly={is_disabled} aria-busy={is_disabled} aria-disabled={is_disabled} aria-describedby={props["aria-describedby"]}/>
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
};