import { useEffect, useLayoutEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { useI18n } from "@useI18n";
import { useNotificationStatus } from "@logics_common";
import { useMainFunction } from "@logics_main";
import { useOcrSharedWindow } from "@logics_configs";
import { endedNotice, shouldHoldSwitch, shouldStopSharing } from "../../../logics/configs/ocrSharedWindow";

// The window shared with chat reading (Linux, Wayland) follows chat reading: turning it off
// ends the sharing, and when the desktop or the window ends it, the user is told. Nothing here
// starts sharing: that is the button in the settings (OcrSharedWindow.jsx), and the user turning
// chat reading on again where a window was shared before (_useBackendErrorHandling.js).
export const OcrSharedWindowController = () => {
    const { t } = useI18n();
    const { currentOcrCaptureStatus, pendingOcrCaptureStatus } = useMainFunction();
    const { currentOcrSharedWindow, refresh, stop, ended } = useOcrSharedWindow();
    const { showNotification_Warning, showNotification_Error } = useNotificationStatus();
    const latest = useRef({ t, ended, showNotification_Warning, showNotification_Error });
    latest.current = { t, ended, showNotification_Warning, showNotification_Error };

    useEffect(() => {
        refresh();
        let disposed = false, unlisten: UnlistenFn | null = null;
        listen<unknown>("screencast-ended", ({ payload }) => {
            const { t, ended, showNotification_Warning, showNotification_Error } = latest.current;
            ended();
            // The reason, when the payload is an object that has one; endedNotice reads anything else as an error.
            const reason = typeof payload === "object" && payload !== null && "reason" in payload ? payload.reason : undefined;
            const notice = endedNotice(reason);
            const show = notice.status === "warning" ? showNotification_Warning : showNotification_Error;
            show(t(notice.key), { category_id: "ocr_shared_window" });
        }).then(stopListening => {
            if (disposed) stopListening();
            else unlisten = stopListening;
        }).catch(() => { /* Not running inside the app (browser preview): there is no desktop to share from. */ });
        return () => {
            disposed = true;
            unlisten?.();
        };
    }, []);

    const on = currentOcrCaptureStatus.data, settled = currentOcrCaptureStatus.state === "ok";
    const wasOn = useRef(on);
    useEffect(() => {
        if (!settled) return;
        if (shouldStopSharing(wasOn.current, on, currentOcrSharedWindow.data?.active)) stop();
        wasOn.current = on;
    }, [on, settled]);

    // Sharing the remembered window again: the switch waits instead of reading "off" in between.
    // Before paint, so the "off" the failed first start reported is never shown.
    const hold = shouldHoldSwitch(currentOcrSharedWindow.data, settled, on);
    useLayoutEffect(() => {
        if (hold) pendingOcrCaptureStatus();
    }, [hold]);
    return null;
};
