import { useI18n } from "@useI18n";
import { useVoice } from "../../../../../../logics/voice/useVoice";
import { useSpeechServers } from "../../../../../../logics/voice/useSpeechServers";
import { useVoiceAudition } from "../../../../../../logics/voice/useVoiceAudition";
import { auditionBlock, isAuditionProfile } from "../../../../../../logics/voice/voiceAudition";
import styles from "./VoiceSettings.module.scss";

// The voice audition of one TTS card (#415): the model its profile's running server uses reads a
// short fixed sentence on the monitor output only. `status` is the card's download status.
const useAuditionCard = (target, status) => {
    const { settings, route, status: voiceStatus } = useVoice();
    const { state } = useSpeechServers();
    const { audition, start, stop } = useVoiceAudition();
    if (!isAuditionProfile(target)) return null;
    const muted = route?.requested_muted === true || voiceStatus?.muted === true;
    const block = auditionBlock({ status, server: state?.[target]?.state, monitor: settings?.monitor, muted });
    const own = audition.profile === target;
    return { block, audition, start, stop, own,
        playing: own && audition.phase === "playing", pending: own && audition.phase === "pending" };
};

// In the card's row of actions, after the card's own action. While it plays it is the stop; while
// the press waits for the engine it says so and ignores more presses, keeping its focus.
export const AuditionButton = ({ target, status }) => {
    const { t } = useI18n();
    const card = useAuditionCard(target, status);
    if (!card || (card.block && !card.playing && !card.pending)) return null;
    const { playing, pending } = card;
    return <button type="button" className={playing ? styles.quiet : undefined} data-voice-audition={target}
        aria-disabled={pending || undefined} aria-busy={pending || undefined} title={t("voice_audition.tooltip")}
        onClick={() => {
            if (pending) return;
            if (playing) card.stop(); else card.start(target);
        }}>{t(pending ? "voice_audition.pending" : playing ? "voice_audition.stop" : "voice_audition.play")}</button>;
};

// Under the row: why this card cannot play the audition now, or why the last press failed. A
// model not downloaded says nothing more: its own action is the download.
export const AuditionNote = ({ target, status }) => {
    const { t } = useI18n();
    const card = useAuditionCard(target, status);
    if (!card) return null;
    const { block, audition, own, playing, pending } = card;
    if (own && audition.error && block !== "not_in_use" && block !== "not_downloaded")
        return <p role="alert">{t([`voice_audition.errors.${audition.error}`, "voice_audition.errors.voice_audition_failed"])}</p>;
    if (!block || block === "not_downloaded" || playing || pending) return null;
    return <p data-voice-audition-note={block}>{t(`voice_audition.blocked.${block}`)}</p>;
};
