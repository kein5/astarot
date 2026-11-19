import React, { useEffect, useRef } from "react";
import clsx from "clsx";
import { useI18n } from "@useI18n";
import { Tooltip } from "@common_components";
import styles from "./MessageSubMenuContainer.module.scss";
import SendMessageSvg from "@images/send_message.svg?react";
import RefreshSvg from "@images/refresh_2.svg?react";

export const MessageSubMenuContainer = (props) => {
    const { t } = useI18n();
    const progressRef = useRef(null);
    const currentHold = useRef(null);
    // Releasing a completed hold over the button still fires its click; that
    // click must not also run edit, which replaces the draft being typed.
    const resentByHold = useRef(false);
    // A key press handled here (Enter or Space): the browser's own click for it is not an edit.
    const keyHandled = useRef(false);

    const beginHold = hold => {
        resentByHold.current = false;
        currentHold.current = hold;
        if (progressRef.current) {
            progressRef.current.style.transition = "width 500ms linear";
            progressRef.current.style.width = "100%";
        }
        hold.timer = setTimeout(() => {
            if (currentHold.current !== hold) return;
            cancelHold();
            resentByHold.current = true;
            props.resendFunction();
            props.setIsHovered(false);
        }, 500);
    };

    const startHold = event => {
        keyHandled.current = false;
        if (event.button !== 0 || !event.isPrimary || currentHold.current) return;
        const hold = { pointerId: event.pointerId, target: event.currentTarget, timer: null };
        hold.target.setPointerCapture(hold.pointerId);
        beginHold(hold);
    };

    // The keyboard follows the same rule: holding Enter or Space resends, a short press edits.
    const isActivationKey = event => event.key === "Enter" || event.key === " ";
    const startKeyHold = event => {
        if (!isActivationKey(event)) return;
        event.preventDefault();
        if (event.repeat || currentHold.current) return;
        keyHandled.current = false;
        beginHold({ key: event.key, timer: null });
    };
    const endKeyHold = event => {
        if (!isActivationKey(event)) return;
        event.preventDefault();
        const hold = currentHold.current;
        if (hold?.key === event.key) {
            // Released before the hold completed: an edit.
            cancelHold();
            keyHandled.current = true;
            props.editFunction();
        } else if (!hold && resentByHold.current) {
            // Released after the hold resent the message: nothing more.
            resentByHold.current = false;
            keyHandled.current = true;
        }
    };

    const cancelHold = () => {
        const hold = currentHold.current;
        currentHold.current = null;
        if (hold) {
            clearTimeout(hold.timer);
            if (hold.target?.hasPointerCapture(hold.pointerId)) hold.target.releasePointerCapture(hold.pointerId);
        }
        if (progressRef.current) {
            progressRef.current.style.transition = "none";
            progressRef.current.style.width = "0%";
        }
    };

    const moveHold = event => {
        const hold = currentHold.current;
        if (!hold || event.pointerId !== hold.pointerId) return;
        const rect = hold.target.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) cancelHold();
    };

    useEffect(() => {
        window.addEventListener("blur", cancelHold);
        return () => {
            window.removeEventListener("blur", cancelHold);
            cancelHold();
        };
    }, []);

    const onClickFunction = event => {
        // Enter and Space were handled on their key events; a click the browser still
        // makes from them is not a second edit.
        if (keyHandled.current && event?.detail === 0) {
            keyHandled.current = false;
            return;
        }
        keyHandled.current = false;
        const after_hold = resentByHold.current;
        resentByHold.current = false;
        // Any other keyboard activation (detail 0) is a deliberate edit.
        if (after_hold && event?.detail !== 0) return;
        props.editFunction();
    };

    const offset = {
        popper: {
            sx: {
                marginBottom: "0.2em"
            }
        }
    };

    return (
        <div className={clsx(styles.container, { [styles.is_shown]: props.is_shown })}>
            <Tooltip
                title={<Title_p />}
                placement="top"
                slotProps={offset}
            >
                <button
                type="button"
                aria-label={t("main_page.message_log.resend_button_label")}
                className={styles.resend_button}
                onPointerDown={startHold}
                onPointerUp={cancelHold}
                onPointerLeave={cancelHold}
                onPointerMove={moveHold}
                onPointerCancel={cancelHold}
                onLostPointerCapture={cancelHold}
                onKeyDown={startKeyHold}
                onKeyUp={endKeyHold}
                onBlur={cancelHold}
                onClick={onClickFunction}
                >
                    <SendMessageSvg className={styles.send_message_svg} />
                    <RefreshSvg className={styles.refresh_svg} />
                    <div ref={progressRef} className={styles.hold_progress_bar}></div>
                </button>
            </Tooltip>
        </div>
    );
};

const Title_p = () => {
    const { t } = useI18n();
    // The words take the tooltip's own size and colour (the tooltip_content mixin).
    return <p>{t("main_page.message_log.resend_button_on_hover_desc")}</p>;
};
