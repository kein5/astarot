import { createElement } from "react";
import type { ReactNode } from "react";
import { useStore_NotificationStatus } from "@store";
import type { NotificationOptions } from "@store";
import { toast } from "react-toastify";
import { TranslatedNotice } from "./TranslatedNotice";

export type NotificationKind = "warning" | "error" | "success";

export const useNotificationStatus = () => {
    const { currentNotificationStatus, updateNotificationStatus } = useStore_NotificationStatus();
    const showNotification = (status: NotificationKind, message: ReactNode, options: NotificationOptions = {}) => {
        updateNotificationStatus({
            status,
            is_open: true,
            category_id: options.category_id ?? null,
            message,
            options,
        });
    };

    const showNotification_Warning = (message: ReactNode, options?: NotificationOptions) => showNotification("warning", message, options);
    const showNotification_Error = (message: ReactNode, options?: NotificationOptions) => showNotification("error", message, options);
    const showNotification_Success = (message: ReactNode, options?: NotificationOptions) => showNotification("success", message, options);

    const showNotification_SaveSuccess = (options: NotificationOptions = {}) => {
        options = { hide_duration: 1000, to_hide_progress_bar: true, ...options };
        updateNotificationStatus({
            status: "success",
            is_open: true,
            category_id: "save_success",
            // The backend can save during startup (it switches mute sync off, for one),
            // before the saved UI language is applied.
            message: createElement(TranslatedNotice, { k: "config_page.notifications.save_success" }),
            options: options,
        });
    };

    // Close one notification by its category_id (the snackbar uses it as the toast id).
    // A notification that never hides blocks a new one with the same id, so close it first.
    const dismissNotification = (category_id: string) => toast.dismiss(category_id);

    const closeNotification = () => {
        updateNotificationStatus((prev) => ({
            ...prev.data,
            is_open: false,
        }));
    };

    return {
        currentNotificationStatus,
        updateNotificationStatus,

        showNotification_Warning,
        showNotification_Error,
        showNotification_Success,
        showNotification_SaveSuccess,
        closeNotification,
        dismissNotification,
    };
};
