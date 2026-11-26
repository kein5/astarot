import { useEffect, useRef } from "react";
import { useI18n } from "@useI18n";
import { useNotificationStatus } from "@logics_common";
import { store } from "@store";
import { useTalkAiSession } from "../../../logics/talk_ai/useTalkAiSession.ts";
import { errorKeys, isActive } from "../../../logics/talk_ai/talkAi.ts";

// How often the open conversation's status is asked for: whether the voice and the screen are
// being sent, which the core says only when asked. The core's notices (/run/talk_ai_status) say
// when it is ready and when it ends.
export const TALK_AI_POLL_MS = 1000;

// Keeps the Talk AI status current while a conversation is open, and says where the user is when
// it ended by a failure (the settings page may be closed by then).
export const TalkAiController = () => {
    const { t } = useI18n();
    const { view, poll } = useTalkAiSession();
    const { showNotification_Error } = useNotificationStatus();
    const open = isActive(view.status) || view.pending === "start" || view.pending === "audio" || view.pending === "screen";
    useEffect(() => {
        if (!open) return;
        const timer = setInterval(() => { if (!store.backend_stopped) void poll(); }, TALK_AI_POLL_MS);
        return () => clearInterval(timer);
    }, [open, poll]);

    const previous = useRef(view.status.phase);
    useEffect(() => {
        const before = previous.current;
        previous.current = view.status.phase;
        if (view.status.phase === "failed" && (before === "connecting" || before === "ready")) {
            showNotification_Error(t("talk_ai.ended_with_error", { reason: t(errorKeys(view.status.error ?? "other"), { code: view.status.error ?? "-" }) }),
                { category_id: "talk_ai_failed" });
        }
    }, [view.status.phase, view.status.error]);
    return null;
};
