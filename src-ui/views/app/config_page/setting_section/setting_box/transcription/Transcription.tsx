import { CredentialPair } from "../_components/credential_pair/CredentialPair";
import { CustomModelLink } from "../_components/custom_model_link/CustomModelLink";
import { SpeechServers } from "../advanced_settings/SpeechServers";
import { useI18n } from "@useI18n";
import * as styles from "./Transcription.css.ts";
import * as catalogStyles from "../advanced_settings/VoiceSettings.css.ts";
import { RealtimeASRSettings } from "./RealtimeASRSettings";
import { AsrApiEntries } from "./AsrApiEntries";
import { genNumObjArray } from "@utils";
import { useEffect, useId } from "react";
import type { ReactNode } from "react";
import type { DropdownSelection } from "../_components/_atoms/_dropdown_menu/_DropdownMenu";

import {
    useTranscription,
    useSaveButtonLogic,
} from "@logics_configs";

import { CLOUD_TRANSCRIPTION_ENGINES } from "../../../../../../logics/configs/cloudTranscription";
import type { CloudTranscriptionEngine } from "../../../../../../logics/configs/cloudTranscription";

import {
    WordFilterContainer,
    RadioButtonContainer,
    DropdownMenuContainer,
    AuthKeyContainer,
    SliderContainer,
} from "../_templates/Templates";

import {
    SectionLabelComponent,
} from "../_components";

import { SetupSection } from "../_components/setup_section/SetupSection";
import { AdvancedSection } from "../_components/advanced_section/AdvancedSection";
import { HintDescriptions } from "../_components/hint/Hint";

export const Transcription = () => {
    const { t } = useI18n();
    const { currentMicPhraseTimeout, currentSpeakerPhraseTimeout } = useTranscription();
    // Reviewed against #614: the rows' descriptions are their labels' hints, and what the two
    // systems and the folds are for are their headings' and titles'. The engine in use, the
    // readouts, the warnings and the model downloads stay in sight.
    return (
        <HintDescriptions>
        <div className={styles.container}>
            {/* Which engine listens comes first: it decides what else on this page applies.
                Then the two systems it chooses from, as the translation catalog splits them
                (#413, #414): speech.cpp on your PC, with its models (the catalog's and your own)
                and its server, and the APIs, one fold per provider with its key. The word filter,
                how speech is cut into messages and the realtime captions' server are set once, in
                「詳細設定」 (#554), whose line shows the pauses that end a message. */}
            <TranscriptionEngine_Container />
            <EngineGroup group="speechcpp">
                <SpeechServers profiles={["asr"]} />
            </EngineGroup>
            <EngineGroup group="api">
                <CloudTranscription_Container />
            </EngineGroup>
            <AdvancedSection status={t("config_page.advanced_status.transcription", {
                phrase: currentMicPhraseTimeout.data ?? "-", speaker: currentSpeakerPhraseTimeout.data ?? "-" })}>
                <Mic_Container />
                <Speaker_Container />
                <RealtimeASRSettings />
            </AdvancedSection>
        </div>
        </HintDescriptions>
    );
};

// The engines' two systems (#414), each under its subheading with what it is: the subheading's
// hint on this page (#614). The ids are where the settings search leads for the texts
// config_page.transcription.<id>.
const ENGINE_GROUPS = { speechcpp: "speechcpp_section", api: "cloud_section" };

const EngineGroup = ({ group, children }: { group: "speechcpp" | "api"; children?: ReactNode }) => {
    const { t } = useI18n();
    const id = ENGINE_GROUPS[group];
    return (
        <div className={styles.engine_group} data-engine-group={group}>
            <div data-setting-id={id}>
                <SectionLabelComponent sub label={t(`config_page.transcription.${id}.label`)} desc={t(`config_page.transcription.${id}.desc`)} />
            </div>
            {children}
        </div>
    );
};


// The numbers that tune how speech is cut into messages are set once, if ever.
// They sit in one fold whose line shows the values in use, so the page stays
// short and nothing has to be opened to see what is set.
// `record` is the longest single recording (RECORD_TIMEOUT); `phrase` is how long after the
// last speech the gathered audio becomes one message (PHRASE_TIMEOUT).
type TimingFoldProps = { record?: number; phrase?: number; queue?: number; children?: ReactNode };

const TimingFold = ({ record, phrase, queue, children }: TimingFoldProps) => {
    const { t } = useI18n();
    return (
        <SetupSection title={t("config_page.transcription.timing_title")}
            status={t("config_page.transcription.timing_status", { record: record ?? "-", phrase: phrase ?? "-", queue: queue ?? "-" })}>
            {children}
        </SetupSection>
    );
};

const Mic_Container = () => {
    const { t } = useI18n();
    const { currentMicRecordTimeout, currentMicPhraseTimeout, currentMicMaxWords } = useTranscription();
    return (
        <div>
            <SectionLabelComponent sub label={t("config_page.transcription.section_label_mic")} />
            <MicWordFilter_Box />
            <TimingFold record={currentMicRecordTimeout.data} phrase={currentMicPhraseTimeout.data} queue={currentMicMaxWords.data}>
                <MicRecordTimeout_Box />
                <MicPhraseTimeout_Box />
                <MicMaxWords_Box />
            </TimingFold>
        </div>
    );
};

const MicRecordTimeout_Box = () => {
    const { t } = useI18n();
    const { currentMicRecordTimeout, setMicRecordTimeout } = useTranscription();

    const selectFunction = (selected_data: DropdownSelection) => {
        setMicRecordTimeout(selected_data.selected_id);
    };

    return (
        <DropdownMenuContainer
            dropdown_id="mic_record_timeout"
            label={t("config_page.transcription.mic_record_timeout.label")}
            desc={t("config_page.transcription.mic_record_timeout.desc")}
            selected_id={currentMicRecordTimeout.data}
            list={genNumObjArray(31)}
            selectFunction={selectFunction}
            state={currentMicRecordTimeout.state}
        />
    );
};
const MicPhraseTimeout_Box = () => {
    const { t } = useI18n();
    const { currentMicPhraseTimeout, setMicPhraseTimeout } = useTranscription();

    const selectFunction = (selected_data: DropdownSelection) => {
        setMicPhraseTimeout(selected_data.selected_id);
    };

    return (
        <DropdownMenuContainer
            dropdown_id="mic_phrase_timeout"
            label={t("config_page.transcription.mic_phrase_timeout.label")}
            desc={t("config_page.transcription.mic_phrase_timeout.desc")}
            selected_id={currentMicPhraseTimeout.data}
            list={genNumObjArray(31)}
            selectFunction={selectFunction}
            state={currentMicPhraseTimeout.state}
        />
    );
};
const MicMaxWords_Box = () => {
    const { t } = useI18n();
    const { currentMicMaxWords, setMicMaxWords } = useTranscription();

    const selectFunction = (selected_data: DropdownSelection) => {
        setMicMaxWords(selected_data.selected_id);
    };

    return (
        <DropdownMenuContainer
            dropdown_id="mic_max_phrase"
            label={t("config_page.transcription.mic_max_phrase.label")}
            desc={t("config_page.transcription.mic_max_phrase.desc")}
            selected_id={currentMicMaxWords.data}
            list={genNumObjArray(31)}
            selectFunction={selectFunction}
            state={currentMicMaxWords.state}
        />
    );
};

const MicWordFilter_Box = () => {
    const { t } = useI18n();

    return (
        <WordFilterContainer
            label={t("config_page.transcription.mic_word_filter.label")}
            desc={t("config_page.transcription.mic_word_filter.desc")}
        />
    );
};




const Speaker_Container = () => {
    const { t } = useI18n();
    const { currentSpeakerRecordTimeout, currentSpeakerPhraseTimeout, currentSpeakerMaxWords } = useTranscription();
    return (
        <div>
            <SectionLabelComponent sub label={t("config_page.transcription.section_label_speaker")} />
            <TimingFold record={currentSpeakerRecordTimeout.data} phrase={currentSpeakerPhraseTimeout.data} queue={currentSpeakerMaxWords.data}>
                <SpeakerRecordTimeout_Box />
                <SpeakerPhraseTimeout_Box />
                <SpeakerMaxWords_Box />
            </TimingFold>
        </div>
    );
};

const SpeakerRecordTimeout_Box = () => {
    const { t } = useI18n();
    const { currentSpeakerRecordTimeout, setSpeakerRecordTimeout } = useTranscription();

    const selectFunction = (selected_data: DropdownSelection) => {
        setSpeakerRecordTimeout(selected_data.selected_id);
    };

    return (
        <DropdownMenuContainer
            dropdown_id="speaker_record_timeout"
            desc={t("config_page.transcription.speaker_record_timeout.desc")}
            label={t("config_page.transcription.speaker_record_timeout.label")}
            selected_id={currentSpeakerRecordTimeout.data}
            list={genNumObjArray(31)}
            selectFunction={selectFunction}
            state={currentSpeakerRecordTimeout.state}
        />
    );
};
const SpeakerPhraseTimeout_Box = () => {
    const { t } = useI18n();
    const { currentSpeakerPhraseTimeout, setSpeakerPhraseTimeout } = useTranscription();

    const selectFunction = (selected_data: DropdownSelection) => {
        setSpeakerPhraseTimeout(selected_data.selected_id);
    };
    return (
        <DropdownMenuContainer
            dropdown_id="speaker_phrase_timeout"
            label={t("config_page.transcription.speaker_phrase_timeout.label")}
            desc={t("config_page.transcription.speaker_phrase_timeout.desc")}
            selected_id={currentSpeakerPhraseTimeout.data}
            list={genNumObjArray(31)}
            selectFunction={selectFunction}
            state={currentSpeakerPhraseTimeout.state}
        />
    );
};
const SpeakerMaxWords_Box = () => {
    const { t } = useI18n();
    const { currentSpeakerMaxWords, setSpeakerMaxWords } = useTranscription();

    const selectFunction = (selected_data: DropdownSelection) => {
        setSpeakerMaxWords(selected_data.selected_id);
    };

    return (
        <DropdownMenuContainer
            dropdown_id="speaker_max_phrase"
            label={t("config_page.transcription.speaker_max_phrase.label")}
            desc={t("config_page.transcription.speaker_max_phrase.desc")}
            selected_id={currentSpeakerMaxWords.data}
            list={genNumObjArray(61)}
            selectFunction={selectFunction}
            state={currentSpeakerMaxWords.state}
        />
    );
};



const TranscriptionEngine_Container = () => {
    const { t } = useI18n();

    return (
        <div>
            <SectionLabelComponent label={t("config_page.transcription.section_label_transcription_engines")} />
            <TranscriptionEngine_Box />
        </div>
    );
};

export const TranscriptionEngine_Box = () => {
    const { t } = useI18n();
    const { currentSelectedTranscriptionEngine, setSelectedTranscriptionEngine, currentSelectableTranscriptionEngines } = useTranscription();
    const available = currentSelectableTranscriptionEngines.data || [];
    const engineLabel = (key: string) => t(`config_page.transcription.select_transcription_engine.engines.${key}`);

    const local = { id: "SpeechCpp", label: engineLabel("speechcpp") };
    // An API engine can be chosen once the backend has accepted its key.
    const api_options = CLOUD_TRANSCRIPTION_ENGINES.map(engine => {
        const usable = available.includes(engine.id) || currentSelectedTranscriptionEngine.data === engine.id;
        return { id: engine.id, label: engineLabel(engine.key), disabled: !usable };
    });
    // The engine in use in the screen's words, not its id.
    const selected = [local, ...api_options].find(option => option.id === currentSelectedTranscriptionEngine.data);
    const noteId = useId();

    return (
        <RadioButtonContainer
            label={t("config_page.transcription.select_transcription_engine.label")}
            desc={t("config_page.transcription.select_transcription_engine.desc")}
            // The engine in use is a value, not a description: it stays under the label where the
            // description is a hint (#614), and the choice's description still includes it.
            note={<span role="status">{t("transcription_consent.selected", {
                engine: selected?.label || currentSelectedTranscriptionEngine.data || t("transcription_consent.unselected"),
            })}</span>}
            note_id={noteId}
            aria-describedby={noteId}
            selectFunction={setSelectedTranscriptionEngine}
            name="select_transcription_engine"
            // One choice, its options under the two systems' names, in the order the page shows
            // the systems below (#414).
            groups={[
                { id: "speechcpp", label: t("config_page.transcription.speechcpp_section.label"), options: [local] },
                { id: "api", label: t("config_page.transcription.cloud_section.label"), options: api_options },
            ]}
            checked_variable={currentSelectedTranscriptionEngine}
        />
    );
};

// The engine whose settings hold a URL beside its key (has_url): the user's own Whisper server.
const withUrl = (engine: CloudTranscriptionEngine): engine is CloudTranscriptionEngine & { base: "CustomWhisper" } =>
    engine.has_url === true && engine.base === "CustomWhisper";

// The APIs (#414): one fold per provider, as on the translation page, then the filter for what
// the Whisper ones return. The user's own Whisper server comes last and is marked as theirs,
// as the catalogs mark what the user added.
const CloudTranscription_Container = () => {
    const { t } = useI18n();
    const transcription = useTranscription();
    const { getSelectableTranscriptionEngines, getSelectedTranscriptionEngine } = transcription;
    // A saved, rejected or removed key changes which engines the backend can
    // use; the saved selection stays unchanged. Ask again each time.
    const watched = CLOUD_TRANSCRIPTION_ENGINES.map(engine => transcription[`current${engine.base}AuthKey`].data);
    watched.push(transcription.currentCustomWhisperURL.data);
    useEffect(() => {
        getSelectableTranscriptionEngines();
        getSelectedTranscriptionEngine();
    }, watched);

    return (
        <>
            {/* The line says whether the provider can be used, and the one selected above stays open. */}
            {CLOUD_TRANSCRIPTION_ENGINES.map(engine => {
                const in_use = transcription.currentSelectedTranscriptionEngine.data === engine.id;
                const usable = (transcription.currentSelectableTranscriptionEngines.data || []).includes(engine.id);
                const name = t(`config_page.transcription.select_transcription_engine.engines.${engine.key}`);
                return (
                    <SetupSection key={engine.id} attention={in_use}
                        title={engine.own ? <>{name} <span className={catalogStyles.badge} data-tone="own">
                            {t("config_page.transcription.select_transcription_engine.badge_own")}</span></> : name}
                        status={t(`config_page.translation.provider_${in_use ? "in_use" : usable ? "ready" : "not_set"}`)}>
                        {withUrl(engine)
                            ? <CredentialPair settings={transcription} base={engine.base} provider={engine.key} section="transcription" />
                            : <CloudAuthKey_Box engine={engine} />}
                        <CloudModel_Box engine={engine} />
                        {/* A Whisper server of your own runs the model you choose. */}
                        {engine.has_url && <CustomModelLink section="whisper-server" />}
                    </SetupSection>
                );
            })}
            {/* The APIs the user added (#414): Use points the custom Whisper server at one. */}
            <AsrApiEntries />
            <WhisperSegmentFilter_Box />
        </>
    );
};

// Groq, OpenAI (whisper-1) and a Whisper server of your own return segments with two
// scores; a segment below either threshold is dropped. Other engines ignore them.
const WHISPER_FILTERS = [
    { base: "MicAvgLogprob", key: "mic_avg_logprob", min: -2, max: 0, step: 0.05, labels: [-2, -1.5, -1, -0.5, 0] },
    { base: "MicNoSpeechProb", key: "mic_no_speech_prob", min: 0, max: 1, step: 0.05, labels: [0, 0.25, 0.5, 0.75, 1] },
    { base: "SpeakerAvgLogprob", key: "speaker_avg_logprob", min: -2, max: 0, step: 0.05, labels: [-2, -1.5, -1, -0.5, 0] },
    { base: "SpeakerNoSpeechProb", key: "speaker_no_speech_prob", min: 0, max: 1, step: 0.05, labels: [0, 0.25, 0.5, 0.75, 1] },
] as const;
type WhisperFilterBase = typeof WHISPER_FILTERS[number]["base"];

const WhisperSegmentFilter_Box = () => {
    const { t } = useI18n();
    const transcription = useTranscription();
    const value = (base: WhisperFilterBase) => transcription[`current${base}`].data;
    return (
        <SetupSection title={t("config_page.transcription.whisper_filter.title")}
            desc={t("config_page.transcription.whisper_filter.desc")}
            status={t("config_page.transcription.whisper_filter.status", {
                mic_logprob: value("MicAvgLogprob") ?? "-", mic_no_speech: value("MicNoSpeechProb") ?? "-",
                speaker_logprob: value("SpeakerAvgLogprob") ?? "-", speaker_no_speech: value("SpeakerNoSpeechProb") ?? "-",
            })}>
            {WHISPER_FILTERS.map((filter, index) => (
                <SliderContainer key={filter.key}
                    label={t(`config_page.transcription.whisper_filter.${filter.key}.label`)}
                    desc={t(`config_page.transcription.whisper_filter.${filter.key}.desc`)}
                    state={transcription[`current${filter.base}`].state}
                    variable={transcription[`current${filter.base}`].data}
                    setterFunction={transcription[`set${filter.base}`]}
                    min={filter.min}
                    max={filter.max}
                    step={filter.step}
                    show_label_values={filter.labels}
                    remove_border_bottom={index === WHISPER_FILTERS.length - 1}
                />
            ))}
        </SetupSection>
    );
};

// The key as the entry shows it. The save logic keeps whatever the backend answered with; React
// shows any value other than text, null and undefined as its text, so it is turned into that.
const entryText = (value: unknown): string | null | undefined =>
    value === null || value === undefined || typeof value === "string" ? value : String(value);

const CloudAuthKey_Box = ({ engine }: { engine: CloudTranscriptionEngine }) => {
    const { t } = useI18n();
    const transcription = useTranscription();
    const current = transcription[`current${engine.base}AuthKey`];
    const label = t(`config_page.transcription.${engine.key}_auth_key.label`);

    const { variable, onChangeFunction, saveFunction, leaveFunction, revert, error } = useSaveButtonLogic({
        variable: current.data,
        state: current.state,
        setFunction: transcription[`set${engine.base}AuthKey`],
        deleteFunction: transcription[`delete${engine.base}AuthKey`],
        label,
        autoSave: true,
        endpoint: `/set/data/${engine.key}_auth_key`,
    });

    return (
        <AuthKeyContainer
            label={label}
            desc={engine.has_url ? t(`config_page.transcription.${engine.key}_auth_key.desc`) : undefined}
            webpage_url={engine.webpage_url}
            variable={entryText(variable)}
            state={current.state}
            onChangeFunction={onChangeFunction}
            saveFunction={saveFunction}
            autoSave
            leaveFunction={leaveFunction}
            onRevert={revert}
            error={error}
            remove_border_bottom={true}
        />
    );
};

const CloudModel_Box = ({ engine }: { engine: CloudTranscriptionEngine }) => {
    const { t } = useI18n();
    const transcription = useTranscription();
    const auth_key = transcription[`current${engine.base}AuthKey`];
    const selectable = transcription[`currentSelectable${engine.base}ModelList`];
    const selected = transcription[`currentSelected${engine.base}Model`];
    const setSelected = transcription[`setSelected${engine.base}Model`];

    const selected_label = (!auth_key.data && !selected.data)
        ? t("config_page.common.correct_auth_key_required")
        : selected.data;

    return (
        <DropdownMenuContainer
            dropdown_id={`select_${engine.key}_model`}
            label={t(`config_page.transcription.select_${engine.key}_model.label`)}
            selected_id={selected_label}
            list={selectable.data}
            selectFunction={selected_data => setSelected(selected_data.selected_id)}
            state={selected.state}
            is_disabled={!auth_key.data}
        />
    );
};
