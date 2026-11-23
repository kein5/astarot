import { useId } from "react";
import clsx from "clsx";
import { useI18n } from "@useI18n";
import { useVoice } from "../../../../../../logics/voice/useVoice";
import { useVoiceAudition } from "../../../../../../logics/voice/useVoiceAudition";
import { useVirtualMic } from "../../../../../../logics/voice/useVirtualMic";
import { useStopVoice } from "../../../../../../logics/voice/useStopVoice";
import { somethingToStop } from "../../../../../../logics/voice/stopVoice.ts";
import { Tooltip } from "../../../../../common_components/tooltip/Tooltip";
import { StableWords } from "../../../../../common_components/stable_words/StableWords";
import * as styles from "./VoiceSettings.css.ts";

// The TTS page's stop, as the top bar's (#937): offered while the core has something to stop (the
// speech and its queue, an audition, the virtual microphone's check) and while its press is
// answered; otherwise it reads as disabled, keeps its place in the tab order, and its tooltip says
// when it can be pressed. A press says "Stopping…" until the core answers, then "Stopped".
export const StopVoiceButton = () => {
    const { t } = useI18n();
    const { status } = useVoice();
    const { audition } = useVoiceAudition();
    const { check } = useVirtualMic();
    const { stop: stopPress, press } = useStopVoice();
    const phase = stopPress.phase;
    const offered = somethingToStop({ status, audition, check }) || phase !== "idle";
    const words = [t("voice_ui.topbar_stop"), t("voice_ui.topbar_stopping"), t("voice_ui.topbar_stopped")];
    const current = phase === "stopping" ? words[1] : phase === "stopped" ? words[2] : words[0];
    const scope = offered ? t("voice.stop") : t("voice_ui.topbar_stop_idle");
    const scopeId = useId();
    return <Tooltip bare placement="bottom" title={scope}>
        <button type="button" className={clsx(styles.stop, { [styles.is_stopping]: phase === "stopping", [styles.is_stopped]: phase === "stopped", [styles.is_idle]: !offered })}
            aria-label={t("voice_ui.topbar_stop")} aria-describedby={scopeId} aria-disabled={!offered || phase !== "idle" || undefined}
            aria-busy={phase === "stopping" || undefined} onClick={() => { if (offered && phase === "idle") press(); }}>
            <span aria-hidden="true"><StableWords current={current} words={words} /></span>
            <span id={scopeId} hidden>{scope}</span>
        </button>
    </Tooltip>;
};
