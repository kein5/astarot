import { useEffect, useRef } from "react";
import { ToastContainer, toast, cssTransition } from "react-toastify";
import type { TypeOptions } from "react-toastify";
import type { TFunction } from "i18next";
import { useStore } from "jotai";
import clsx from "clsx";

import "./ReactToastifyOverrideClass.css.ts";
import * as styles from "./SnackbarController.css.ts";

import WarningSvg from "@images/warning.svg?react";
import MegaphoneSvg from "@images/megaphone.svg?react";
import CheckMarkSvg from "@images/check_mark.svg?react";
import ErrorSvg from "@images/error.svg?react";

import { Atom_NotificationStatus } from "@store";
import type { NotificationStatus } from "@store";
import { useNotificationStatus, useIsOpenedConfigPage } from "@logics_common";
import { CloseButton } from "@common_components";
import { useI18n } from "@useI18n";

const CustomTransition = cssTransition({
    enter: "fade_in",
    exit: "fade_out",
    collapse: false,
});

// What the toast's callbacks read when they run: the words and the close of the latest render.
type Latest = { t: TFunction; closeNotification: () => void };

const TOAST_TYPES: readonly TypeOptions[] = ["info", "success", "warning", "error", "default"];
const toastType = (status: string): TypeOptions | undefined => TOAST_TYPES.find(type => type === status);

const showToast = (settings: NotificationStatus, latest: { readonly current: Latest }) => {
    let hide_duration: number | false = 5000;
    if (settings.options?.hide_duration === null) {
        hide_duration = false;
    } else if (Number(settings.options?.hide_duration)) {
        hide_duration = Number(settings.options?.hide_duration);
    }

    const message_text = settings.message;
    // A notice without its own category is known by its words. A notice whose message is an
    // element has no words to go by, so the library gives it an id of its own.
    const category_id = settings.category_id
        ? settings.category_id
        : typeof message_text === "string" || typeof message_text === "number" ? message_text : undefined;

    const to_hide_progress_bar = (settings.options?.to_hide_progress_bar === true) ? true : false;

    setTimeout(() => {
        toast(message_text, {
            toastId: category_id,
            type: toastType(settings.status),
            autoClose: hide_duration,
            transition: CustomTransition,
            hideProgressBar: to_hide_progress_bar,
            closeButton: ({ closeToast }) => <CloseButton size="small" aria-label={latest.current.t("common.dismiss_notification")} onClick={closeToast} />,
            onClose: () => {
                latest.current.closeNotification();
            },
        });
    }, 100);
};

export const SnackbarController = () => {
    const { t } = useI18n();
    const { closeNotification } = useNotificationStatus();
    const { currentIsOpenedConfigPage } = useIsOpenedConfigPage();
    const atoms = useStore();
    const latest = useRef<Latest>({ t, closeNotification });
    latest.current = { t, closeNotification };

    // Every notification is one write to a single atom. Several written in the
    // same tick reach React as one render, so an effect on the rendered value
    // saw only the last of them. The store reports each write. A write that
    // keeps the same notification object (a republish) is not a new one.
    useEffect(() => {
        let shown: NotificationStatus | null = null;
        const showLatest = () => {
            const settings = atoms.get(Atom_NotificationStatus).data;
            if (settings === shown) return;
            shown = settings;
            if (settings?.is_open) showToast(settings, latest);
        };
        showLatest();
        return atoms.sub(Atom_NotificationStatus, showLatest);
    }, [atoms]);

    return (
        <ToastContainer
            position="top-left"
            // One container for both pages, so a notice already showing moves
            // with the page instead of staying over the other page's controls.
            className={clsx({ [styles.over_settings]: currentIsOpenedConfigPage.data === true })}
            transition={CustomTransition}
            hideProgressBar={false}
            newestOnTop={false}
            closeOnClick={false}
            pauseOnFocusLoss={false}
            draggable={false}
            pauseOnHover={true}
            theme="dark"
            icon={({ type }) => {
                switch (type) {
                    case "info":
                        return <MegaphoneSvg className={styles.megaphone_svg} />;
                    case "error":
                        return <ErrorSvg className={styles.error_svg} />;
                    case "success":
                        return <CheckMarkSvg className={styles.check_mark_svg} />;
                    case "warning":
                        return <WarningSvg className={styles.warning_svg} />;
                    default:
                        return null;
                }
            }}
        />
    );
};
