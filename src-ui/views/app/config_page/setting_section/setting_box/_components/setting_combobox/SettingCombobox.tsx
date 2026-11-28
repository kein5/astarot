import type { ReactNode } from "react";
import { Combobox } from "../../../../../../kit/index.ts";
import type { ComboboxGroup, ComboboxOption } from "../../../../../../kit/index.ts";
import * as styles from "./SettingCombobox.css.ts";

// One choice of a settings row, by the row family's names, as RadioButton takes them: the id it
// sends back, its words, and whether it can be chosen now.
export interface SettingComboboxOption {
    id: string;
    label: string;
    disabled?: boolean;
    // Other words it is found by.
    keywords?: readonly string[];
}

export interface SettingComboboxGroup {
    id: string;
    label: string;
    options: readonly SettingComboboxOption[];
}

export interface SettingComboboxProps {
    name: string;
    options?: readonly SettingComboboxOption[];
    groups?: readonly SettingComboboxGroup[];
    // The chosen option's id, as the store holds it: "pending" while a choice waits on the engine.
    checked_variable: { state?: string; data?: unknown };
    selectFunction: (id: string) => void;
    // The button's words while nothing is chosen.
    placeholder?: ReactNode;
    search_label: string;
    search_placeholder?: string;
    empty_text: ReactNode;
    "aria-labelledby"?: string;
    "aria-describedby"?: string;
}

const optionOf = ({ id, label, disabled, keywords }: SettingComboboxOption): ComboboxOption => ({ value: id, label, disabled, keywords });

// A choice among many on a settings page, found by typing: the kit's Combobox (#1369) in the place
// of a long list of radio buttons. It takes RadioButton's props, so a page moves its choice from
// one to the other as it is (the speech recognition and text to speech engines can follow). The
// row's label names it and the row's description and note describe it. While a choice waits on
// the engine it stays in its place and in the Tab order, and does not open.
export const SettingCombobox = (props: SettingComboboxProps) => {
    const groups: ComboboxGroup[] | undefined = props.groups?.map(group => ({ id: group.id, label: group.label, options: group.options.map(optionOf) }));
    const value = props.checked_variable.data;
    return (
        <div className={styles.container}>
            <Combobox
                value={typeof value === "string" ? value : undefined}
                onValueChange={props.selectFunction}
                groups={groups}
                options={groups ? undefined : (props.options ?? []).map(optionOf)}
                placeholder={props.placeholder}
                searchLabel={props.search_label}
                searchPlaceholder={props.search_placeholder}
                emptyText={props.empty_text}
                busy={props.checked_variable.state === "pending"}
                // The row puts it at its right end: the list lines up with that edge.
                align="end"
                aria-labelledby={props["aria-labelledby"]}
                aria-describedby={props["aria-describedby"]}
            />
        </div>
    );
};
