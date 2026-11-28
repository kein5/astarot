import { useId } from "react";
import { useI18n } from "@useI18n";
import { Tooltip } from "../../../../../common_components/tooltip/Tooltip";
import { useVoice } from "../../../../../../logics/voice/useVoice";
import { useSpeechServers } from "../../../../../../logics/voice/useSpeechServers";
import { useVoiceAudition } from "../../../../../../logics/voice/useVoiceAudition";
import { RVC_AUDITION_SECONDS, auditionBlock, isAuditionProfile, rvcAuditionBlock } from "../../../../../../logics/voice/voiceAudition";
import type { RvcAuditionValues } from "../../../../../../logics/voice/voiceAudition";
import * as styles from "./VoiceSettings.css.ts";

// The voice audition of one catalog card (#415), on the monitor output only. A TTS card: the model
// its profile's running server uses reads a short fixed sentence. An RVC card: the user's voice,
// recorded on the press from the input chosen on the RVC page, converted by the card's model with
// the form's values. `status` is the card's download status; `entry` the RVC card's model id.
const useAuditionCard = (target: string, status: string, entry?: string, values?: RvcAuditionValues | null, input?: unknown) => {
    const { settings, route, status: voiceStatus, directState } = useVoice();
    const { state } = useSpeechServers();
    const { audition, start, startRvc, stop } = useVoiceAudition();
    const muted = route?.requested_muted === true || voiceStatus?.muted === true;
    if (target === "rvc" && entry) {
        const converting = directState?.mode === "converted" && !!(directState.requested || directState.pending || directState.stopping);
        const block = rvcAuditionBlock({ status, values: values ?? null, converting, input, monitor: settings?.monitor, muted });
        const own = audition.kind === "rvc" && audition.entry === entry;
        const playing = own && audition.phase === "playing";
        return { kind: "rvc" as const, block, audition, own, stop,
            play: () => values && input && startRvc(entry, values, input),
            playing, pending: own && audition.phase === "pending",
            recording: playing && audition.stage === "recording", preparing: playing && audition.stage === "preparing" };
    }
    if (!isAuditionProfile(target)) return null;
    const block = auditionBlock({ status, server: state?.[target]?.state, monitor: settings?.monitor, muted });
    const own = audition.kind !== "rvc" && audition.profile === target;
    return { kind: "tts" as const, block, audition, own, stop, play: () => start(target),
        playing: own && audition.phase === "playing", pending: own && audition.phase === "pending", recording: false, preparing: false };
};

// In the card's row of actions, after the card's own action. While it plays it is the stop; while
// the press waits for the engine it says so and ignores more presses, keeping its focus. What the
// sample does is the app's tooltip, on the pointer and on keyboard focus, and the button's
// description, kept in the page while the tooltip is closed.
// `target` is the card's catalog target; the TTS targets and RVC have an audition.
export interface AuditionProps {
    target: string;
    status: string;
    // An RVC card's model id, the form's pitch and index rate (null while they are not valid), and
    // the input chosen on the RVC page that the voice is recorded from (null while none is chosen).
    entry?: string;
    values?: RvcAuditionValues | null;
    input?: unknown;
}

export const AuditionButton = ({ target, status, entry, values, input }: AuditionProps) => {
    const { t } = useI18n();
    const card = useAuditionCard(target, status, entry, values, input);
    const aboutId = useId();
    if (!card || (card.block && !card.playing && !card.pending)) return null;
    const { playing, pending, kind } = card;
    const about = kind === "rvc" ? t("voice_audition.rvc_tooltip", { seconds: RVC_AUDITION_SECONDS }) : t("voice_audition.tooltip");
    return <Tooltip bare title={about}>
        <button type="button" className={playing ? styles.quiet : undefined} data-voice-audition={kind === "rvc" ? entry : target}
            aria-disabled={pending || undefined} aria-busy={pending || undefined} aria-describedby={aboutId}
            onClick={() => {
                if (pending) return;
                if (playing) card.stop(); else card.play();
            }}>
            {t(pending ? "voice_audition.pending" : playing ? "voice_audition.stop" : "voice_audition.play")}
            <span id={aboutId} hidden>{about}</span>
        </button>
    </Tooltip>;
};

// Under the row: what the audition does now, why this card cannot play one, or else why the last
// press failed. What stands in the way now comes first; an older failure would be stale. A model
// not downloaded says nothing more: its own action is the download.
export const AuditionNote = ({ target, status, entry, values, input }: AuditionProps) => {
    const { t } = useI18n();
    const card = useAuditionCard(target, status, entry, values, input);
    if (!card || card.pending) return null;
    // The microphone records, then the RVC worker loads before the voice plays: say so, as the
    // stop is already offered.
    if (card.recording) return <p role="status" data-voice-audition-note="recording">{t("voice_audition.rvc_recording", { seconds: RVC_AUDITION_SECONDS })}</p>;
    if (card.preparing) return <p role="status" data-voice-audition-note="preparing">{t("voice_audition.rvc_preparing")}</p>;
    if (card.playing) return null;
    const { block, audition, own, kind } = card;
    if (block) return block === "not_downloaded" ? null
        : <p data-voice-audition-note={block}>{t(kind === "rvc" ? [`voice_audition.rvc_blocked.${block}`, `voice_audition.blocked.${block}`] : `voice_audition.blocked.${block}`)}</p>;
    if (!own || !audition.error) return null;
    const keys = [`voice_audition.errors.${audition.error}`, "voice_audition.errors.voice_audition_failed"];
    // An RVC audition's own wording first, then the conversion's and the microphone's (their codes).
    return <p role="alert">{t(kind === "rvc" ? [`voice_audition.rvc_errors.${audition.error}`, `voice_audition.errors.${audition.error}`,
        `voice.input_errors.${audition.error}`, "voice_audition.rvc_errors.voice_audition_failed"] : keys)}</p>;
};
