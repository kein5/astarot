import { useEffect, useId } from "react";
import { useI18n } from "@useI18n";
import { useVoice } from "../../../../logics/voice/useVoice";
import { useVoiceAudition } from "../../../../logics/voice/useVoiceAudition";
import { useVirtualMic } from "../../../../logics/voice/useVirtualMic";
import { useStopVoice } from "../../../../logics/voice/useStopVoice";
import { somethingToStop } from "../../../../logics/voice/stopVoice.ts";
import { voiceActions } from "../../../../logics/voice/voiceActions.ts";
import { Tooltip } from "../../../common_components/tooltip/Tooltip";
import { StableWords } from "../../../common_components/stable_words/StableWords";
import { Button, Toggle } from "../../../kit/index.ts";

// Stop actions within reach during a conversation: on the main page and on
// every settings page. Stop sends the TTS page's stop (it also clears the
// queue). Mute is the route's mute: TTS on the external route, and the whole
// virtual microphone (TTS and converted voice) on the managed route. It has one
// name everywhere (voice_ui.mute_row: this button, the voice route row and the
// hotkey); its tooltip says what it silences. Both tooltips open below the bar, on the pointer
// and on keyboard focus, and their words are the buttons' accessible descriptions (kept in the
// page while the tooltips are closed).
// Stop is the kit's danger Button (D-10, decided on 2026-11-25): red words, no fill. It is offered
// only while there is something to stop (stopVoice.ts); otherwise it is aria-disabled, which the
// kit draws at half strength, and it keeps its place in the tab order and its tooltip, which says
// when it can be pressed. It answers its press (#937): it says "stopping" while the core is asked
// and takes no other press, then says "stopped" with a line for screen readers. Its words keep the
// room of the longest of them (StableWords), so mute beside it does not move; the shortest words
// of the narrowest layout stay.
// Mute is the kit's Toggle in its warning tone (D-27): amber while pressed. It shows the reported
// mute state; pressing it again asks to resume, which the backend allows only once the route is
// ready. Before a state is reported it is a plain mute action, not a toggle.
// classes: the host bar's stylesheet (stop_actions, stop, long, short, muted_badge, stop_status);
// each bar places the buttons. A bar with a `tiny` class also gets the shortest words, for its
// narrowest layout. size: the kit's size of both buttons in that bar.
export const StopActions = ({ classes, size }: { classes: Readonly<Record<string, string>>; size?: "regular" | "compact" }) => {
    const { t } = useI18n();
    const { status, route, send } = useVoice();
    const { audition } = useVoiceAudition();
    const { check } = useVirtualMic();
    const { stop: stopPress, press } = useStopVoice();
    useEffect(() => { send("/get/data/voice_status"); send("/get/data/voice_route"); }, [send]);
    // The backend reports a count; anything else counts as an empty queue.
    const queued = typeof status.queued === "number" ? status.queued : 0;
    const stop = queued > 0 ? t("voice_ui.topbar_stop_count", { count: queued }) : t("voice_ui.topbar_stop");
    const stopShort = queued > 0 ? t("voice_ui.topbar_stop_short_count", { count: queued }) : t("voice_ui.topbar_stop_short");
    const stopTiny = queued > 0 ? t("voice_ui.topbar_stop_tiny_count", { count: queued }) : t("voice_ui.topbar_stop_tiny");
    // What a press is doing, in the words of the long and short layouts. Their room also holds a
    // two-digit queue, so neither a press nor the queue emptying moves mute beside it (#912).
    const phase = stopPress.phase;
    const answers = [t("voice_ui.topbar_stopping"), t("voice_ui.topbar_stopped")];
    const roomLong = [t("voice_ui.topbar_stop"), t("voice_ui.topbar_stop_count", { count: 99 }), ...answers];
    const roomShort = [t("voice_ui.topbar_stop_short"), t("voice_ui.topbar_stop_short_count", { count: 99 }), ...answers];
    const answer = phase === "stopping" ? answers[0] : phase === "stopped" ? answers[1] : null;
    // Offered while something runs, and while its press is answered.
    const offered = somethingToStop({ status, audition, check }) || phase !== "idle";
    // Only a reported state makes a toggle; without one this is a plain mute action.
    const requested = route.requested_muted;
    const known = typeof requested === "boolean";
    const muted = known && requested;
    const mute = t("voice_ui.mute_row");
    const resumeBlocked = muted && (!route.ready || !!route.pending);
    const stopVoice = () => { if (offered && phase === "idle") press(); };
    const toggleMute = () => { if (!resumeBlocked) send(muted ? "/run/resume_voice" : "/run/mute_voice"); };
    // Hotkeys press these same buttons, with today's state (logics/voice/voiceActions.ts).
    useEffect(() => { voiceActions.stop = stopVoice; voiceActions.toggleMute = toggleMute; });
    const stopScope = offered ? t("voice.stop") : t("voice_ui.topbar_stop_idle");
    const muteScope = t(route.managed ? "voice.mute_scope_managed" : route.covers_direct ? "voice.mute_scope_device" : "voice.mute_scope_external");
    const stopScopeId = useId(), muteScopeId = useId();
    return <div className={classes.stop_actions} role="group" aria-label={t("voice_ui.stop_actions")}>
        {/* Narrow windows show the short words, which stay part of the accessible name. */}
        <Tooltip bare placement="bottom" title={stopScope}>
            <Button tone="danger" size={size} className={classes.stop}
                aria-label={stop} aria-describedby={stopScopeId} aria-disabled={!offered || phase !== "idle" || undefined}
                aria-busy={phase === "stopping" || undefined} onClick={stopVoice}>
                <span className={classes.long} aria-hidden="true"><StableWords current={answer ?? stop} words={roomLong} /></span>
                <span className={classes.short} aria-hidden="true"><StableWords current={answer ?? stopShort} words={roomShort} /></span>
                {classes.tiny && <span className={classes.tiny} aria-hidden="true">{stopTiny}</span>}
                <span id={stopScopeId} hidden>{stopScope}</span>
            </Button>
        </Tooltip>
        <span role="status" className={classes.stop_status}>{phase === "stopped" ? t("voice_ui.topbar_stopped_announce") : ""}</span>
        <Tooltip bare placement="bottom" title={muteScope}>
            {/* The press is the reported state's: the kit's Toggle draws it and does not keep one of its own. */}
            <Toggle tone="warning" size={size} className={classes.stop} pressed={muted} aria-pressed={known ? muted : undefined}
                aria-label={mute} aria-describedby={muteScopeId} disabled={resumeBlocked} onClick={toggleMute}>
                <span className={classes.long} aria-hidden="true">{mute}</span>
                <span className={classes.short} aria-hidden="true">{mute}</span>
                {classes.tiny && <span className={classes.tiny} aria-hidden="true">{muted ? t("voice_ui.topbar_muted") : mute}</span>}
                {muted && <span className={classes.muted_badge} aria-hidden="true">{t("voice_ui.topbar_muted")}</span>}
                <span id={muteScopeId} hidden>{muteScope}</span>
            </Toggle>
        </Tooltip>
    </div>;
};
