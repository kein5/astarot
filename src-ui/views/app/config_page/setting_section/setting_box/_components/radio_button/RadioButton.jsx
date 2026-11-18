import styles from "./RadioButton.module.scss";
import clsx from "clsx";
import { useI18n } from "@useI18n";

// `groups` ([{ id, label, options }]) splits the options under visible group names, such as the
// speech recognition engines' two systems (#414). They stay one choice: the radios share one
// name, so the arrow keys move through every group and Tab stops once. Each group is a
// radiogroup named by its label, inside a group named by the row's label.
export const RadioButton = (props) => {
    const { t } = useI18n();
    const options = props.groups ? props.groups.flatMap(group => group.options) : props.options;
    const has_desc = options.some((option) => Boolean(option.desc));
    const pending = props.checked_variable.state === "pending";
    const containerClass = clsx(styles.container, {
        [styles.column]: props.column === true,
        [styles.has_desc]: has_desc && !props.groups,
        [styles.grouped]: Boolean(props.groups),
    });
    const naming = { "aria-labelledby": props["aria-labelledby"], "aria-label": props["aria-labelledby"] ? undefined : props.label,
        "aria-describedby": props["aria-describedby"] };

    const radio = (option) => {
        const radioWrapperClass = clsx(styles.radio_button_container, {
            [styles.is_selected]: props.checked_variable.data === option.id,
        });

        const labelClass = clsx(styles.radio_button_wrapper, {
            [styles.is_selected]: props.checked_variable.data === option.id,
            [styles.disabled]: option.disabled === true || pending,
            [styles.has_desc]: Boolean(option.desc),
        });

        return (
            <div key={option.id} className={radioWrapperClass}>
                <label className={labelClass}>
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
                        />
                        <div className={styles.label_heading_wrapper}>
                            <p className={styles.radio_button_label}>{option.label}</p>
                            {option.capacity && (
                                <span className={styles.capacity_label}>{option.capacity}</span>
                            )}
                        </div>
                    </div>
                    {option.desc && (
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
