import { useId, useRef, useState } from "react";
import clsx from "clsx";
import { useI18n } from "@useI18n";
import { Button, TextField } from "../../../../../../kit/index.ts";
import type { TextFieldProps } from "../../../../../../kit/index.ts";
import { filePatterns, pickPath } from "../../../../../../../logics/common/pickPath.ts";
import type { PathPick, PickedPath } from "../../../../../../../logics/common/pickPath.ts";
import { FieldProblem } from "../field_problem/FieldProblem";
import * as problemStyles from "../field_problem/FieldProblem.css.ts";
import * as styles from "./PathField.css.ts";

// A path on the user's PC is typed, pasted or picked (#1231): beside its field, a button opens the
// system's file picker, showing only the kinds of file the field takes, or its folder picker. A
// picked path fills the field as typing does; a cancel changes nothing.

export interface PathPickButtonProps {
    pick: PathPick;
    // The field's name, which the button's accessible name and the picker's title say.
    label: string;
    // The field's value: the picker opens in its folder.
    current: string | null | undefined;
    disabled?: boolean;
    onPicked: (path: string) => void;
    // The picker could not open; the field stays the way to enter the path.
    onUnavailable: (code: Extract<PickedPath, { ok: false }>["error_code"]) => void;
}

export const PathPickButton = ({ pick, label, current, disabled = false, onPicked, onUnavailable }: PathPickButtonProps) => {
    const { t } = useI18n();
    // One picker at a time. The button stays enabled while it is open, so focus comes back to it.
    const open = useRef(false);
    const file = pick.kind === "file";
    const action = t(file ? "path_picker.choose_file_for" : "path_picker.choose_folder_for", { field: label });
    const choose = async () => {
        if (open.current || disabled) return;
        open.current = true;
        try {
            const extensions = file ? pick.extensions ?? [] : [];
            const picked = await pickPath(pick, current ?? null, action, t("path_picker.filter", { patterns: filePatterns(extensions) }));
            if (!picked.ok) onUnavailable(picked.error_code);
            else if (picked.path !== null) onPicked(picked.path);
        } finally {
            open.current = false;
        }
    };
    return <Button disabled={disabled} aria-label={action} data-path-pick={pick.kind} onClick={() => { void choose(); }}>
        {t(file ? "path_picker.choose_file" : "path_picker.choose_folder")}
    </Button>;
};

export type PathFieldProps = Omit<TextFieldProps, "value" | "onChange" | "type" | "mono"> & {
    value: string;
    // What the field holds now, typed or picked alike.
    onChange: (value: string) => void;
    pick: PathPick;
    label: string;
};

// The field and its button on one line in the field column, the button at the row's right edge
// (DESIGN.md "Field widths"); the button goes under the field when the column is narrow. A setting
// row (FormRow) gives the field its label's id and its description.
export const PathField = ({ value, onChange, pick, label, disabled, className, "aria-describedby": describedBy, ...field }: PathFieldProps) => {
    const { t } = useI18n();
    const [unavailable, setUnavailable] = useState<string | null>(null);
    const problemId = useId();
    const change = (next: string) => {
        setUnavailable(null);
        onChange(next);
    };
    return <div className={clsx(problemStyles.field, styles.path_field, className)} data-path-field={pick.kind}>
        <div className={styles.line}>
            <TextField mono value={value} disabled={disabled} spellCheck={false} {...field}
                aria-describedby={[describedBy, unavailable ? problemId : null].filter(Boolean).join(" ") || undefined}
                onChange={event => change(event.target.value)} />
            <PathPickButton pick={pick} label={label} current={value} disabled={disabled} onPicked={change}
                onUnavailable={code => setUnavailable(t(`path_picker.${code}`))} />
        </div>
        {unavailable && <FieldProblem id={problemId} text={unavailable} />}
    </div>;
};
