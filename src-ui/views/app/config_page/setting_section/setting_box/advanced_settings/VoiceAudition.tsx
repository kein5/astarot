import { useI18n } from "@useI18n";
import { useVoice } from "../../../../../../logics/voice/useVoice";
import { useSpeechServers } from "../../../../../../logics/voice/useSpeechServers";
import { useVoiceAudition } from "../../../../../../logics/voice/useVoiceAudition";
import { auditionBlock, isAuditionProfile, rvcAuditionBlock } from "../../../../../../logics/voice/voiceAudition";
import type { RvcAuditionValues } from "../../../../../../logics/voice/voiceAudition";
import styles from "./VoiceSettings.module.scss";

// The voice audition of one catalog card (#415), on the monitor output only. A TTS card: the model
// its profile's running server uses reads a short fixed sentence. An RVC card: that sentence,
// read by a running TTS server, converted by the card's model with the form's values. `status` is
// the card's download status; `entry` the RVC card's model id.
const useAuditionCard = (target: string, status: string, entry?: string, values?: RvcAuditionValues | null) => {
    const { settings, route, status: voiceStatus, directState } = useVoice();
    const { state } = useSpeechServers();
    const { audition, start, startRvc, stop } = useVoiceAudition();
    const muted = route?.requested_muted === true || voiceStatus?.muted === true;
    if (target === "rvc" && entry) {
        const converting = directState?.mode === "converted" && !!(directState.requested || directState.pending || directState.stopping);
        const ttsReady = state?.japanese?.state === "ready" || state?.multilingual?.state === "ready";
        const block = rvcAuditionBlock({ status, values: values ?? null, converting, ttsReady, monitor: settings?.monitor, muted });
        const own = audition.kind === "rvc" && audition.entry === entry;
        return { kind: "rvc" as const, block, audition, own, stop,
            play: () => values && startRvc(entry, values),
            playing: own && audition.phase === "playing", pending: own && audition.phase === "pending",
            preparing: own && audition.phase === "playing" && audition.stage === "preparing" };
    }
    if (!isAuditionProfile(target)) return null;
    const block = auditionBlock({ status, server: state?.[target]?.state, monitor: settings?.monitor, muted });
    const own = audition.kind !== "rvc" && audition.profile === target;
    return { kind: "tts" as const, block, audition, own, stop, play: () => start(target),
        playing: own && audition.phase === "playing", pending: own && audition.phase === "pending", preparing: false };
};

// In the card's row of actions, after the card's own action. While it plays it is the stop; while
// the press waits for the engine it says so and ignores more presses, keeping its focus.
// `target` is the card's catalog target; the TTS targets and RVC have an audition.
export interface AuditionProps {
    target: string;
    status: string;
    // An RVC card's model id, and the form's pitch and index rate (null while they are not valid).
    entry?: string;
    values?: RvcAuditionValues | null;
}

export const AuditionButton = ({ target, status, entry, values }: AuditionProps) => {
    const { t } = useI18n();
    const card = useAuditionCard(target, status, entry, values);
    if (!card || (card.block && !card.playing && !card.pending)) return null;
    const { playing, pending, kind } = card;
    return <button type="button" className={playing ? styles.quiet : undefined} data-voice-audition={kind === "rvc" ? entry : target}
        aria-disabled={pending || undefined} aria-busy={pending || undefined} title={t(kind === "rvc" ? "voice_audition.rvc_tooltip" : "voice_audition.tooltip")}
        onClick={() => {
            if (pending) return;
            if (playing) card.stop(); else card.play();
        }}>{t(pending ? "voice_audition.pending" : playing ? "voice_audition.stop" : "voice_audition.play")}</button>;
};

// Under the row: what the audition does now, why this card cannot play one, or else why the last
// press failed. What stands in the way now comes first; an older failure would be stale. A model
// not downloaded says nothing more: its own action is the download.
export const AuditionNote = ({ target, status, entry, values }: AuditionProps) => {
    const { t } = useI18n();
    const card = useAuditionCard(target, status, entry, values);
    if (!card || card.pending) return null;
    // The RVC worker loads before the sample plays: say so, as the stop is already offered.
    if (card.preparing) return <p role="status" data-voice-audition-note="preparing">{t("voice_audition.rvc_preparing")}</p>;
    if (card.playing) return null;
    const { block, audition, own, kind } = card;
    if (block) return block === "not_downloaded" ? null
        : <p data-voice-audition-note={block}>{t(kind === "rvc" ? [`voice_audition.rvc_blocked.${block}`, `voice_audition.blocked.${block}`] : `voice_audition.blocked.${block}`)}</p>;
    if (!own || !audition.error) return null;
    const keys = [`voice_audition.errors.${audition.error}`, "voice_audition.errors.voice_audition_failed"];
    // An RVC audition's own wording first, then the conversion's (its worker's codes).
    return <p role="alert">{t(kind === "rvc" ? [`voice_audition.rvc_errors.${audition.error}`, `voice_audition.errors.${audition.error}`,
        `voice.input_errors.${audition.error}`, "voice_audition.rvc_errors.voice_audition_failed"] : keys)}</p>;
};
