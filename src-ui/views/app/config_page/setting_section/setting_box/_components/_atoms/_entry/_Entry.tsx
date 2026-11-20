import clsx from "clsx";
import { useRef, forwardRef, useImperativeHandle } from "react";
import type { ChangeEvent, FocusEvent, HTMLAttributes, KeyboardEvent, ReactNode, WheelEvent } from "react";
import styles from "./_Entry.module.scss";

// What a parent may do with the field through its ref.
export interface EntryHandle {
    focus: () => void;
    blur: () => void;
}

export interface EntryProps {
    id?: string;
    // Names the field when no aria-label is given and it is text.
    label?: ReactNode;
    width?: string;
    type?: string;
    inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"];
    min?: number | string;
    max?: number | string;
    step?: number | string;
    placeholder?: string;
    ui_variable?: string | number | null;
    is_disabled?: boolean;
    is_activated?: boolean;
    readOnly?: boolean;
    spellCheck?: boolean;
    autoComplete?: string;
    onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
    onFocus?: (event: FocusEvent<HTMLInputElement>) => void;
    onBlur?: (event: FocusEvent<HTMLInputElement>) => void;
    onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
    onKeyUp?: (event: KeyboardEvent<HTMLInputElement>) => void;
    onWheel?: (event: WheelEvent<HTMLInputElement>) => void;
    onEnterPressed?: (event: KeyboardEvent<HTMLInputElement>) => void;
    "aria-label"?: string;
    "aria-labelledby"?: string;
    "aria-describedby"?: string;
    "aria-invalid"?: boolean;
    "aria-busy"?: boolean;
    "aria-disabled"?: boolean;
    "aria-controls"?: string;
    "aria-expanded"?: boolean;
}

const _Entry = forwardRef<EntryHandle, EntryProps>((props, ref) => {
    const inputRef = useRef<HTMLInputElement>(null);

    useImperativeHandle(ref, () => ({
        focus: () => {
            inputRef.current?.focus();
        },
        blur: () => {
            inputRef.current?.blur();
        }
    }));
    const is_disabled = props.is_disabled || false;
    const input_class_names = clsx(styles.entry_input_area, {
        [styles.is_disabled]: is_disabled || props["aria-disabled"] === true,
    });
    const input_wrapper_class_names = clsx(styles.entry_wrapper, {
        [styles.is_activated]: props.is_activated,
    });

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        props.onKeyDown?.(e);
        if (
            e.key === "Enter" &&
            !e.nativeEvent?.isComposing && !e.defaultPrevented && !props.readOnly && !is_disabled &&
            e.keyCode !== 229
        ) {
            props.onEnterPressed?.(e);
        }
    };

    return (
        <div
            className={styles.entry_container}
            style={{width: props.width || "100%" }}
        >
            <div className={input_wrapper_class_names}>
                <input
                    data-slot="input"
                    id={props.id}
                    aria-labelledby={props["aria-labelledby"]}
                    aria-describedby={props["aria-describedby"]}
                    aria-invalid={props["aria-invalid"]}
                    aria-busy={props["aria-busy"]}
                    aria-disabled={props["aria-disabled"]}
                    aria-controls={props["aria-controls"]}
                    aria-expanded={props["aria-expanded"]}
                    aria-label={props["aria-label"] ?? (typeof props.label === "string" ? props.label : undefined)}
                    type={props.type || "text"}
                    inputMode={props.inputMode}
                    min={props.min}
                    max={props.max}
                    step={props.step}
                    ref={inputRef}
                    placeholder={props.placeholder ? props.placeholder : ""}
                    className={input_class_names}
                    value={props.ui_variable ?? ""}
                    onChange={(e) => { if (!props.readOnly && !is_disabled) props.onChange?.(e); }}
                    onFocus={(e) => props.onFocus?.(e)}
                    onBlur={(e) => props.onBlur?.(e)}
                    onKeyDown={handleKeyDown}
                    onKeyUp={(e) => props.onKeyUp?.(e)}
                    onWheel={(e) => {
                        props.onWheel?.(e);
                        e.currentTarget.blur();
                    }}
                    spellCheck={props.spellCheck}
                    autoComplete={props.autoComplete}
                    readOnly={props.readOnly === true ? true : false}
                    disabled={is_disabled}
                />
            </div>
        </div>
    );
});

_Entry.displayName = "_Entry";

export { _Entry };
