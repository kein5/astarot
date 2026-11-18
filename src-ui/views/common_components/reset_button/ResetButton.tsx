import type { MouseEventHandler } from "react";
import styles from "./ResetButton.module.scss";
import RedoSvg from "@images/redo.svg?react";

export interface ResetButtonProps {
    onClickFunction?: MouseEventHandler<HTMLButtonElement>;
    label?: string;
}

export const ResetButton = ({ onClickFunction, label }: ResetButtonProps) => {
    return (
        <button type="button" className={styles.reset_button} onClick={onClickFunction} aria-label={label}>
            <RedoSvg className={styles.reset_svg} aria-hidden="true"/>
        </button>
    );
};
