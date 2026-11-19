import type { ReactNode } from "react";
import {
    RadioButton,
} from "../index";
import { _DownloadButton } from "../_atoms/_download_button/_DownloadButton";
import type { DownloadOption } from "../_atoms/_download_button/_DownloadButton";

// One model of the choice: its download state and how its option reads.
export interface DownloadModelOption extends DownloadOption {
    label: string;
    desc?: ReactNode;
    desc_tone?: string;
    keep_desc?: boolean;
    capacity?: ReactNode;
}

export interface DownloadModelsProps {
    name: string;
    options: readonly DownloadModelOption[];
    checked_variable: { state?: string; data?: unknown };
    selectFunction: (id: string) => void;
    downloadStartFunction: (id: string) => void;
    label?: string;
    "aria-labelledby"?: string;
    "aria-describedby"?: string;
}

export const DownloadModels = (props: DownloadModelsProps) => {
    const options = props.options.map(item => ({
        ...item,
        disabled: !item.is_downloaded
    }));

    return (
        <>
            <RadioButton
                label={props.label}
                aria-labelledby={props["aria-labelledby"]}
                aria-describedby={props["aria-describedby"]}
                selectFunction={props.selectFunction}
                name={props.name}
                options={options}
                checked_variable={props.checked_variable}
                column={true}
                ChildComponent={_DownloadButton}
                downloadStartFunction={props.downloadStartFunction}
            />
        </>
    );
};