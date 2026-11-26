import { useEffect } from "react";
import { useI18n } from "@useI18n";
import { useTalkAiSession } from "../../../../logics/talk_ai/useTalkAiSession.ts";
import { isActive } from "../../../../logics/talk_ai/talkAi.ts";
import { Button } from "../../../kit/index.ts";
import * as styles from "./TalkAiIndicator.css.ts";

// What Talk AI is sending, above the main page and the settings alike, for as long as a
// conversation is open (ADR-018, 2.4): whom it talks with, that the voice goes, and the screen
// when it is shared, with the way to end it. The voice and the screen start only once this says
// so: they are asked for from this component's effects, which run after it is drawn
// (indicator_visible, docs/spec/ipc-protocol.md).
export const TalkAiIndicator = () => {
    const { t } = useI18n();
    const { view, sendAudio, sendScreen, stop } = useTalkAiSession();
    const { status, audio, screen, pending } = view;
    const shown = isActive(status) || pending === "start" || audio !== null;
    const name = view.partner?.name ?? "";
    const source = status.screen_source ?? screen?.source ?? null;

    useEffect(() => { if (shown && status.phase === "ready" && audio) sendAudio(); }, [shown, status.phase, status.session_id, audio, sendAudio]);
    useEffect(() => { if (shown && status.phase === "ready" && screen && !screen.sent) sendScreen(); }, [shown, status.phase, screen, sendScreen]);

    if (!shown) return null;
    const connecting = status.phase !== "ready";
    return <div className={styles.bar} role="status" aria-live="polite" data-talk-ai-indicator={connecting ? "connecting" : "sending"}>
        <span className={styles.mark} aria-hidden="true" />
        <p className={styles.words}>
            <span className={styles.name}>{t("talk_ai.indicator.title")}</span>
            <span>{connecting ? t("talk_ai.indicator.connecting", { name }) : t("talk_ai.indicator.voice", { name })}</span>
            {!connecting && source && <span>{t("talk_ai.indicator.screen", { source: t(`talk_ai.screen.source.${source}`) })}</span>}
        </p>
        <Button tone="danger" size="compact" className={styles.stop} disabled={pending === "stop"} onClick={() => void stop()}>
            {t("talk_ai.stop")}
        </Button>
    </div>;
};
