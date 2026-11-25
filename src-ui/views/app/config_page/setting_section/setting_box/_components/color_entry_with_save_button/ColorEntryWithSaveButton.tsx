import { useId, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { HexColorPicker } from "react-colorful";

import * as styles from "./ColorEntryWithSaveButton.css.ts";
import { _Entry } from "../_atoms/_entry/_Entry";
import { FieldProblem } from "../field_problem/FieldProblem";
import * as problemStyles from "../field_problem/FieldProblem.css.ts";
import { clsx } from "clsx";
import { useI18n } from "@useI18n";
import { Popover, PopoverContent, PopoverTrigger } from "../../../../../../kit/index.ts";

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
// Room the picker keeps from the window's edges, in px (0.8rem).
const WINDOW_MARGIN = 8;

export interface ColorEntryWithSaveButtonProps {
    label?: ReactNode;
    width?: string;
    // The color as #RRGGBB; anything else shows an empty swatch.
    variable?: string | null;
    // "pending" while a save waits for the backend.
    state?: string;
    onChangeFunction?: (value: string) => void;
    saveFunction: () => unknown;
    "aria-describedby"?: string;
    // Saves by itself (#1111): leaving the field, or closing the picker after choosing, saves as
    // Enter does, and Escape in the field puts the saved color back (onRevert).
    onRevert?: () => void;
    // What is wrong with the color and what would do, said under the field (#1111).
    error?: string | null;
}

export const ColorEntryWithSaveButton = (props: ColorEntryWithSaveButtonProps) => {
    const { t } = useI18n();
    const is_disabled = props.state === "pending";
    const errorId = useId();
    const error = props.error || null;
    const [is_open, setIsOpen] = useState(false);
    const swatch_ref = useRef<HTMLButtonElement>(null);
    // Whether the picker closes because of a press outside it (not on the swatch), which leaves the
    // focus where it went.
    const pressed_outside = useRef(false);

    const current_color = typeof props.variable === "string" ? props.variable.trim() : "";
    const is_valid_color = HEX_COLOR_RE.test(current_color);
    const swatch_color = is_valid_color ? current_color : "transparent";
    const picker_color = is_valid_color ? current_color : "#FFFFFF";

    const onChangeFunction = (e: ChangeEvent<HTMLInputElement>) => {
        if (props.state === "pending") return;
        props.onChangeFunction?.(e.target.value);
    };

    const onPickerChange = (color: string) => {
        if (props.state === "pending") return;
        props.onChangeFunction?.(color);
    };

    // The latest save: the picker closes after a color is chosen, from the props of that moment.
    const latestSave = useRef(props.saveFunction);
    latestSave.current = props.saveFunction;
    // Closing the picker after choosing a color saves it when the field saves by itself.
    const closePicker = () => {
        setIsOpen(false);
        if (!is_disabled) latestSave.current();
    };

    const saveFunction = () => {
        setIsOpen(false);
        props.saveFunction();
    };

    const swatch_button_class_names = clsx(styles.swatch_button, {
        [styles.is_disabled]: is_disabled,
    });

    const handleEnterPressed = () => {
        if (is_disabled) return;
        saveFunction();
    };

    const field = (
        <div className={styles.container}>
            <_Entry
                label={props.label}
                width={props.width}
                onChange={onChangeFunction}
                onEnterPressed={handleEnterPressed}
                ui_variable={props.variable}
                readOnly={is_disabled} aria-busy={is_disabled} aria-disabled={is_disabled}
                aria-describedby={[props["aria-describedby"], error ? errorId : null].filter(Boolean).join(" ") || undefined}
                aria-invalid={error ? true : undefined}
                onBlur={() => { if (!is_disabled) props.saveFunction(); }}
                // With the picker open, Escape closes it (and keeps the chosen color); otherwise it
                // puts the saved color back.
                onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => { if (event.key === "Escape" && !is_open) props.onRevert?.(); }}
            />
            {/* The picker is the kit's Popover (D-25, decided on 2026-11-25), opened by the swatch.
                It opens under the swatch, or over it where there is no room below, its right edge on the
                swatch's, as the swatch ends the row; it stays in the window, 0.8rem from its edges. It is drawn right after the swatch, not at the end of the page, so Tab goes
                from the swatch into the picker. Opening it leaves the focus on the swatch. Pressing
                the swatch again keeps it open, as does the focus leaving it; Escape or a press outside
                closes it and saves the chosen color. After Escape the focus goes back to the swatch, as
                the focus stays in the open picker (Radix's focus scope loops). While a save waits, the
                swatch does not open it. */}
            <div className={styles.swatch_wrapper}>
                <Popover open={is_open} onOpenChange={open => { if (open) setIsOpen(true); else closePicker(); }}>
                    <PopoverTrigger asChild>
                        <button
                            ref={swatch_ref}
                            className={swatch_button_class_names}
                            type="button"
                            aria-label={t("config_page.common.open_color_picker", { label: props.label })}
                            aria-expanded={is_open}
                            aria-disabled={is_disabled}
                            onClick={event => { if (is_open || is_disabled) event.preventDefault(); }}
                        >
                            <span className={styles.swatch} style={{ backgroundColor: swatch_color }} />
                        </button>
                    </PopoverTrigger>
                    <PopoverContent portal={false} side="bottom" align="end" collisionPadding={WINDOW_MARGIN}
                        aria-label={t("config_page.common.open_color_picker", { label: props.label })}
                        onOpenAutoFocus={event => { event.preventDefault(); }}
                        onFocusOutside={event => { event.preventDefault(); }}
                        onPointerDownOutside={event => {
                            const swatch = swatch_ref.current;
                            if (!swatch || !event.detail.originalEvent.composedPath().includes(swatch)) pressed_outside.current = true;
                        }}
                        onCloseAutoFocus={event => {
                            event.preventDefault();
                            if (!pressed_outside.current) swatch_ref.current?.focus({ preventScroll: true });
                            pressed_outside.current = false;
                        }}>
                        <div className={styles.popover_content}>
                            <HexColorPicker color={picker_color} onChange={onPickerChange} />
                        </div>
                    </PopoverContent>
                </Popover>
            </div>
        </div>
    );
    return (
        <div className={problemStyles.field} data-invalid={error ? "true" : undefined}>
            {field}
            {error && <FieldProblem id={errorId} text={error} />}
        </div>
    );
};
