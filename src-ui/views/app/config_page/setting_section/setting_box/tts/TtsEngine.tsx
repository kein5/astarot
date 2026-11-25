import { useEffect, useId, useState } from "react";
import type { Dispatch, MouseEvent, SetStateAction } from "react";
import { useI18n } from "@useI18n";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useVoice } from "../../../../../../logics/voice/useVoice";
import { EnvReadout } from "../_components/env_readout/EnvReadout";
import { FormRow } from "../_components/form_row/FormRow";
import { Description } from "../_components/description/Description";
import { SetupSection } from "../_components/setup_section/SetupSection";
import type { VoiceSettings } from "../../../../../../logics/voice/useVoice";
import type { DraftState } from "../../../../../../logics/voice/useSettingsDraft";
import type { Translate } from "../../../../../../logics/voice/voiceErrorText.ts";
import { Button, Select, SelectOptGroup, SelectOption, TextField } from "../../../../../kit/index.ts";

export type TtsEngineId = "voicevox" | "coeiroink" | "aivis" | "sharevox";
// url: the setting that holds the engine's address; example: its own address.
export interface TtsEngineSpec {
    readonly name: string;
    readonly url: string;
    readonly example: string;
    readonly site: string;
    readonly terms?: string;
}
// The TTS draft and its setter, as the page's form holds them.
export type TtsDraftSetter = Dispatch<SetStateAction<DraftState<VoiceSettings>>>;

// The speech engines a user can install and run to read Japanese (ADR-008): the setting that
// holds each one's URL, its own address as the example, and its pages.
export const TTS_ENGINES: Readonly<Record<TtsEngineId, TtsEngineSpec>> = {
    voicevox: { name: "VOICEVOX", url: "voicevox_url", example: "http://127.0.0.1:50021",
        site: "https://voicevox.hiroshiba.jp/", terms: "https://voicevox.hiroshiba.jp/term/" },
    coeiroink: { name: "COEIROINK", url: "coeiroink_url", example: "http://127.0.0.1:50032",
        site: "https://coeiroink.com/", terms: "https://coeiroink.com/terms" },
    aivis: { name: "AivisSpeech", url: "aivis_url", example: "http://127.0.0.1:10101", site: "https://aivis-project.com/" },
    sharevox: { name: "SHAREVOX", url: "sharevox_url", example: "http://127.0.0.1:50025", site: "https://www.sharevox.app/" },
};

const VOICE_FIELDS = ["engine_voice_id", "engine_voice_speaker", "engine_voice_style"];

const isTtsEngine = (engine: string): engine is TtsEngineId => Object.hasOwn(TTS_ENGINES, engine);
// The installed engine an id names, or nothing for speech.cpp.
export const ttsEngineSpec = (engine: string): TtsEngineSpec | undefined => isTtsEngine(engine) ? TTS_ENGINES[engine] : undefined;

// One number field of an engine's reading, with its range and the value it falls back to.
export interface ReadingNumber {
    readonly key: string;
    readonly min: number;
    readonly max: number;
    readonly step: number;
    readonly fallback: string;
}

// How COEIROINK reads (its /v1/synthesis fields). The defaults are what the app always sent;
// the ranges are the ones the core accepts (native/tts/src/settings.rs, COEIROINK_RANGES).
export const COEIROINK_NUMBERS: readonly ReadingNumber[] = [
    { key: "coeiroink_speed", min: 0.5, max: 2, step: 0.05, fallback: "1.0" },
    { key: "coeiroink_volume", min: 0, max: 2, step: 0.05, fallback: "1.0" },
    { key: "coeiroink_pitch", min: -0.15, max: 0.15, step: 0.01, fallback: "0.0" },
    { key: "coeiroink_intonation", min: 0, max: 2, step: 0.05, fallback: "1.0" },
    { key: "coeiroink_pre_phoneme", min: 0, max: 1.5, step: 0.05, fallback: "0.1" },
    { key: "coeiroink_post_phoneme", min: 0, max: 1.5, step: 0.05, fallback: "0.1" },
];
export const COEIROINK_RATES: readonly string[] = ["16000", "24000", "44100", "48000"];
export const COEIROINK_DEFAULTS: Readonly<Record<string, string>> = { ...Object.fromEntries(COEIROINK_NUMBERS.map(item => [item.key, item.fallback])), coeiroink_sampling_rate: "24000" };

// How an engine with the VOICEVOX API reads: the Scale fields of its AudioQuery, one set per
// engine. The defaults are the engines' own, and the core leaves a field at its default as the
// engine wrote it (native/tts/src/settings.rs, AUDIO_QUERY_RANGES; ADR-008 5.2).
export const AUDIO_QUERY_ENGINES: readonly TtsEngineId[] = ["voicevox", "aivis", "sharevox"];
const SCALE_NUMBERS: readonly (Omit<ReadingNumber, "key"> & { readonly name: string })[] = [
    { name: "speed", min: 0.5, max: 2, step: 0.05, fallback: "1.0" },
    { name: "volume", min: 0, max: 2, step: 0.05, fallback: "1.0" },
    { name: "pitch", min: -0.15, max: 0.15, step: 0.01, fallback: "0.0" },
    { name: "intonation", min: 0, max: 2, step: 0.05, fallback: "1.0" },
];
export const audioQueryNumbers = (engine: TtsEngineId) => SCALE_NUMBERS.map(item => ({ ...item, key: `${engine}_${item.name}` }));
const AUDIO_QUERY_NUMBERS = AUDIO_QUERY_ENGINES.flatMap(audioQueryNumbers);

const validNumber = ({ key, min, max }: ReadingNumber, draft: VoiceSettings) => {
    const text = draft[key] ?? "";
    const value = Number(text);
    return text.length <= 16 && /^-?[0-9]+(\.[0-9]+)?$/.test(text) && value >= min && value <= max;
};
// Missing fields are the defaults: settings saved before these fields keep working.
export const validCoeiroinkOptions = (draft: VoiceSettings) => COEIROINK_NUMBERS.every(item => draft[item.key] === undefined || validNumber(item, draft)) &&
    (draft.coeiroink_sampling_rate === undefined || COEIROINK_RATES.includes(draft.coeiroink_sampling_rate));
export const validAudioQueryOptions = (draft: VoiceSettings) => AUDIO_QUERY_NUMBERS.every(item => draft[item.key] === undefined || validNumber(item, draft));

// One number field per value, marked while it is out of its range. Called in place, not as a
// component, so the fields are part of the section that holds them.
interface NumberFieldsOptions<F extends ReadingNumber> {
    t: Translate;
    numbers: readonly F[];
    label: (item: F) => string;
    value: (key: string) => string;
    set: (key: string, text: string) => void;
    errorId: string;
}

const numberFields = <F extends ReadingNumber>({ t, numbers, label, value, set, errorId }: NumberFieldsOptions<F>) =>
    numbers.map(item => {
        const invalid = !validNumber(item, { [item.key]: value(item.key) });
        return <label key={item.key}>{label(item)}
            <TextField type="number" min={item.min} max={item.max} step={item.step} value={value(item.key)}
                placeholder={t("voice_ui.example", { value: item.fallback })}
                invalid={invalid} aria-describedby={invalid ? errorId : undefined}
                onChange={event => set(item.key, event.target.value)} />
        </label>;
    });

// The reading of VOICEVOX, AivisSpeech or SHAREVOX, each with its own values.
export interface AudioQueryOptionsProps {
    engine: TtsEngineId;
    draft: VoiceSettings;
    setDraft: TtsDraftSetter;
    // Saves at once (#1111): the reset is a choice, not typing.
    resetDraft?: TtsDraftSetter;
}

export const AudioQueryOptions = ({ engine, draft, setDraft, resetDraft = setDraft }: AudioQueryOptionsProps) => {
    const { t } = useI18n();
    const errorId = useId();
    const numbers = audioQueryNumbers(engine);
    const defaults: Readonly<Record<string, string>> = Object.fromEntries(numbers.map(item => [item.key, item.fallback]));
    const value = (key: string) => draft[key] ?? defaults[key];
    const set = (key: string, text: string) => setDraft(current => ({ ...current, [key]: text }));
    const changed = numbers.some(item => value(item.key) !== item.fallback);
    const name = TTS_ENGINES[engine].name;
    return <SetupSection title={t("voice_ui.engine.audio_query.title", { engine: name })}
        desc={t("voice_ui.engine.audio_query.description", { engine: name })}
        status={t("voice_ui.engine.audio_query.status", { speed: value(`${engine}_speed`) })}>
        {numberFields({ t, numbers, label: item => t(`voice_ui.engine.audio_query.${item.name}`), value, set, errorId })}
        {!validAudioQueryOptions({ ...defaults, ...draft }) && <p id={errorId} role="alert">{t("voice_ui.engine.audio_query.invalid")}</p>}
        {/* Back to the engine's own values, saved at once. */}
        <Button disabled={!changed} onClick={() => resetDraft(current => ({ ...current, ...defaults }))}>
            {t("voice_ui.engine.audio_query.reset")}</Button>
    </SetupSection>;
};

export const CoeiroinkOptions = ({ draft, setDraft, resetDraft = setDraft }: { draft: VoiceSettings; setDraft: TtsDraftSetter; resetDraft?: TtsDraftSetter }) => {
    const { t } = useI18n();
    const errorId = useId();
    const value = (key: string) => draft[key] ?? COEIROINK_DEFAULTS[key];
    const set = (key: string, text: string) => setDraft(current => ({ ...current, [key]: text }));
    const changed = Object.keys(COEIROINK_DEFAULTS).some(key => value(key) !== COEIROINK_DEFAULTS[key]);
    return <SetupSection title={t("voice_ui.engine.coeiroink.title")} desc={t("voice_ui.engine.coeiroink.description")}
        status={t("voice_ui.engine.coeiroink.status", { speed: value("coeiroink_speed"), rate: value("coeiroink_sampling_rate") })}>
        {numberFields({ t, numbers: COEIROINK_NUMBERS, label: item => t(`voice_ui.engine.coeiroink.${item.key}`), value, set, errorId })}
        <label>{t("voice_ui.engine.coeiroink.coeiroink_sampling_rate")}
            <Select aria-label={t("voice_ui.engine.coeiroink.coeiroink_sampling_rate")} value={value("coeiroink_sampling_rate")}
                onChange={event => set("coeiroink_sampling_rate", event.target.value)}>
                {COEIROINK_RATES.map(rate => <SelectOption key={rate} value={rate}>{t("voice_ui.engine.coeiroink.rate_option", { rate })}</SelectOption>)}
            </Select>
        </label>
        {!validCoeiroinkOptions({ ...COEIROINK_DEFAULTS, ...draft }) && <p id={errorId} role="alert">{t("voice_ui.engine.coeiroink.invalid")}</p>}
        {/* Back to the values the app used before they could be set, saved at once. */}
        <Button disabled={!changed} onClick={() => resetDraft(current => ({ ...current, ...COEIROINK_DEFAULTS }))}>
            {t("voice_ui.engine.coeiroink.reset")}</Button>
    </SetupSection>;
};

// Which engine reads Japanese, and for an installed engine its URL, whether it answers and which
// of its voices to use. The app never installs or starts an engine; checking only asks it for
// its version and voices. It saves with the rest of the page's form, by itself (#1111).
export interface TtsEngineProps {
    draft: VoiceSettings;
    setDraft: TtsDraftSetter;
    // What a reset button changes the draft with: saved at once (#1111). setDraft otherwise.
    resetDraft?: TtsDraftSetter;
    saved: VoiceSettings | null;
}

export const TtsEngine = ({ draft, setDraft, resetDraft, saved }: TtsEngineProps) => {
    const { t } = useI18n();
    const { engineVoices, send } = useVoice();
    const [linkError, setLinkError] = useState<string | null>(null);
    const engine = draft.japanese_engine || "speechcpp";
    const spec = ttsEngineSpec(engine), terms = spec?.terms;
    const url = spec ? draft[spec.url] ?? "" : "";
    const check = () => send("/get/data/tts_engine_voices", { engine, url });
    // Check when an engine is chosen or the page opens with one; a typed URL is checked with the button.
    // biome-ignore lint/correctness/useExhaustiveDependencies: only the engine starts a check (see above), not the typed URL.
    useEffect(() => { if (spec) check(); }, [engine]);

    const choose = (value: string) => setDraft(current => {
        // A voice belongs to its engine. Coming back to the saved engine brings its saved voice back.
        const voice = value === (saved?.japanese_engine || "speechcpp") ?
            Object.fromEntries(VOICE_FIELDS.map(key => [key, saved?.[key] ?? ""])) : Object.fromEntries(VOICE_FIELDS.map(key => [key, ""]));
        return { ...current, japanese_engine: value, ...voice };
    });
    const open = async (event: MouseEvent<HTMLAnchorElement>, link: string) => {
        if (!isTauri()) return;
        event.preventDefault();
        try { await openUrl(link); setLinkError(null); }
        catch { setLinkError(link); }
    };

    const result = spec && engineVoices?.engine === engine ? engineVoices : null;
    const voices = result?.connected ? result.voices ?? [] : [];
    const speakers = [...new Set(voices.map(voice => voice.speaker))];
    const voiceKnown = voices.some(voice => voice.id === draft.engine_voice_id);
    // The engine as one that reads with the VOICEVOX API, if it is one.
    const audioQuery = AUDIO_QUERY_ENGINES.find(item => item === engine);
    const state = !result || result.pending ? "checking" : result.connected ? "connected" :
        result.error_code === "tts_engine_url_invalid" ? "url_invalid" : "not_connected";

    return <>
        {/* The description follows the chosen engine: AI voice needs a speech server, the others are installed by the user. */}
        <FormRow label={t("voice_ui.engine.label")} description={t(spec ? "voice_ui.engine.description" : "voice_ui.engine.description_speechcpp")}>
            <Select aria-label={t("voice_ui.engine.label")} value={engine} onChange={event => choose(event.target.value)}>
                <SelectOption value="speechcpp">{t("voice_ui.engine.speechcpp")}</SelectOption>
                {Object.entries(TTS_ENGINES).map(([id, item]) => <SelectOption key={id} value={id}>{item.name}</SelectOption>)}
            </Select>
        </FormRow>
        {spec && <>
            <p>
                <a href={spec.site} target="_blank" rel="noreferrer" onClick={event => open(event, spec.site)}>{t("voice_ui.engine.site", { engine: spec.name })}</a>
                {terms && <>{" · "}<a href={terms} target="_blank" rel="noreferrer" onClick={event => open(event, terms)}>{t("voice_ui.engine.terms")}</a></>}
            </p>
            {linkError && <p role="alert">{t("model_downloads.link_error")} <code>{linkError}</code></p>}
            <FormRow label={t("voice_ui.engine.url")} description={t("voice_ui.engine.url_hint")}
                actions={<Button disabled={state === "checking" && !!result?.pending} onClick={check}>{t("voice_ui.engine.recheck")}</Button>}>
                <TextField mono aria-label={t("voice_ui.engine.url")} value={url} maxLength={512} spellCheck={false}
                    placeholder={t("voice_ui.example", { value: spec.example })}
                    onChange={event => setDraft(current => ({ ...current, [spec.url]: event.target.value }))} />
            </FormRow>
            <EnvReadout tone={state === "connected" ? "active" : state === "url_invalid" ? "failed" : state === "not_connected" ? "warning" : "neutral"}
                progress={state === "checking" ? "working" : state === "connected" ? "done" : undefined}>
                <p>{state === "checking" ? t("voice_ui.engine.checking") :
                    state === "connected" ? t("voice_ui.engine.connected", { engine: spec.name, version: result?.version ?? "" }) :
                        state === "url_invalid" ? t("voice_ui.errors.tts_engine_url_invalid") : t("voice_ui.engine.not_connected")}</p>
            </EnvReadout>
            <label>{t("voice_ui.engine.voice")}
                <Select aria-label={t("voice_ui.engine.voice")} value={draft.engine_voice_id || ""}
                    onChange={event => {
                        const voice = voices.find(item => item.id === event.target.value);
                        setDraft(current => ({ ...current, engine_voice_id: voice?.id ?? "",
                            engine_voice_speaker: voice?.speaker ?? "", engine_voice_style: voice?.style ?? "" }));
                    }}>
                    <SelectOption value="">{t("voice_ui.engine.voice_unset")}</SelectOption>
                    {/* The saved voice stays visible while the engine is off or has changed its list. */}
                    {draft.engine_voice_id && !voiceKnown && <SelectOption value={draft.engine_voice_id}>
                        {t("voice_ui.engine.voice_saved", { speaker: draft.engine_voice_speaker, style: draft.engine_voice_style })}</SelectOption>}
                    {speakers.map(speaker => <SelectOptGroup key={speaker} label={speaker}>
                        {voices.filter(voice => voice.speaker === speaker).map(voice => <SelectOption key={voice.id} value={voice.id}>{voice.style}</SelectOption>)}
                    </SelectOptGroup>)}
                </Select>
            </label>
            {state === "connected" && !voices.length && <p>{t("voice_ui.engine.no_voices")}</p>}
            {engine === "coeiroink" && <CoeiroinkOptions draft={draft} setDraft={setDraft} resetDraft={resetDraft} />}
            {audioQuery && <AudioQueryOptions key={audioQuery} engine={audioQuery} draft={draft} setDraft={setDraft} resetDraft={resetDraft} />}
            {/* The voices' credit and terms: what their licenses ask, kept in sight (#614). */}
            <Description text={t(`voice_ui.engine.credit.${engine}`)} />
        </>}
    </>;
};
