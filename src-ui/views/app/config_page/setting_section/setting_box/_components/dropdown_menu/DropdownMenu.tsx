import clsx from "clsx";
import type { ComponentType } from "react";
import styles from "./DropdownMenu.module.scss";
import { _DropdownMenu } from "../_atoms/_dropdown_menu/_DropdownMenu";
import type { DropdownMenuBaseProps } from "../_atoms/_dropdown_menu/_DropdownMenu";

export type DropdownMenuProps = DropdownMenuBaseProps;

// One dropdown of a row of dropdowns.
export type MultiDropdownSetting = DropdownMenuProps & { insert_component?: undefined; insert_to?: undefined };

// Another part in the row of dropdowns, such as a checkbox: before them, after them, or among
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

export const DropdownMenu = (props: DropdownMenuProps) => {
    return (
        <div className={styles.each_dropdown_menu_wrapper}>
            {props.secondary_label && <p className={styles.secondary_label}>{props.secondary_label}</p>}
            <_DropdownMenu {...props} />
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
                        {beforeInserts.map((item, i) => {
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