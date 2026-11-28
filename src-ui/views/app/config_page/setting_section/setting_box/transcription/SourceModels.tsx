import { useEffect, useRef, useState } from "react";
import { useI18n } from "@useI18n";
import { useTranscription } from "@logics_configs";
import { useRealtimeASR } from "../../../../../../logics/transcription/useRealtimeASR";
import { useSpeechServers } from "../../../../../../logics/voice/useSpeechServers";
import { useModelDownloads } from "../../../../../../logics/voice/useModelDownloads";
import { SAME, listeningChoice, recognitionServerRuns, sourceOutcome } from "../../../../../../logics/transcription/listeningModel";
import type { SourceAsk } from "../../../../../../logics/transcription/listeningModel";
import type { CaptionSource } from "../../../../../../logics/transcription/realtimeCaptionState";
import { familyLabel } from "../../../../../../logics/voice/modelCatalog";
import * as styles from "../advanced_settings/VoiceSettings.css.ts";
import { FormRow } from "../_components/form_row/FormRow";

// No recognition model set for Mic input.
const UNSET = "";
const ENGINE = "SpeechCpp";

// Which recognition model each input uses on the bundled server (#1308 ★1, decided on 2026-11-28):
// Mic input's and Listening's side by side in the speech.cpp part, each chosen among the recognition
// models on the PC. The catalog under 「モデルとサーバー」 downloads them, shows which input uses each,
// and chooses one for an input from its card with the same check and apply as here. A choice is
// checked (#1263) and applied for its input alone (#1242): Listening's own model never changes Mic
// input's.
//
// Taking a recognition model here selects speech.cpp as the engine when none is selected yet (#1308
// ★3), as the first-run setup does: the main screen then stops saying speech recognition is not
// ready while the switches already use it.
export const SourceModels = () => {
    const { t } = useI18n();
    const { settings: realtime } = useRealtimeASR();
    const { settings: speech, state: servers, send: sendSpeech } = useSpeechServers();
    const { catalog, state: downloads, send: sendDownload } = useModelDownloads();
    const { currentSelectedTranscriptionEngine, setSelectedTranscriptionEngine } = useTranscription();
    const bundled = realtime?.server === "bundled";
    const asr = speech?.profiles?.asr;
    const choice = listeningChoice(catalog, downloads.downloaded, asr);
    const [asked, setAsked] = useState<SourceAsk | null>(null);
    // The check's end: its apply once it is ready, or nothing once it failed or was stopped (the
    // catalog's card says why), so the fields do not wait for good.
    const outcome = sourceOutcome(asked, downloads.jobs, { mic: asr?.model ?? "", speaker: choice.path });
    useEffect(() => {
        if (!outcome) return;
        setAsked(null);
        if (outcome !== "ended") sendDownload("/run/apply_model_download", outcome);
    }, [outcome === "ended" ? "ended" : outcome?.job_id]);
    useEffect(() => {
        if (!bundled) return;
        if (!catalog) sendDownload("/get/data/model_download_catalog");
        sendDownload("/get/data/model_download_state");
    }, [bundled]);
    // A recognition model that comes to be set, from here or from the catalog's download.
    const set = !!(asr?.model?.trim() || asr?.listening_model?.trim());
    const wasSet = useRef<boolean | null>(null);
    useEffect(() => {
        if (!asr) return;
        const before = wasSet.current;
        wasSet.current = set;
        if (before === false && set && currentSelectedTranscriptionEngine.state === "ok" && !currentSelectedTranscriptionEngine.data) {
            setSelectedTranscriptionEngine(ENGINE);
        }
    }, [set, !!asr]);
    if (!bundled || !asr) return null;
    // Mic input's server, and Listening's own while it runs (#1290), which the state also lists.
    const running = recognitionServerRuns(servers);
    const busy = running || !!asked;
    const choose = (source: CaptionSource, value: string) => {
        if (source === "speaker" && value === SAME) {
            if (speech) sendSpeech("/set/data/speech_server_settings", { ...speech, profiles: { ...speech.profiles, asr: { ...asr, listening_model: "" } } });
            return;
        }
        if (!catalog || !choice.choices.some(row => row.id === value)) return;
        setAsked({ id: value, before: downloads.jobs[value]?.job_id ?? null, source });
        sendDownload("/run/check_model_download", { id: value, catalog_version: catalog.catalog_version });
    };
    const micValue = choice.mic?.id ?? (asr.model.trim() ? asr.model : UNSET);
    const listeningValue = choice.apart ? choice.current?.id ?? choice.path : SAME;
    // What the two fields are, and where more models come from; while a server runs, why they wait.
    const help = [t("source_models.help"), !choice.choices.length && t("source_models.none_on_pc"), running && t("source_models.running")]
        .filter(Boolean).join("\n");
    return <section data-setting-id="source_models" data-settings-group className={styles.container} aria-label={t("source_models.title")}>
        <div data-setting-id="source_model_mic">
            <FormRow label={t("source_models.mic")} description={help}>
                <select aria-label={t("source_models.mic")} value={micValue} disabled={busy} onChange={event => choose("mic", event.target.value)}>
                    {!asr.model.trim() && <option value={UNSET}>{t("source_models.unset")}</option>}
                    {asr.model.trim() && !choice.mic && <option value={asr.model}>{t("realtime.listening_own_file")}</option>}
                    {choice.choices.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
            </FormRow>
        </div>
        <div data-setting-id="source_model_speaker">
            <FormRow label={t("realtime.listening_model")} description={t("realtime.listening_model_help")}>
                <select aria-label={t("realtime.listening_model")} value={listeningValue} disabled={busy} onChange={event => choose("speaker", event.target.value)}>
                    <option value={SAME}>{choice.mic ? t("realtime.listening_same_named", { model: familyLabel(choice.mic) }) : t("realtime.listening_same")}</option>
                    {choice.apart && !choice.current && <option value={choice.path}>{t("realtime.listening_own_file")}</option>}
                    {choice.choices.filter(row => row.id !== choice.mic?.id || choice.apart).map(row =>
                        <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
            </FormRow>
        </div>
    </section>;
};
