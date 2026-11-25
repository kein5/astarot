import React from "react";
import type { ComponentType, SVGProps } from "react";
import { useI18n } from "@useI18n";
import * as styles from "./VolumeCheckButton.css.ts";
import { Toggle } from "../../../../../../../kit/index.ts";

export interface VolumeCheckButtonProps {
    // Whether the check runs, as the store holds it: "pending" while the engine answers.
    isChecking: { state?: string; data?: unknown };
    startFunction: () => void;
    stopFunction: () => void;
    SvgComponent: ComponentType<SVGProps<SVGSVGElement>>;
}

// The volume check, as the kit's Toggle at the compact size beside the threshold (D-27, decided
// on 2026-11-25): pressed while the check runs. While the engine answers it stays focusable
// (aria-disabled), drawn as one that cannot be used, and a press waits, so a second press cannot
// start it twice. Enter and Space act on the key going down, once while it is held, as they did
// before the kit: the key's own press of the button is held back so it does not act twice.
export const VolumeCheckButton = React.memo((props: VolumeCheckButtonProps) => {
    const { t } = useI18n();
    const is_pending = props.isChecking.state === "pending";
    const toggleFunction = () => {
        if (is_pending) return;
        if (props.isChecking.data === true) {
            props.stopFunction();
        } else if (props.isChecking.data === false) {
            props.startFunction();
        }
    };

    return (
        <div>
            <Toggle size="compact" pressed={props.isChecking.data === true} aria-disabled={is_pending} onPressedChange={toggleFunction}
                onKeyDown={event => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); if (event.repeat) return; toggleFunction(); } }}>
                <props.SvgComponent className={styles.button_svg} aria-hidden="true" />
                <span>{t("config_page.device.check_volume")}</span>
            </Toggle>
        </div>
    );
});


VolumeCheckButton.displayName = "VolumeCheckButton";
