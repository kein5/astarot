import React, { useRef, useState, useEffect, useCallback } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import styles from "./Slider.module.scss";
import clsx from "clsx";
import { useSliderLogic } from "@logics_configs";
import type { SliderSetterTiming } from "../../../../../../../logics/configs/config_page_setter/useSettingsLogics";

export interface SliderProps {
    variable: number;
    state?: string;
    // false, or a promise of false, when the value was not sent: the slider goes back.
    setterFunction: (value: number) => unknown;
    setter_timing?: SliderSetterTiming;
    debounce_ms?: number;
    postUpdateAction?: () => void;
    min: number;
    max: number;
    step?: number;
    show_label_values?: readonly number[] | null;
    marks_step?: number;
    // Where the value's bubble sits: "top" and so on (Slider.module.scss).
    valueLabelDisplayLocation?: string;
    // "on" always shows it; "auto" while the pointer is on the slider, it is dragged or focused.
    valueLabelDisplay?: string;
    // The value as shown, before valueLabelFormat.
    valueLabelFunction?: (value: number) => number | string;
    // A function of the shown value, or a text whose "value" is replaced by it.
    valueLabelFormat?: string | ((value: number | string) => string);
    orientation?: "horizontal" | "vertical";
    // false leaves out the filled part of the track.
    track?: boolean;
    className?: string;
    no_padding?: boolean;
    is_break_point?: boolean;
    // Names the slider when it is text and no aria-label is given.
    label?: ReactNode;
    "aria-label"?: string;
    "aria-describedby"?: string;
    // A slider that cannot be used: half as strong, out of the tab order, and moved by neither
    // the pointer nor the keys (shadcn/ui's disabled).
    disabled?: boolean;
}

export const Slider = (props: SliderProps) => {
    const location = props.valueLabelDisplayLocation || "top";
    const {
        ui_value,
        onChangeFunction,
        onChangeCommittedFunction,
        marks
    } = useSliderLogic({
        variable: props.variable,
        state: props.state,
        setterFunction: props.setterFunction,
        setter_timing: props.setter_timing,
        debounce_ms: props.debounce_ms,
        postUpdateAction: props.postUpdateAction,
        min: props.min,
        max: props.max,
        step: props.step,
        show_label_values: props.show_label_values,
        marks_step: props.marks_step,
    });

    const isVertical = props.orientation === "vertical";
    // A slider that cannot be used, as shadcn/ui's (Radix's) disabled: half as strong, out of the
    // tab order, and neither the pointer nor the keys move it.
    const disabled = props.disabled === true;
    const min = props.min !== undefined ? Number(props.min) : 0;
    const max = props.max !== undefined ? Number(props.max) : 100;
    const step = props.step == null ? null : Number(props.step);

    const trackRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const [isFocused, setIsFocused] = useState(false);

    const decimalPlaces = step && step.toString().includes('.')
        ? step.toString().split('.')[1].length
        : 0;

    const [localValue, setLocalValue] = useState(ui_value);

    // Sync localValue with ui_value (from store) only when NOT dragging
    useEffect(() => {
        if (!isDragging) {
            setLocalValue(ui_value);
        }
    }, [ui_value, isDragging]);

    const calculateValue = useCallback((clientX: number, clientY: number) => {
        if (!trackRef.current) return localValue;
        const rect = trackRef.current.getBoundingClientRect();
        let percentage;
        if (isVertical) {
            let y = clientY - rect.top;
            y = Math.max(0, Math.min(y, rect.height));
            percentage = 1 - (y / rect.height);
        } else {
            let x = clientX - rect.left;
            x = Math.max(0, Math.min(x, rect.width));
            percentage = x / rect.width;
        }

        let rawValue = percentage * (max - min) + min;
        if (step) {
            const steps = Math.round((rawValue - min) / step);
            // Use decimalPlaces + 2 for intermediate to avoid rounding issues, then final toFixed(decimalPlaces)
            rawValue = parseFloat((steps * step + min).toFixed(decimalPlaces + 2));
            rawValue = parseFloat(rawValue.toFixed(decimalPlaces));
        }
        return Math.max(min, Math.min(rawValue, max));
    }, [isVertical, max, min, step, localValue, decimalPlaces]);

    const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
        if (disabled || e.button !== 0) return; // Only left click
        setIsDragging(true);
        const newValue = calculateValue(e.clientX, e.clientY);
        setLocalValue(newValue);
        if (newValue !== ui_value) {
            onChangeFunction?.(newValue);
        }
        e.preventDefault();

        // Ensure thumb gets focus-like behavior manually, though we rely on drag state
    };

    const dragRef = useRef({ calculateValue, ui_value, onChangeFunction, onChangeCommittedFunction });
    dragRef.current = { calculateValue, ui_value, onChangeFunction, onChangeCommittedFunction };

    useEffect(() => {
        if (!isDragging) return;

        const handlePointerMove = (e: PointerEvent) => {
            const { calculateValue, ui_value, onChangeFunction } = dragRef.current;
            const newValue = calculateValue(e.clientX, e.clientY);
            setLocalValue(newValue);
            if (newValue !== ui_value) {
                onChangeFunction?.(newValue);
            }
        };

        const handlePointerUp = (e: PointerEvent) => {
            const { calculateValue, onChangeCommittedFunction } = dragRef.current;
            setIsDragging(false);
            const newValue = calculateValue(e.clientX, e.clientY);
            setLocalValue(newValue);
            if (onChangeCommittedFunction) {
                onChangeCommittedFunction(newValue);
            }
        };

        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);

        return () => {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerUp);
        };
    }, [isDragging]);

    // Keyboard: arrows move one step, PageUp/PageDown ten, Home/End to the
    // ends. Each key is a finished change, like releasing the pointer.
    const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
        if (disabled) return;
        const unit = step || (max - min) / 100;
        const moves: Record<string, number> = {
            ArrowRight: unit, ArrowUp: unit, ArrowLeft: -unit, ArrowDown: -unit,
            PageUp: unit * 10, PageDown: -unit * 10,
        };
        let next: number;
        if (e.key in moves) next = localValue + moves[e.key];
        else if (e.key === "Home") next = min;
        else if (e.key === "End") next = max;
        else return;
        e.preventDefault();
        next = Math.max(min, Math.min(parseFloat(next.toFixed(decimalPlaces)), max));
        if (next === localValue) return;
        setLocalValue(next);
        onChangeFunction?.(next);
        if (onChangeCommittedFunction) onChangeCommittedFunction(next);
    };

    const handleMouseEnter = () => {
        setIsHovered(true);
    };

    const handleMouseLeave = () => {
        setIsHovered(false);
    };

    const percentage = Math.max(0, Math.min((localValue - min) / (max - min), 1)) * 100;

    const valueLabelStr = (() => {
        let displayValue: number | string = localValue;
        if (typeof props.valueLabelFunction === "function") {
            displayValue = props.valueLabelFunction(localValue);
        }

        if (typeof props.valueLabelFormat === "function") {
            return props.valueLabelFormat(displayValue);
        } else if (typeof props.valueLabelFormat === "string") {
            return props.valueLabelFormat.replace("value", String(displayValue));
        }

        return displayValue;
    })();
    const valueLabelDisplay = props.valueLabelDisplay || "auto";
    const showValueLabel = valueLabelDisplay === "on" || (valueLabelDisplay === "auto" && (isHovered || isDragging || isFocused));
    const accessibleName = props["aria-label"] ?? (typeof props.label === "string" ? props.label : undefined);

    return (
        <div
            className={clsx(
                styles.container,
                props.className,
                {
                    [styles.no_padding]: props.no_padding || props.is_break_point,
                }
            )}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            <div
                className={clsx(styles.sliderRoot, {
                    [styles.vertical]: isVertical,
                    [styles.horizontal]: !isVertical,
                    [styles.dragging]: isDragging
                })}
                ref={trackRef}
                data-disabled={disabled ? "" : undefined}
                onPointerDown={handlePointerDown}
            >
                <div className={styles.rail}></div>
                {props.track !== false && (
                    <div
                        className={styles.track}
                        style={{
                            ...(isVertical ? { bottom: "0%", height: `${percentage}%` } : { left: "0%", width: `${percentage}%` })
                        }}
                    ></div>
                )}

                {marks && marks.map((mark, i) => {
                    const markPercent = Math.max(0, Math.min((mark.value - min) / (max - min), 1)) * 100;
                    return (
                        <div
                            key={i}
                            className={styles.mark}
                            style={{
                                ...(isVertical ? { bottom: `${markPercent}%` } : { left: `${markPercent}%` })
                            }}
                        >
                            {mark.label && (
                                <span className={styles.markLabel}>
                                    {mark.label}
                                </span>
                            )}
                        </div>
                    );
                })}

                <div
                    className={clsx(styles.thumb, { [styles.thumbActive]: isDragging })}
                    role="slider"
                    tabIndex={disabled ? undefined : 0}
                    aria-disabled={disabled || undefined}
                    aria-label={accessibleName}
                    aria-describedby={props["aria-describedby"]}
                    aria-valuemin={min}
                    aria-valuemax={max}
                    aria-valuenow={localValue}
                    aria-valuetext={String(valueLabelStr)}
                    aria-orientation={isVertical ? "vertical" : "horizontal"}
                    onKeyDown={handleKeyDown}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                    style={{
                        ...(isVertical ? { bottom: `${percentage}%` } : { left: `${percentage}%` })
                    }}
                >
                    <div className={clsx(styles.valueLabel, styles[`location-${location}`], {
                        [styles.valueLabelOpen]: showValueLabel
                    })}>
                        <span className={styles.valueLabelLabel}>{valueLabelStr}</span>
                    </div>
                </div>
            </div>
        </div>
    );
};
