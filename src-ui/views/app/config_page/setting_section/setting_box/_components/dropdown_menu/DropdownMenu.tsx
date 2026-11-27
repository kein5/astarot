import clsx from "clsx";
import type { ChangeEvent, ComponentType, KeyboardEvent, MouseEvent, ReactNode } from "react";
import { useI18n } from "@useI18n";
import * as styles from "./DropdownMenu.css.ts";
import { Select, SelectOption } from "../../../../../../kit/index.ts";

// The choices of a select field, { id: words }. [] until a list the backend sends arrives
// (SettingOptions).
export type DropdownList = Readonly<Record<string, string | number>> | [];

// What a select field reports when one of its choices is picked.
export interface DropdownSelection {
    dropdown_id: string;
    selected_id: string;
}

export interface DropdownMenuProps {
    // Names the setting in what the field reports, and the row for the settings search.
    dropdown_id: string;
    list?: DropdownList;
    selected_id?: string | number | null;
    // "pending" while the value waits for the backend; the choices show only when "ok".
    state?: string;
    is_disabled?: boolean;
    selectFunction: (selection: DropdownSelection) => void;
    // Both name the field when they are text.
    label?: ReactNode;
    secondary_label?: ReactNode;
    "aria-describedby"?: string;
}

// One select field of a row, or of a row of select fields.
export type MultiDropdownSetting = DropdownMenuProps & { insert_component?: undefined; insert_to?: undefined };

// Another part in the row of select fields, such as a checkbox: before them, after them, or among
// them (no insert_to). P is the props the part is drawn with.
export interface DropdownInsert<P> {
    insert_component: ComponentType<P>;
    insert_component_props: P;
    insert_to?: "before" | "after";
    dropdown_id?: string;
}

export type MultiDropdownEntry<P> = MultiDropdownSetting | DropdownInsert<P>;

export interface MultiDropdownMenuProps<P> {
    dropdown_settings: readonly MultiDropdownEntry<P>[];
    is_break_point?: boolean;
    "aria-labelledby"?: string;
    "aria-describedby"?: string;
}

// The list as a record; an empty list arrives as [].
const choicesOf = (list: DropdownList | undefined): Readonly<Record<string, string | number>> =>
    list === undefined || Array.isArray(list) ? {} : list;

// What the core holds for a device choice when it found no audio system or device, as the value, as
// the list's only entry, or as the name of a device with no id: said in the screen's words, never
// as the raw value (#1266).
const NONE_FOUND: readonly string[] = ["NoHost", "NoDevice"];

// The kit's select (a native <select>): the system draws the open list and gives the keys.
// While the value waits for the backend, the field says so and neither the pointer nor the keys
// open it; it stays focused if it was, so a choice made with the keys keeps its place (the
// disabled attribute would take focus away). A value the list does not hold, such as a device
// that is gone or the words saying a key is needed, still shows on the closed field.
export const DropdownMenu = (props: DropdownMenuProps) => {
    const { t } = useI18n();
    const choices = choicesOf(props.list);
    const pending = props.state === "pending";
    const current = props.selected_id === null || props.selected_id === undefined ? "" : String(props.selected_id);
    const choose = (event: ChangeEvent<HTMLSelectElement>) => {
        if (pending) return;
        props.selectFunction({ dropdown_id: props.dropdown_id, selected_id: event.target.value });
    };
    // Tab still leaves a waiting field.
    const hold = (event: MouseEvent<HTMLSelectElement> | KeyboardEvent<HTMLSelectElement>) => {
        if (pending && !("key" in event && event.key === "Tab")) event.preventDefault();
    };

    const options = () => {
        if (pending) return <SelectOption value={current}>{t("common.loading")}</SelectOption>;
        if (props.state !== "ok") return null;
        // The value, or the words of a device the core names so (a device with no id).
        const wordsOf = (key: string, words: string | number): string | number => NONE_FOUND.includes(key) || NONE_FOUND.includes(String(words)) ? t("config_page.device.none_found") : words;
        const entries = Object.entries(choices).map(([key, words]) => <SelectOption key={key} value={key}>{wordsOf(key, words)}</SelectOption>);
        if (current in choices) return entries;
        return <>
            <SelectOption value={current} disabled hidden>{wordsOf(current, current)}</SelectOption>
            {entries}
        </>;
    };

    return (
        <div className={styles.each_dropdown_menu_wrapper}>
            {props.secondary_label && <p className={styles.secondary_label}>{props.secondary_label}</p>}
            <Select
                value={current}
                onChange={choose}
                onMouseDown={hold}
                onKeyDown={hold}
                disabled={props.is_disabled}
                tabIndex={pending ? -1 : undefined}
                aria-busy={pending || undefined}
                aria-disabled={pending || undefined}
                aria-label={[props.label, props.secondary_label].filter(text => typeof text === "string").join(" ") || undefined}
                aria-describedby={props["aria-describedby"]}
            >
                {options()}
            </Select>
        </div>
    );
};

export const MultiDropdownMenu = <P extends object>(props: MultiDropdownMenuProps<P>) => {
    const container_class = clsx(styles.container, {
        [styles.is_break_point]: props.is_break_point,
    });

    return (
        <div className={container_class} role="group" aria-labelledby={props["aria-labelledby"]} aria-describedby={props["aria-describedby"]}>
            {(() => {
                const beforeInserts: { props: DropdownInsert<P>; key: string }[] = [];
                const afterInserts: { props: DropdownInsert<P>; key: string }[] = [];
                const innerSettings: { props: MultiDropdownEntry<P>; key: string }[] = [];

                props.dropdown_settings.forEach((dropdown_props, index) => {
                    if (dropdown_props.insert_component && dropdown_props.insert_to === "before") {
                        beforeInserts.push({ props: dropdown_props, key: `before-${index}` });
                    } else if (dropdown_props.insert_component && dropdown_props.insert_to === "after") {
                        afterInserts.push({ props: dropdown_props, key: `after-${index}` });
                    } else {
                        innerSettings.push({ props: dropdown_props, key: dropdown_props.dropdown_id || `inner-${index}` });
                    }
                });

                return (
                    <>
                        {beforeInserts.map((item) => {
                            const InsertComponent = item.props.insert_component;
                            return <InsertComponent key={item.key} {...item.props.insert_component_props} />;
                        })}

                        <div className={styles.wrapper}>
                            {innerSettings.map((item) => {
                                const dropdown_props = item.props;
                                // The inserts here have no insert_to: the others went before or after.
                                if (dropdown_props.insert_component) {
                                    const InsertComponent = dropdown_props.insert_component;
                                    return <InsertComponent key={item.key} {...dropdown_props.insert_component_props} />;
                                }
                                return <DropdownMenu key={item.key} {...dropdown_props} aria-describedby={[props["aria-describedby"], dropdown_props["aria-describedby"]].filter(Boolean).join(" ") || undefined} />;
                            })}
                        </div>

                        {afterInserts.map((item) => {
                            const InsertComponent = item.props.insert_component;
                            return <InsertComponent key={item.key} {...item.props.insert_component_props} />;
                        })}
                    </>
                );
            })()}
        </div>
    );
};
