import { createLanguageNames } from "../../../../../../logics/common/languageNames.ts";
import { useEffect, useState } from "react";
import { useI18n } from "@useI18n";
import { useRealtimeASR } from "../../../../../../logics/transcription/useRealtimeASR";
import { languageSettingId } from "../../../../../../logics/transcription/recognitionFix";
import { useSpeechServers } from "../../../../../../logics/voice/useSpeechServers";
import { useModelDownloads } from "../../../../../../logics/voice/useModelDownloads";
import { listeningChoice, listeningLanguages } from "../../../../../../logics/transcription/listeningModel";
import { useSettingsDraft } from "../../../../../../logics/voice/useSettingsDraft";
import * as styles from "../advanced_settings/VoiceSettings.css.ts";
import { EnvReadout } from "../_components/env_readout/EnvReadout";
import { Description } from "../_components/description/Description";
import { FormRow } from "../_components/form_row/FormRow";
import { SectionLabelComponent } from "../_components/section_label_component/SectionLabelComponent";
import { Hint, useHintDescriptions } from "../_components/hint/Hint";
import { VocabularyFiles } from "./VocabularyFiles.tsx";
import { VocabularyList } from "./VocabularyList.tsx";
import type { TFunction } from "i18next";
import type { CaptionSource } from "../../../../../../logics/transcription/realtimeCaptionState";
import type { RealtimeAsrEndpointId, RealtimeAsrSettings, RealtimeAsrSourceSettings, RealtimeAsrVocabulary }
    from "../../../../../../logics/transcription/useRealtimeASR";
import type { DraftWriteValue } from "../../../../../../logics/voice/useSettingsDraft";
import { saveSaidInline } from "../../../../../../logics/configs/fieldErrors.ts";
import { FieldProblem } from "../_components/field_problem/FieldProblem";

const key = (endpoint: RealtimeAsrEndpointId | null | undefined) => endpoint ? JSON.stringify([endpoint.cookie, endpoint.serial, endpoint.name, endpoint.media_class]) : "";
// Select value for "follow the system default"; never a JSON endpoint key.
const FOLLOW = "follow-default";
// The silences that may end an utterance (ms); none chosen follows the core's default of 400 ms
// (#556). 500 ms, the default before, stays a choice; a saved value off this list is shown too.
const SILENCES = [300, 500, 700, 1000];
// The speech detection's thresholds (#392); none chosen sends none, so the server's own applies.
// Lower picks up quieter speech; higher lets less noise through. A saved value off this list is
// shown too.
const THRESHOLDS = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7];
const SOURCES: readonly CaptionSource[] = ["mic", "speaker"];

// The message says what to do (shared with the main switches); the code stays for reports.
// Said in the screen's words, never as the raw code (#1266); a code without words says itself.
const Failure = ({ code, t }: { code: string; t: TFunction }) => <p role="alert">{t(`realtime_toggle.${code}`, { defaultValue: "" }) || code}</p>;

export const RealtimeASRSettings = () => {
    const { t, i18n } = useI18n();
    const hints = useHintDescriptions();
    const names = createLanguageNames(i18n.language);
    const languageLabel = (code: string) => code === "auto" ? t("realtime.auto_language") : names.fromCode(code);
    const { settings, state, endpoints, models, error, builtinVocabulary, send, updateError } = useRealtimeASR();
    const { settings: speech, state: servers, send: sendSpeech } = useSpeechServers();
    // Listening's own model on the bundled server (#1242), chosen in the page's speech.cpp part
    // (SourceModels, #1308 ★1): its languages are read from the catalog here.
    const { catalog, state: downloads, send: sendDownload } = useModelDownloads();
    const bundled = settings?.server === "bundled";
    const asr = speech?.profiles?.asr;
    const listening = listeningChoice(catalog, downloads.downloaded, asr);
    useEffect(() => {
        if (!bundled) return;
        if (!catalog) sendDownload("/get/data/model_download_catalog");
        sendDownload("/get/data/model_download_state");
    }, [bundled]);
    // Saves by itself (#1111, decided 3): a choice at once, the address when focus leaves the
    // form or on Enter, and an edit made while a save waits once it ends. A refusal is said under
    // the form.
    const [problem, setProblem] = useState<string[] | null>(null);
    const write = (value: DraftWriteValue<RealtimeAsrSettings>) => saveSaidInline("/set/data/realtime_asr_settings",
        () => send("/set/data/realtime_asr_settings", value), setProblem);
    const form = useSettingsDraft(settings, error, updateError, { write });
    const { draft, change: setDraft, dirty, saving } = form;
    const refreshDevices = () => {
        for (const source of ["mic", "speaker"]) send("/get/data/realtime_asr_endpoints", { source });
    };
    useEffect(() => {
        send("/get/data/realtime_asr_settings");
        send("/get/data/realtime_asr_state");
        // The built-in terms the dictionary lists to be changed or taken out (#792).
        send("/get/data/builtin_vocabulary");
        sendSpeech("/get/data/speech_server_state");
        refreshDevices();
    }, [send, sendSpeech]);
    useEffect(() => {
        if (settings?.base_url) send("/get/data/realtime_asr_models");
    }, [settings?.base_url, settings?.server, servers.asr?.generation, servers.asr?.base_url, send]);
    const modelsCurrent = models.server === settings?.server && models.configured_url === settings?.base_url &&
        (settings?.server === "bundled" ? servers.asr?.state === "ready" && models.base_url === servers.asr.base_url &&
            models.server_generation === servers.asr.generation : models.base_url === settings?.base_url);
    const knownModels = modelsCurrent ? models.models ?? [] : [];
    const selectedModel = knownModels.find(row => row.id === draft?.model);
    // The form is drawn only with a draft, so these never change a missing one.
    const updateSource = (source: CaptionSource, values: Partial<RealtimeAsrSourceSettings>) =>
        setDraft(previous => previous && { ...previous, [source]: { ...previous[source], ...values } });
    // Left out unless chosen, as the backend saves it.
    const updateSilence = (value: string) => setDraft(draftNow => {
        if (!draftNow) return draftNow;
        const { silence_duration_ms: _, ...previous } = draftNow;
        return value ? { ...previous, silence_duration_ms: Number(value) } : previous;
    });
    const updateThreshold = (value: string) => setDraft(draftNow => {
        if (!draftNow) return draftNow;
        const { vad_threshold: _, ...previous } = draftNow;
        return value ? { ...previous, vad_threshold: Number(value) } : previous;
    });
    const vocabulary: RealtimeAsrVocabulary = draft?.vocabulary ?? { builtin: true, terms: [] };
    const updateVocabulary = (values: Partial<RealtimeAsrVocabulary>) => setDraft(previous => previous && { ...previous, vocabulary: { ...vocabulary, ...values } });
    // On a page that keeps descriptions out of sight (#614) what the captions are is the heading's
    // hint, and each field's words are its label's. What to do before
    // Start (save) and every state stay in sight.
    return <section data-setting-id="realtime_asr" className={styles.container} aria-label={t("realtime.title")}>
        <SectionLabelComponent sub label={t("realtime.title")} desc={t("realtime.scope")} />
        {draft && <form aria-busy={saving} ref={form.group} onBlur={form.leave} onKeyDown={form.escape}
            onSubmit={event => { event.preventDefault(); form.commit(); }}>
            {/* The server these captions use is chosen first in the page's speech.cpp part (AsrServer, #1266). */}
            {/* The model list's refresh sits under the list, in the control column (#473). */}
            <FormRow label={t("realtime.model")} description={t("realtime.auto_help")}
                actions={<button type="button" onClick={() => send("/get/data/realtime_asr_models")}>{t("realtime.refresh_models")}</button>}>
                <select aria-label={t("realtime.model")} value={draft.model}
                    onChange={event => setDraft({ ...draft, model: event.target.value })}>
                    <option value="">{t("realtime.select_model")}</option>
                    {draft.model && !selectedModel && <option value={draft.model}>{draft.model} ({t("realtime.unavailable")})</option>}
                    {knownModels.map(row => <option key={row.id} value={row.id}>{row.id}</option>)}
                </select>
            </FormRow>
            {models.error_code && <Failure code={models.error_code} t={t} />}
            <FormRow label={t("realtime.silence")} description={t("realtime.silence_help")}>
                <select aria-label={t("realtime.silence")} value={draft.silence_duration_ms ?? ""}
                    onChange={event => updateSilence(event.target.value)}>
                    <option value="">{t("realtime.silence_default")}</option>
                    {draft.silence_duration_ms && !SILENCES.includes(draft.silence_duration_ms) &&
                        <option value={draft.silence_duration_ms}>{t("realtime.silence_seconds", { seconds: draft.silence_duration_ms / 1000 })}</option>}
                    {SILENCES.map(ms => <option key={ms} value={ms}>{t("realtime.silence_seconds", { seconds: ms / 1000 })}</option>)}
                </select>
            </FormRow>
            <FormRow label={t("realtime.vad_threshold")} description={t("realtime.vad_threshold_help")}>
                <select aria-label={t("realtime.vad_threshold")} value={draft.vad_threshold ?? ""}
                    onChange={event => updateThreshold(event.target.value)}>
                    <option value="">{t("realtime.vad_threshold_default")}</option>
                    {draft.vad_threshold !== undefined && !THRESHOLDS.includes(draft.vad_threshold) &&
                        <option value={draft.vad_threshold}>{draft.vad_threshold}</option>}
                    {THRESHOLDS.map(value => <option key={value} value={value}>{value}</option>)}
                </select>
            </FormRow>
            <button type="button" onClick={refreshDevices}>{t("realtime.refresh_devices")}</button>
            {SOURCES.map(source => {
                const choices = endpoints[source]?.endpoints ?? [];
                const follow = !draft[source].endpoint && draft[source].follow_default !== false;
                const selected = follow || choices.find(row => key(row.endpoint) === key(draft[source].endpoint));
                // "auto" only for a model that detects the language (Qwen3-ASR). Listening's own model
                // (#1242) is read from the catalog, as its server is another than the listed one's.
                const own = source === "speaker" && bundled && listening.apart ? listeningLanguages(listening.current) : null;
                const languages = own ?? [...(selectedModel?.detects_language ? ["auto"] : []), ...(selectedModel?.languages ?? [])];
                const owner = state[source];
                const failure = endpoints[source]?.error_code || owner?.error_code;
                // Which output to choose for the game audio, and what following the system's default does.
                const inputHelp = [source === "speaker" && t("realtime.speaker_help"), follow && t("realtime.follow_default_help")].filter(Boolean).join("\n");
                // Where the Device page's rows lead (#1266 ★3).
                return <fieldset key={source} data-setting-id={`realtime_${source}`}>
                    <legend>{t(`realtime.${source}`)}</legend>
                    <FormRow label={t(`realtime.${source}_input`)} description={inputHelp || undefined}>
                        <select aria-label={t(`realtime.${source}_input`)} value={follow ? FOLLOW : key(draft[source].endpoint)}
                            onChange={event => updateSource(source, event.target.value === FOLLOW ? { endpoint: null, follow_default: true }
                                : { endpoint: choices.find(row => key(row.endpoint) === event.target.value)?.endpoint ?? null, follow_default: false })}>
                            <option value="">{t("realtime.select_device")}</option>
                            <option value={FOLLOW}>{t(`realtime.follow_default_${source}`)}</option>
                            {draft[source].endpoint && !selected && <option value={key(draft[source].endpoint)}>{t("realtime.disconnected")}</option>}
                            {choices.map(row => <option key={key(row.endpoint)} value={key(row.endpoint)}>{row.label}</option>)}
                        </select>
                    </FormRow>
                    {/* The switch's fix leads here when the model does not take the language (#1225). */}
                    <label data-setting-id={languageSettingId(source)}>{t(`realtime.${source}_language`)}<select aria-label={t(`realtime.${source}_language`)} value={draft[source].language}
                        onChange={event => updateSource(source, { language: event.target.value })}>
                        {!languages.includes(draft[source].language) && <option value={draft[source].language}>{languageLabel(draft[source].language)}</option>}
                        {languages.map(language => <option key={language} value={language}>{languageLabel(language)}</option>)}
                    </select></label>
                    <button type="button" disabled={saving || dirty || !selected || !(own || selectedModel) || !languages.includes(draft[source].language) ||
                        !owner || owner.requested || !!endpoints[source]?.error_code}
                        onClick={() => send("/run/start_realtime_asr", { source })}>{t(`realtime.start_${source}`)}</button>
                    <button type="button" onClick={() => send("/run/stop_realtime_asr", { source })}>{t(`realtime.stop_${source}`)}</button>
                    <EnvReadout tone={owner?.state === "ready" ? "active" : owner?.state === "failed" ? "failed" :
                        ["starting", "stopping"].includes(owner?.state ?? "") ? "warning" : "neutral"}>
                        <p>{t(`realtime.state_${owner?.state ?? "unknown"}`)}</p>
                    </EnvReadout>
                    {!!failure && <Failure code={String(failure)} t={t} />}
                </fieldset>;
            })}
            <fieldset>
                {/* How the dictionary is used and written: the legend's hint, whose mark takes focus as a heading's does. */}
                <legend><span className={styles.hinted} data-hint-host={hints || undefined}><span>{t("realtime.vocabulary")}</span>
                    {hints && <Hint text={t("realtime.vocabulary_help")} focusable />}</span></legend>
                {!hints && <Description text={t("realtime.vocabulary_help")} />}
                <label className={styles.checkLabel}><input type="checkbox" checked={vocabulary.builtin !== false}
                    onChange={event => updateVocabulary({ builtin: event.target.checked })} />{t("realtime.vocabulary_builtin")}</label>
                {/* The whole dictionary, one list: terms are added, changed and taken out there (#792).
                    Each edit goes to the draft; one term or many, the user's terms are canonical
                    as the core makes them, and the core checks them again on save. */}
                <VocabularyList builtin={builtinVocabulary} vocabulary={vocabulary} disabled={false}
                    onVocabulary={next => setDraft(previous => previous && { ...previous, vocabulary: next })} />
                {/* The dictionary in and out of a file, under the list (#792). */}
                <VocabularyFiles builtin={builtinVocabulary} vocabulary={vocabulary} disabled={false} send={send}
                    onVocabulary={next => setDraft(previous => previous && { ...previous, vocabulary: next })} />
            </fieldset>
            {/* What a change stops: a choice saves at once (#1111). */}
            <Description text={t("realtime.save_help")} />
            {problem && <FieldProblem id="realtime_asr_problem" text={t(problem)} />}
        </form>}
        {error && !problem && <Failure code={error} t={t} />}
    </section>;
};
