import type { RealtimeSession } from "./realtimeCaptionState";

// Windows holds a microphone's open until its permission question on the desktop is answered, which
// cannot be seen from inside a VR headset (#1300, decided on 2026-11-28). The core reports
// `capture_waiting` once Mic input's open has run 3 s; while its captions start, the screens say that
// Windows may be asking (useMicCaptureWait.ts).
export const micCaptureWaiting = (mic: RealtimeSession | undefined): boolean => mic?.state === "starting" && mic.capture_waiting === true;

// The notice's id: shown once for a wait, and taken away when the wait ends.
export const MIC_CAPTURE_WAIT_NOTICE = "realtime:mic_capture_wait";
