import styles from "./RadioButton.module.scss";
import clsx from "clsx";
import type { ComponentType, ReactNode } from "react";
import { Hint, useHintDescriptions } from "../hint/Hint";

export interface RadioOption {
    // A string as a rule. The flow strip's caption count has numbers, which the choice sends back
    // as they are.
    id: string | number;
    label: ReactNode;
    desc?: ReactNode;
    // "warning" keeps the description on screen, in the warning color.
    desc_tone?: string;
    keep_desc?: boolean;
    disabled?: boolean;
    // A size beside the label, such as a model's.
    capacity?: ReactNode;
}

export interface RadioGroup<O extends RadioOption> {
    id: string;
    label: ReactNode;
    options: readonly O[];
}

export interface RadioButtonProps<O extends RadioOption = RadioOption> {
    name: string;
    options?: readonly O[];
    groups?: readonly RadioGroup<O>[];
    // The chosen option's id, as the store holds it: "pending" while a choice waits on the engine.
    checked_variable: { state?: string; data?: unknown };
    selectFunction: (id: O["id"]) => void;
    column?: boolean;
    // Names the choice when no aria-labelledby is given.
    label?: string;
    // Drawn under each option, with the option and these props (a model's download button).
    ChildComponent?: ComponentType<RadioChildProps<O>>;
    downloadStartFunction?: (id: string) => void;
    "aria-labelledby"?: string;
    "aria-describedby"?: string;
}

export type RadioChildProps<O extends RadioOption> = RadioButtonProps<O> & { option: O };

// On a page that keeps descriptions out of sight (#614) an option's description is its hint,
// opened by the pointer on the option or keyboard focus on its radio. A warning, or a text the
// option marks keep_desc (a license to read before a download), stays under the option.
const asHint = (hints: boolean, option: RadioOption): option is RadioOption & { desc: string } =>
    hints && typeof option.desc === "string" && option.desc_tone !== "warning" && !option.keep_desc;

// `groups` ([{ id, label, options }]) splits the options under visible group names, such as the
// speech recognition engines' two systems (#414). They stay one choice: the radios share one
// name, so the arrow keys move through every group and Tab stops once. Each group is a
// radiogroup named by its label, inside a group named by the row's label.
export const RadioButton = <O extends RadioOption>(props: RadioButtonProps<O>) => {
    const hints = useHintDescriptions();
    // One of the two is given.
    const options: readonly O[] = props.groups ? props.groups.flatMap(group => group.options) : props.options ?? [];
    const has_desc = options.some((option) => Boolean(option.desc) && !asHint(hints, option));
    const pending = props.checked_variable.state === "pending";
    const containerClass = clsx(styles.container, {
        [styles.column]: props.column === true,
        [styles.has_desc]: has_desc && !props.groups,
        [styles.grouped]: Boolean(props.groups),
    });
    const naming = { "aria-labelledby": props["aria-labelledby"], "aria-label": props["aria-labelledby"] ? undefined : props.label,
        "aria-describedby": props["aria-describedby"] };

    const radio = (option: O) => {
        const radioWrapperClass = clsx(styles.radio_button_container, {
            [styles.is_selected]: props.checked_variable.data === option.id,
        });

        const hint = asHint(hints, option);
        const hintId = hint ? `${props.name}-${option.id}-hint` : undefined;
        const labelClass = clsx(styles.radio_button_wrapper, {
            [styles.is_selected]: props.checked_variable.data === option.id,
            [styles.disabled]: option.disabled === true || pending,
            [styles.has_desc]: Boolean(option.desc) && !hint,
        });

        return (
            <div key={option.id} className={radioWrapperClass}>
                <label className={labelClass} data-hint-host={hint || undefined}>
                    <div className={styles.radio_button_header}>
                        {/* While a choice waits on the engine the radios look and read as disabled and
                            ignore presses, but stay focusable: a disabled radio would drop the
                            keyboard focus of the one just chosen. */}
                        <input
                            type="radio"
                            className={styles.radio_button_input}
                            name={props.name}
                            value={option.id}
                            onChange={() => { if (!pending) props.selectFunction(option.id); }}
                            checked={props.checked_variable.data === option.id}
                            disabled={option.disabled === true}
                            aria-disabled={pending && option.disabled !== true ? true : undefined}
                            aria-describedby={hintId}
                        />
                        <div className={styles.label_heading_wrapper}>
                            <p className={styles.radio_button_label}>{option.label}</p>
                            {option.capacity && (
                                <span className={styles.capacity_label}>{option.capacity}</span>
                            )}
                            {/* A disabled radio takes neither the pointer nor focus: the mark of an
                                option that cannot be chosen takes both, so why it cannot is still read. */}
                            {hint && <Hint text={option.desc} id={hintId} focusable={option.disabled === true} />}
                        </div>
                    </div>
                    {option.desc && !hint && (
                        <p className={clsx(styles.radio_button_desc, {
                            [styles.desc_warning]: option.desc_tone === "warning",
                        })}>{option.desc}</p>
                    )}
                </label>
                {props.ChildComponent && <props.ChildComponent option={option} {...props} />}
            </div>
        );
    };

    if (props.groups) {
        return (
            <div className={containerClass} role="group" {...naming}>
                {pending && <span className={styles.loader}></span>}
                {props.groups.map(group => {
                    const label_id = `${props.name}-${group.id}-label`;
                    return (
                        <div key={group.id} className={styles.group} data-radio-group={group.id}>
                            <p id={label_id} className={styles.group_label}>{group.label}</p>
                            <div className={styles.group_options} role="radiogroup" aria-labelledby={label_id}>
                                {group.options.map(radio)}
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    }

    return (
        <div className={containerClass} role="radiogroup" {...naming}>
            {pending && <span className={styles.loader}></span>}
            {options.map(radio)}
        </div>
    );
};
