import { useEffect, useState } from "react";
import { useI18n } from "@useI18n";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useVoice } from "../../../../../../logics/voice/useVoice";
import { EnvReadout } from "../_components/env_readout/EnvReadout";
import { FormRow } from "../_components/form_row/FormRow";
import { Description } from "../_components/description/Description";

// The speech engines a user can install and run to read Japanese (ADR-008): the setting that
// holds each one's URL, its own address as the example, and its pages.
export const TTS_ENGINES = {
    voicevox: { name: "VOICEVOX", url: "voicevox_url", example: "http://127.0.0.1:50021",
        site: "https://voicevox.hiroshiba.jp/", terms: "https://voicevox.hiroshiba.jp/term/" },
    coeiroink: { name: "COEIROINK", url: "coeiroink_url", example: "http://127.0.0.1:50032",
        site: "https://coeiroink.com/", terms: "https://coeiroink.com/terms" },
    aivis: { name: "AivisSpeech", url: "aivis_url", example: "http://127.0.0.1:10101", site: "https://aivis-project.com/" },
    sharevox: { name: "SHAREVOX", url: "sharevox_url", example: "http://127.0.0.1:50025", site: "https://www.sharevox.app/" },
};

const VOICE_FIELDS = ["engine_voice_id", "engine_voice_speaker", "engine_voice_style"];

// Which engine reads Japanese, and for an installed engine its URL, whether it answers and which
// of its voices to use. The app never installs or starts an engine; checking only asks it for
// its version and voices. Everything is saved from the save bar, like the rest of the page.
export const TtsEngine = ({ draft, setDraft, saved }) => {
    const { t } = useI18n();
    const { engineVoices, send } = useVoice();
    const [linkError, setLinkError] = useState(null);
    const engine = draft.japanese_engine || "speechcpp";
    const spec = TTS_ENGINES[engine];
    const url = spec ? draft[spec.url] ?? "" : "";
    const check = () => send("/get/data/tts_engine_voices", { engine, url });
    // Check when an engine is chosen or the page opens with one; a typed URL is checked with the button.
    useEffect(() => { if (spec) check(); }, [engine]); // eslint-disable-line react-hooks/exhaustive-deps

    const choose = value => setDraft(current => {
        // A voice belongs to its engine. Coming back to the saved engine brings its saved voice back.
        const voice = value === (saved?.japanese_engine || "speechcpp") ?
            Object.fromEntries(VOICE_FIELDS.map(key => [key, saved?.[key] ?? ""])) : Object.fromEntries(VOICE_FIELDS.map(key => [key, ""]));
        return { ...current, japanese_engine: value, ...voice };
    });
    const open = async (event, link) => {
        if (!isTauri()) return;
        event.preventDefault();
        try { await openUrl(link); setLinkError(null); }
        catch { setLinkError(link); }
    };

    const result = spec && engineVoices?.engine === engine ? engineVoices : null;
    const voices = result?.connected ? result.voices : [];
    const speakers = [...new Set(voices.map(voice => voice.speaker))];
    const voiceKnown = voices.some(voice => voice.id === draft.engine_voice_id);
    const state = !result || result.pending ? "checking" : result.connected ? "connected" :
        result.error_code === "tts_engine_url_invalid" ? "url_invalid" : "not_connected";

    return <>
        <FormRow label={t("voice_ui.engine.label")} description={t("voice_ui.engine.description")}>
            <select aria-label={t("voice_ui.engine.label")} value={engine} onChange={event => choose(event.target.value)}>
                <option value="speechcpp">{t("voice_ui.engine.speechcpp")}</option>
                {Object.entries(TTS_ENGINES).map(([id, item]) => <option key={id} value={id}>{item.name}</option>)}
            </select>
        </FormRow>
        {spec && <>
            <p>
                <a href={spec.site} target="_blank" rel="noreferrer" onClick={event => open(event, spec.site)}>{t("voice_ui.engine.site", { engine: spec.name })}</a>
                {spec.terms && <>{" · "}<a href={spec.terms} target="_blank" rel="noreferrer" onClick={event => open(event, spec.terms)}>{t("voice_ui.engine.terms")}</a></>}
            </p>
            {linkError && <p role="alert">{t("model_downloads.link_error")} <code>{linkError}</code></p>}
            <FormRow label={t("voice_ui.engine.url")} description={t("voice_ui.engine.url_hint")}
                actions={<button type="button" disabled={state === "checking" && !!result?.pending} onClick={check}>{t("voice_ui.engine.recheck")}</button>}>
                <input aria-label={t("voice_ui.engine.url")} value={url} maxLength={512} spellCheck={false}
                    placeholder={t("voice_ui.example", { value: spec.example })}
                    onChange={event => setDraft(current => ({ ...current, [spec.url]: event.target.value }))} />
            </FormRow>
            <EnvReadout tone={state === "connected" ? "active" : state === "url_invalid" ? "failed" : state === "not_connected" ? "warning" : "neutral"}
                progress={state === "checking" ? "working" : state === "connected" ? "done" : undefined}>
                <p>{state === "checking" ? t("voice_ui.engine.checking") :
                    state === "connected" ? t("voice_ui.engine.connected", { engine: spec.name, version: result.version ?? "" }) :
                        state === "url_invalid" ? t("voice_ui.errors.tts_engine_url_invalid") : t("voice_ui.engine.not_connected")}</p>
            </EnvReadout>
            <label>{t("voice_ui.engine.voice")}
                <select aria-label={t("voice_ui.engine.voice")} value={draft.engine_voice_id || ""}
                    onChange={event => {
                        const voice = voices.find(item => item.id === event.target.value);
                        setDraft(current => ({ ...current, engine_voice_id: voice?.id ?? "",
                            engine_voice_speaker: voice?.speaker ?? "", engine_voice_style: voice?.style ?? "" }));
                    }}>
                    <option value="">{t("voice_ui.engine.voice_unset")}</option>
                    {/* The saved voice stays visible while the engine is off or has changed its list. */}
                    {draft.engine_voice_id && !voiceKnown && <option value={draft.engine_voice_id}>
                        {t("voice_ui.engine.voice_saved", { speaker: draft.engine_voice_speaker, style: draft.engine_voice_style })}</option>}
                    {speakers.map(speaker => <optgroup key={speaker} label={speaker}>
                        {voices.filter(voice => voice.speaker === speaker).map(voice => <option key={voice.id} value={voice.id}>{voice.style}</option>)}
                    </optgroup>)}
                </select>
            </label>
            {state === "connected" && !voices.length && <p>{t("voice_ui.engine.no_voices")}</p>}
            <Description text={t(`voice_ui.engine.credit.${engine}`)} />
        </>}
    </>;
};
