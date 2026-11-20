import clsx from "clsx";
import { useId } from "react";
import type { ComponentType, ReactNode } from "react";

import styles from "./Templates.module.scss";
import { useStore_IsBreakPoint } from "@store";
import {
    LabelComponent,
    DropdownMenu,
    MultiDropdownMenu,
    Slider,
    EntryWithSaveButton,
    ColorEntryWithSaveButton,
    HotkeysEntry,
    RadioButton,
    AuthKey,
    ActionButton,
    WordFilter,
    DownloadModels,
    MessageFormat,
    ConnectionCheckButton,
} from "../_components";
import type { LabelComponentProps } from "../_components/label_component/LabelComponent";
import type { DropdownMenuProps, MultiDropdownEntry } from "../_components/dropdown_menu/DropdownMenu";
import type { SliderProps } from "../_components/slider/Slider";
import type { EntryWithSaveButtonProps } from "../_components/entry_with_save_button/EntryWithSaveButton";
import type { ColorEntryWithSaveButtonProps } from "../_components/color_entry_with_save_button/ColorEntryWithSaveButton";
import type { HotkeysEntryProps } from "../_components/hotkeys_entry/HotkeysEntry";
import type { RadioButtonProps, RadioOption } from "../_components/radio_button/RadioButton";
import type { AuthKeyProps } from "../_components/auth_key/AuthKey";
import type { ActionButtonProps } from "../_components/action_button/ActionButton";
import type { DownloadModelsProps } from "../_components/download_models/DownloadModels";
import type { MessageFormatProps } from "../_components/message_format/MessageFormat";
import type { ConnectionCheckButtonProps } from "../_components/connection_check_button/ConnectionCheckButton";
import { Checkbox } from "@common_components";
import type { CheckboxProps } from "../../../../../common_components/checkbox/Checkbox";
import { useI18n } from "@useI18n";

// What a row of the settings takes besides its control's own props: the label column, where the
// row sits among the others and where its control sits, and the setting it is for the settings
// search (data-setting-id). The control gets the rest of the props too.
export interface TemplateRowProps extends LabelComponentProps {
    setting_id?: string;
    // "no_label" draws the control alone, "label_only" the label alone (the two-row templates).
    label_type?: "label_component" | "no_label" | "label_only";
    // Stack the label over the control in a narrow window.
    add_break_point?: boolean;
    flex_column?: boolean;
    remove_border_bottom?: boolean;
    // Where the control sits in the field column: its end (a checkbox) or its start (a lone button).
    control_align?: "start" | "end";
    "aria-describedby"?: string;
}

// The props the row gives its control besides the page's: how the label, the description and
// the warnings name it, and whether the window is narrow.
export interface TemplateControlProps {
    label_id: string;
    description_id: string | undefined;
    warnings_id: string | undefined;
    "aria-labelledby": string;
    "aria-describedby": string | undefined;
    is_break_point: boolean;
}

// What useTemplateAccessibility reads: the ids already given (by the first row of a two-row
// template) and what has a lead, a description or warnings.
interface AccessibilitySource {
    label_id?: string;
    lead_id?: string;
    lead?: string;
    description_id?: string;
    warnings_id?: string;
    desc?: ReactNode;
    add_warnings?: readonly unknown[];
    "aria-describedby"?: string;
}

// The props CommonContainer takes for itself; the label and the control get the others.
type ContainerOwnKey = "label_type" | "add_break_point" | "flex_column" | "remove_border_bottom" | "control_align" | "Component" | "setting_id";

// The control's props: the row's props without the ones the container takes, and the ones it adds.
export type TemplateControlOf<T> = Omit<T, ContainerOwnKey> & Omit<TemplateControlProps, "is_break_point"> & { is_break_point: boolean };

// The props of a CommonContainer row: the row's own, ids for the settings search, and the control.
// T is the whole set of props it is given, so its control is typed by them.
interface CommonContainerBase<T> extends TemplateRowProps {
    Component?: ComponentType<TemplateControlOf<T>>;
    hotkey_id?: string;
    dropdown_id?: string;
    name?: string;
    id?: string;
}

// Keep IDs stable through pending/error updates, including the two-row templates.
const useTemplateAccessibility = (props: AccessibilitySource) => {
    const id = useId();
    const label_id = props.label_id ?? `${id}-label`;
    // The sentence that stays on screen is read before the details of the hint.
    const lead_id = props.lead_id ?? (props.lead ? `${id}-lead` : undefined);
    const description_id = props.description_id ?? (props.desc ? `${id}-description` : undefined);
    const warnings_id = props.warnings_id ?? (props.add_warnings?.length ? `${id}-warnings` : undefined);
    return { label_id, lead_id, description_id, warnings_id,
        "aria-labelledby": label_id,
        "aria-describedby": [...new Set([props["aria-describedby"], lead_id, description_id, warnings_id].filter((value): value is string => Boolean(value)).flatMap(value => value.split(" ")))].join(" ") || undefined };
};

export type DropdownMenuContainerProps = TemplateRowProps & DropdownMenuProps;

export const DropdownMenuContainer = (props: DropdownMenuContainerProps) => {
    const accessibility = useTemplateAccessibility(props);
    return (
        <TemplatesContainerWrapper {...props}>
            <LabelComponent {...props} {...accessibility} />
            <DropdownMenu {...props} {...accessibility} />
        </TemplatesContainerWrapper>
    );
};

// P: the props of a part shown among the dropdowns (DropdownInsert).
export type MultiDropdownMenuContainerProps<P> = TemplateRowProps & { dropdown_settings: readonly MultiDropdownEntry<P>[] };

export const MultiDropdownMenuContainer = <P extends object>(props: MultiDropdownMenuContainerProps<P>) => {
    const accessibility = useTemplateAccessibility(props);
    const { currentIsBreakPoint } = useStore_IsBreakPoint();

    return (
        <TemplatesContainerWrapper {...props}>
            <LabelComponent {...props} {...accessibility} />
            <MultiDropdownMenu {...accessibility} dropdown_settings={props.dropdown_settings} is_break_point={currentIsBreakPoint.data} />
        </TemplatesContainerWrapper>
    );
};

interface TemplatesContainerWrapperProps {
    children?: ReactNode;
    add_break_point?: boolean;
    flex_column?: boolean;
    remove_border_bottom?: boolean;
    control_align?: "start" | "end";
    setting_id?: string;
    label?: ReactNode;
    // The setting's other ids, used when it has no setting_id.
    dropdown_id?: string;
    hotkey_id?: string;
    name?: string;
    id?: string;
}

const TemplatesContainerWrapper = ({
    children,
    add_break_point = true,
    flex_column = false,
    remove_border_bottom = false,
    control_align,
    setting_id,
    label,
    ...rest
}: TemplatesContainerWrapperProps) => {
    const { currentIsBreakPoint } = useStore_IsBreakPoint();

    const container_class = clsx(styles.container, {
        [styles.is_break_point]: add_break_point && currentIsBreakPoint.data,
        [styles.flex_column]: flex_column,
        [styles.remove_border_bottom]: remove_border_bottom,
        // Where the control sits in the field column: a checkbox at its right end (#473),
        // a lone button at its start; everything else fills it (#567).
        [styles.control_end]: control_align === "end",
        [styles.control_start]: control_align === "start",
    });

    const target_setting_id = setting_id ?? rest.dropdown_id ?? rest.hotkey_id ?? rest.name ?? rest.id;
    const target_label = typeof label === "string" ? label : undefined;

    return (
        <div
            className={container_class}
            data-setting-id={target_setting_id || undefined}
            data-setting-label={target_label || undefined}
            data-hint-row
        >
            {children}
        </div>
    );
};

const CommonContainer = <T extends CommonContainerBase<T>>({
    label_type = "label_component",
    add_break_point = true,
    flex_column = false,
    remove_border_bottom = false,
    control_align,
    Component,
    setting_id,
    ...props
}: T) => {
    const { currentIsBreakPoint } = useStore_IsBreakPoint();

    const accessibility = useTemplateAccessibility(props);
    // setting_id is taken out above, so a setting without one is found by its other ids.
    const target_setting_id = setting_id ?? props.hotkey_id ?? props.dropdown_id ?? props.name ?? props.id;

    const container_wrapper_props = {
        add_break_point: add_break_point,
        flex_column: flex_column,
        remove_border_bottom: remove_border_bottom,
        control_align: control_align,
        setting_id: target_setting_id,
        label: props.label,
    };

    // Every template but the label-only row gives a Component.
    if (label_type === "label_component") {
        return (
            <TemplatesContainerWrapper {...container_wrapper_props}>
                <LabelComponent {...props} {...accessibility} />
                {Component && <Component {...props} {...accessibility} is_break_point={currentIsBreakPoint.data} />}
            </TemplatesContainerWrapper>
        );
    } else if (label_type === "no_label") {
        return (
            <TemplatesContainerWrapper {...container_wrapper_props}>
                {Component && <Component {...props} {...accessibility} is_break_point={currentIsBreakPoint.data} />}
            </TemplatesContainerWrapper>
        );
    } else if (label_type === "label_only") {
        return (
            <TemplatesContainerWrapper {...container_wrapper_props}>
                <LabelComponent {...props} {...accessibility} />
            </TemplatesContainerWrapper>
        );
    }
};


export type SliderContainerProps = TemplateRowProps & SliderProps;

export const SliderContainer = (props: SliderContainerProps) => (
    // Starts where the field column starts, like every other field (#567).
    <CommonContainer Component={Slider} no_padding={true} {...props} />
);

export type CheckboxContainerProps = TemplateRowProps & Omit<CheckboxProps, "aria-describedby">;

export const CheckboxContainer = (props: CheckboxContainerProps) => (
    <CommonContainer Component={Checkbox} {...props} add_break_point={false} control_align="end" />
);

export type EntryWithSaveButtonContainerProps = TemplateRowProps & EntryWithSaveButtonProps;

export const EntryWithSaveButtonContainer = (props: EntryWithSaveButtonContainerProps) => (
    <CommonContainer Component={EntryWithSaveButton} {...props} add_break_point={false} />
);

export type ColorEntryWithSaveButtonContainerProps = TemplateRowProps & ColorEntryWithSaveButtonProps;

export const ColorEntryWithSaveButtonContainer = (props: ColorEntryWithSaveButtonContainerProps) => (
    <CommonContainer Component={ColorEntryWithSaveButton} {...props} add_break_point={false} />
);

export type HotkeysEntryContainerProps = TemplateRowProps & HotkeysEntryProps;

export const HotkeysEntryContainer = (props: HotkeysEntryContainerProps) => (
    <CommonContainer Component={HotkeysEntry} {...props} />
);

export type RadioButtonContainerProps<O extends RadioOption = RadioOption> = TemplateRowProps & RadioButtonProps<O>;

export const RadioButtonContainer = <O extends RadioOption>(props: RadioButtonContainerProps<O>) => (
    <CommonContainer Component={RadioButton} {...props} control_align="start" />
);

// The key's page opens from the link under the label (webpage_url).
export type AuthKeyContainerProps = TemplateRowProps & AuthKeyProps;

export const AuthKeyContainer = (props: AuthKeyContainerProps) => {
    const { t } = useI18n();

    return (
        <CommonContainer
            Component={AuthKey}
            webpage_url={props.webpage_url}
            open_webpage_label={t("config_page.common.open_auth_key_webpage")}
            {...props}
        />
    );
};

export type ActionButtonContainerProps = TemplateRowProps & ActionButtonProps;

export const ActionButtonContainer = (props: ActionButtonContainerProps) => (
    <CommonContainer Component={ActionButton} {...props} add_break_point={false} control_align="start"/>
);



export const WordFilterContainer = (props: TemplateRowProps) => {
    const accessibility = useTemplateAccessibility(props);
    return (
        <div data-setting-id={props.setting_id || "mic_word_filter"}>
            {/* The label and its description; the entry and the registered words, a fold of their
                own (WordFilter), start on the row's left edge under it (#437). */}
            <CommonContainer
                remove_border_bottom={true}
                label_type="label_only"
                {...props}
                {...accessibility}
            />
            <CommonContainer
                Component={WordFilter}
                label_type="no_label"
                {...props}
                {...accessibility}
            />
        </div>
    );
};

export type DownloadModelsContainerProps = TemplateRowProps & DownloadModelsProps;

export const DownloadModelsContainer = (props: DownloadModelsContainerProps) => (
    <CommonContainer Component={DownloadModels} {...props} control_align="start" />
);

export type ConnectionCheckButtonContainerProps = TemplateRowProps & ConnectionCheckButtonProps;

export const ConnectionCheckButtonContainer = (props: ConnectionCheckButtonContainerProps) => (
    <CommonContainer Component={ConnectionCheckButton} {...props} control_align="start" />
);

export type MessageFormatContainerProps = TemplateRowProps & MessageFormatProps;

export const MessageFormatContainer = (props: MessageFormatContainerProps) => {
    const accessibility = useTemplateAccessibility(props);
    return (
        <div data-setting-id={props.setting_id}>
            <CommonContainer
                remove_border_bottom={true}
                label_type="label_only"
                {...props}
                {...accessibility}
            />
            <CommonContainer
                Component={MessageFormat}
                label_type="no_label"
                {...props}
                {...accessibility}
            />
        </div>
    );
};
