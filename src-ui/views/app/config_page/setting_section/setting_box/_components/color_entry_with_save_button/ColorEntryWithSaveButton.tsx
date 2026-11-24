import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { HexColorPicker } from "react-colorful";

import * as styles from "./ColorEntryWithSaveButton.css.ts";
import { _Entry } from "../_atoms/_entry/_Entry";
import { FieldProblem } from "../field_problem/FieldProblem";
import * as problemStyles from "../field_problem/FieldProblem.css.ts";
import { clsx } from "clsx";
import { useI18n } from "@useI18n";
import type { TargetHolder } from "../../../../../../../logics/common/targetHolder.ts";

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const PICKER_GAP_REM = 0.4;
const VIEWPORT_PADDING_REM = 0.8;

const remToPx = (rem: number) => {
    const root_font_size = parseFloat(getComputedStyle(document.documentElement).fontSize);
    return rem * root_font_size;
};

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
    autoSave?: boolean;
    onRevert?: () => void;
    // What is wrong with the color and what would do, said under the field (#1111).
    error?: string | null;
}

export const ColorEntryWithSaveButton = (props: ColorEntryWithSaveButtonProps) => {
    const { t } = useI18n();
    const is_disabled = props.state === "pending";
    const autoSave = !!props.autoSave;
    const errorId = useId();
    const error = autoSave && props.error ? props.error : null;
    const [is_open, setIsOpen] = useState(false);
    const [placement, setPlacement] = useState({ open_above: true, align_end: true });
    const popover_ref = useRef<HTMLDivElement>(null);
    const swatch_ref = useRef<HTMLButtonElement>(null);

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

    const openPicker = () => {
        if (is_disabled) return;
        setIsOpen(true);
    };

    // The latest save: the picker's listeners are added when it opens, before a color is chosen.
    const latestSave = useRef(props.saveFunction);
    latestSave.current = props.saveFunction;
    // Closing the picker after choosing a color saves it when the field saves by itself.
    const closePicker = () => {
        setIsOpen(false);
        if (autoSave && !is_disabled) latestSave.current();
    };

    const saveFunction = () => {
        setIsOpen(false);
        props.saveFunction();
    };

    useLayoutEffect(() => {
        if (!is_open) return;

        const updatePlacement = () => {
            const swatch = swatch_ref.current;
            const popover = popover_ref.current;
            if (!swatch || !popover) return;

            const swatch_rect = swatch.getBoundingClientRect();
            const popover_height = popover.offsetHeight;
            const popover_width = popover.offsetWidth;
            const gap = remToPx(PICKER_GAP_REM);
            const viewport_padding = remToPx(VIEWPORT_PADDING_REM);

            const space_below = window.innerHeight - swatch_rect.bottom - gap - viewport_padding;
            const space_above = swatch_rect.top - gap - viewport_padding;
            const space_right = window.innerWidth - swatch_rect.left - viewport_padding;

            setPlacement({
                open_above: space_below < popover_height && space_above > space_below,
                align_end: space_right < popover_width,
            });
        };

        updatePlacement();
        window.addEventListener("resize", updatePlacement);
        return () => {
            window.removeEventListener("resize", updatePlacement);
        };
    }, [is_open]);

    useEffect(() => {
        if (!is_open) return;
        const onDocumentMouseDown = (event: MouseEvent) => {
            const popover: TargetHolder | null = popover_ref.current, swatch: TargetHolder | null = swatch_ref.current;
            if (popover?.contains(event.target)) return;
            if (swatch?.contains(event.target)) return;
            closePicker();
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") closePicker();
        };
        document.addEventListener("mousedown", onDocumentMouseDown);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("mousedown", onDocumentMouseDown);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [is_open]);

    const swatch_button_class_names = clsx(styles.swatch_button, {
        [styles.is_disabled]: is_disabled,
    });

    const popover_paper_class_names = clsx(
        styles.popover_paper,
        placement.open_above ? styles.open_above : styles.open_below,
        placement.align_end ? styles.align_end : styles.align_start,
    );

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
                onBlur={autoSave ? () => { if (!is_disabled) props.saveFunction(); } : undefined}
                // With the picker open, Escape closes it (and keeps the chosen color); otherwise it
                // puts the saved color back.
                onKeyDown={autoSave ? (event: ReactKeyboardEvent<HTMLInputElement>) => { if (event.key === "Escape" && !is_open) props.onRevert?.(); } : undefined}
            />
            <div className={styles.swatch_wrapper}>
                <button
                    ref={swatch_ref}
                    className={swatch_button_class_names}
                    type="button"
                    aria-label={t("config_page.common.open_color_picker", { label: props.label })}
                    aria-expanded={is_open}
                    aria-disabled={is_disabled}
                    onClick={openPicker}
                >
                    <span className={styles.swatch} style={{ backgroundColor: swatch_color }} />
                </button>
                {is_open && (
                    <div ref={popover_ref} className={popover_paper_class_names}>
                        <div className={styles.popover_content}>
                            <HexColorPicker color={picker_color} onChange={onPickerChange} />
                        </div>
                    </div>
                )}
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
