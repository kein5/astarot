import { useMicCaptureWaitSource } from "../../../logics/transcription/useMicCaptureWait";

// Says, on the desktop and in the VR panel, that Windows may be asking whether ASTAROT may use the
// microphone while Mic input's microphone waits to open (#1300).
export const MicCaptureWaitController = () => {
    useMicCaptureWaitSource();
    return null;
};
