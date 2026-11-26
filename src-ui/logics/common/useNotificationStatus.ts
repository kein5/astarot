import type { ReactNode } from "react";
import { useStore_NotificationStatus } from "@store";
import type { NotificationOptions } from "@store";
import { toast } from "react-toastify";
import { noticesQuiet } from "./noticeScope.ts";

export type NotificationKind = "warning" | "error" | "success";

export const useNotificationStatus = () => {
    const { currentNotificationStatus, updateNotificationStatus } = useStore_NotificationStatus();
    const showNotification = (status: NotificationKind, message: ReactNode, options: NotificationOptions = {}) => {
        // A line that answers the other window's request: that window says it (#1236).
        if (noticesQuiet()) return;
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
        closeNotification,
        dismissNotification,
    };
};
