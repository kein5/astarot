import { useEffect, useRef } from "react";
import { useI18n } from "@useI18n";
import { useStore_MicCaptureWaiting } from "@store";
import { useRealtimeASR } from "./useRealtimeASR";
import { useNotificationStatus } from "../common/useNotificationStatus";
import { MIC_CAPTURE_WAIT_NOTICE, micCaptureWaiting } from "./micCaptureWait";

// Main window only, once (MicCaptureWaitController): keeps the atom the VR panel's launcher reads, and
// says in a notice on the desktop that Windows may be asking, until the open returns (#1300).
export const useMicCaptureWaitSource = (): boolean => {
    const { t } = useI18n();
    const { state } = useRealtimeASR();
    const { currentMicCaptureWaiting, updateMicCaptureWaiting } = useStore_MicCaptureWaiting();
    const { showNotification_Warning, dismissNotification } = useNotificationStatus();
    const waiting = micCaptureWaiting(state.mic);
    const was = useRef(false);
    useEffect(() => {
        if (currentMicCaptureWaiting.data !== waiting) updateMicCaptureWaiting(waiting);
        if (waiting) showNotification_Warning(t("realtime.mic_permission_wait"), { category_id: MIC_CAPTURE_WAIT_NOTICE, hide_duration: null });
        else if (was.current) dismissNotification(MIC_CAPTURE_WAIT_NOTICE);
        was.current = waiting;
    }, [waiting]);
    return waiting;
};
