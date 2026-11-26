import { useEffect, useRef, useState } from "react";
import type { Dispatch, MouseEvent, ReactNode, SetStateAction } from "react";
import type { TFunction } from "i18next";
import { useI18n } from "@useI18n";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranscription, useTranslation, useSettingValue } from "@logics_configs";
import { useStore_IsBackendReady } from "@store";
import { useOpenSettings } from "../../../logics/common/useOpenSettings";
import { useConsentDialog } from "../../../logics/common/useConsentDialog";
import { useRealtimeASR } from "../../../logics/transcription/useRealtimeASR";
import { useModelDownloads } from "../../../logics/voice/useModelDownloads";
import { useVirtualMic } from "../../../logics/voice/useVirtualMic";
import { useSetupNeeds } from "../../../logics/main/useSetupNeeds";
import { downloadProgress } from "../../../logics/main/setupNeeds";
import { useFirstRunSetup } from "../../../logics/setup/useFirstRunSetup";
import { useRecognitionState } from "../../../logics/setup/useRecognitionState";
import { setupPlan, planModels, planBytes, nextAction, stepState, recommendedAsr } from "../../../logics/setup/firstRunSetup.ts";
import type { RecognitionState, RunView, SetupEntry, SetupStep } from "../../../logics/setup/firstRunSetup.ts";
import { DEFAULT_TRANSLATION_WEIGHT, translationEntry, translationNext, translationOffer } from "../../../logics/setup/translationSetup.ts";
import type { TranslationOffer } from "../../../logics/setup/translationSetup.ts";
import { SKIP, SPEECH_TARGETS, chosenEntry, featureOutcome, modelChoices, recommendedSpeech, settled as isSettled, switchesToLead } from "../../../logics/setup/setupChoices.ts";
import { useSetupLeads } from "../../../logics/setup/useSetupLeads";
import type { FeatureView, SetupFeature } from "../../../logics/setup/setupChoices.ts";
import { canStart, restrictionsOf, startRequest } from "../../../logics/voice/modelRestrictions";
import { familyLabel } from "../../../logics/voice/modelCatalog";
import { hardwareWarning, translationDeviceMode } from "../../../logics/voice/modelHardwareWarning";
import { useSpeechServers } from "../../../logics/voice/useSpeechServers";
import { weightRequest } from "../../../logics/configs/ctranslate2License";
import type { WeightRequest } from "../../../logics/configs/ctranslate2License";
import { useVrchatPresence } from "../others/vrchat_presence/VrchatPresence";
import type { VrchatPresenceState } from "../others/vrchat_presence/VrchatPresence";
import * as styles from "../config_page/setting_section/setting_box/advanced_settings/VoiceSettings.css.ts";
import * as dialogStyles from "../config_page/setting_section/setting_box/_components/download_models/LegacyModelDownloadDialog.css.ts";
import * as ui from "./FirstRunSetupController.css.ts";
import { Button, Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Item, ItemActions, ItemContent, ItemDescription, ItemGroup,
    ItemMedia, ItemTitle, Progress, Select, SelectOptGroup, SelectOption } from "../../kit/index.ts";
import type { ItemState } from "../../kit/index.ts";

const ACTIVE: readonly unknown[] = ["queued", "downloading", "verifying", "cancelling"];
const finiteNumber = (value: unknown): value is number => Number.isFinite(value);
// GiB with two decimals; a file under 0.1 GiB (the VAD model) in MiB, so it never reads "0.00 GiB".
const gib = (value: number) => value < 0.1 * 1073741824 ? `${(value / 1048576).toFixed(1)} MiB` : `${(value / 1073741824).toFixed(2)} GiB`;

// The first-run setup (#557). It opens only from the first screen, never by itself (#935): while it
// is still suggested and the local speech recognition is not ready yet, the first screen's line to
// it stands out (EmptyState), and the user opens it.
//
// It leads with what it is for, shows what was found (microphone, VRChat, virtual microphone,
// translation, speech recognition), and offers one action: download the recommended recognition
// model and the VAD model after one consent that names each model, its provider, license and
// size, then write them into the settings and switch the recognition to the bundled speech.cpp
// server. Nothing is downloaded before that consent, and nothing turns the microphone on.
//
// The run is derived from the saved settings and the download state (firstRunSetup.ts), so a
// failed step stops it there and "Try again" continues from the first step not done. Downloads
// are verified before they are applied, so a failure keeps the previous settings (#517).
//
// "Later" and Escape put it away; downloads already started go on. "Done" and "Stop highlighting"
// end the suggestion: the first screen's line to it no longer stands out.
//
// The local translation's model is prepared here too (#936), never by leaving the setup: when the
// selected translation model can be downloaded, its own section shows the model's name,
// provider, license and size with links to its card and license, takes the consent (and one per
// license restriction, as the catalogs do), downloads it, applies it, and says the translation is
// ready; the translation row above then reads as ready.
//
// It is drawn as shadcn/ui's Dialog with its parts, and what was found as an Item list: each
// row has a mark that tells at a glance whether it is ready or needs the user, the name, what was
// found in words, and its action under them (FirstRunSetupController.css.ts).

// A model step of the plan.
type ModelStep = Extract<SetupStep, { kind: "model" }>;

// One run: the plan fixed at the consent with the catalog version it was shown for, what it has
// asked for so far, and how it ended. A new id for each run, "Try again" included.
interface SetupRun {
    id: number;
    phase: "running" | "done" | "failed";
    plan: SetupStep[];
    version: unknown;
    started: Readonly<Record<string, string | null>>;
    applied: readonly string[];
    sentServer: boolean;
    failure: { step: number; code: string } | null;
}

// One run of a one-model section's preparation (the translation's and the text to speech's,
// translationSetup.ts): what the consent was given for (the model, whether the choice changes)
// with the catalog version and the restrictions acknowledged, and how far it has come.
// switched: it has asked to select the model.
interface ModelRun {
    id: number;
    phase: "running" | "done" | "failed";
    offer: TranslationOffer;
    version: unknown;
    acknowledged: readonly string[];
    started: string | null | undefined;
    applied: readonly string[];
    switched: boolean;
    failure: string | null;
}

export const FirstRunSetupController = () => {
    const { t, i18n } = useI18n();
    const setup = useFirstRunSetup();
    const leads = useSetupLeads();
    const { currentIsBackendReady } = useStore_IsBackendReady();
    const { setSelectedTranscriptionEngine } = useTranscription();
    const realtime = useRealtimeASR();
    const downloads = useModelDownloads();
    const ready = currentIsBackendReady.data === true;
    const { state: recognition, engine, server, paths } = useRecognitionState();
    // The translation's model is prepared here too (#936).
    const { needs } = useSetupNeeds();
    const translationNeed = needs.find(need => need.id === "translation");

    // It does not open by itself, so once its state is known the next start-up notice (the virtual
    // microphone guide) may come.
    const known = recognition !== "unknown" && setup.notice !== null;
    useEffect(() => { if (ready && known) setup.markSettled(); }, [ready, known]);

    const open = setup.opened;
    const { dialog, close } = useConsentDialog(open);

    // Each feature is chosen on its own (#955): a model to install, or none. The recognition and the
    // translation start at the model the setup recommends; the text to speech, which needs a GPU,
    // starts at "do not install". The plan is fixed when the consent is shown, with the catalog
    // version it was shown for.
    const language = i18n?.language;
    const recommendedRecognition = recommendedAsr(downloads.catalog, language);
    const recognitionChoices = modelChoices(downloads.catalog, ["asr"], recommendedRecognition?.id);
    const [recognitionChoice, setRecognitionChoice] = useState<string | null>(null);
    // null while the catalog is not known yet: nothing chosen, nothing skipped.
    const recognitionValue = recognitionChoice ?? recommendedRecognition?.id ?? null;
    const recognitionSkipped = recognitionValue === SKIP;
    const [consent, setConsent] = useState(false);
    const [run, setRun] = useState<SetupRun | null>(null);
    const draftPlan = recognitionSkipped ? null
        : setupPlan({ catalog: downloads.catalog, language, engine, server, paths, asr: chosenEntry(recognitionChoices, recognitionValue) });
    const plan = run?.plan ?? draftPlan;
    const view: RunView = { engine, server, paths, jobs: downloads.state.jobs, started: run?.started ?? {}, applied: run?.applied ?? [] };

    // Ask for the catalog when the dialog opens without it (it normally comes after the start).
    useEffect(() => { if (open && !downloads.catalog) downloads.send("/get/data/model_download_catalog"); }, [open, !!downloads.catalog]);
    // What the PC has, for the choices' warnings: read once the dialog opens, as the catalogs do.
    useEffect(() => { if (open) downloads.ensureHardware?.(); }, [open, downloads.hardware?.phase]);

    useRunner({ run, setRun, view, downloads, realtime, setSelectedTranscriptionEngine });

    // The translation's model: while the selected one is not on the PC, the setup prepares the one
    // chosen here (the default unless another is), and selects it (#936, #955).
    const { currentSelectedCTranslate2WeightType, currentCTranslate2WeightTypeStatus, setSelectedCTranslate2WeightType,
        currentSelectedTranslationComputeDevice } = useTranslation();
    const downloadedWeights = (currentCTranslate2WeightTypeStatus.data ?? []).filter(item => item.is_downloaded).map(item => item.id);
    const defaultTranslation = translationEntry(downloads.catalog, DEFAULT_TRANSLATION_WEIGHT);
    const translationChoices = modelChoices(downloads.catalog, ["translation"], defaultTranslation?.id);
    const [translationChoice, setTranslationChoice] = useState<string | null>(null);
    const translationValue = translationChoice ?? defaultTranslation?.id ?? null;
    const [translationRun, setTranslationRun] = useState<ModelRun | null>(null);
    const translationOffered = translationRun?.offer ?? (translationNeed && translationValue !== SKIP
        ? translationOffer(downloads.catalog, currentSelectedCTranslate2WeightType.data, downloadedWeights, chosenEntry(translationChoices, translationValue))
        : null);
    useModelRunner({ run: translationRun, setRun: setTranslationRun, ready: !translationNeed, downloads, expected: {},
        modelReady: !!translationRun && downloadedWeights.includes(translationRun.offer.weight), select: setSelectedCTranslate2WeightType });

    // The text to speech (#955): a model for the Japanese or the other languages' voice, downloaded
    // and written into its speech server profile, as the recognition's model is into its own.
    const { settings: speechServers } = useSpeechServers();
    const speechReadyBefore = SPEECH_TARGETS.some(target => typeof speechServers?.profiles?.[target]?.model === "string" && speechServers.profiles[target].model.trim() !== "");
    const recommendedVoice = recommendedSpeech(downloads.catalog, language);
    const speechChoices = modelChoices(downloads.catalog, SPEECH_TARGETS, recommendedVoice?.id);
    const [speechChoice, setSpeechChoice] = useState<string>(SKIP);
    const [speechRun, setSpeechRun] = useState<ModelRun | null>(null);
    const speechEntry = chosenEntry(speechChoices, speechChoice);
    const speechOffered = speechRun?.offer ?? (speechEntry
        ? { weight: speechEntry.id, name: speechEntry.name, entry: speechEntry, switches: false, restrictions: restrictionsOf(speechEntry) } : null);
    const speechTarget: (typeof SPEECH_TARGETS)[number] = speechOffered?.entry?.target === "multilingual" ? "multilingual" : "japanese";
    const speechJob = speechRun?.offer.entry ? downloads.state.jobs[speechRun.offer.entry.id] : undefined;
    const speechDone = !!speechRun && speechJob?.phase === "applied" && !!speechJob.job_id && speechRun.applied.includes(speechJob.job_id);
    useModelRunner({ run: speechRun, setRun: setSpeechRun, ready: speechDone, modelReady: false, downloads,
        expected: { model: String(speechServers?.profiles?.[speechTarget]?.model ?? "") } });

    if (!open) return null;
    const running = run?.phase === "running";
    const recognitionReady = run?.phase === "done" || (!running && ["ready", "cloud", "own_server"].includes(recognition));
    const needsConsent = planModels(draftPlan).length > 0;
    // Each feature settled: ready, or not installed now, and nothing of it under way. "Done" is then
    // offered, with what to turn on on the main screen (#955).
    const features: Record<SetupFeature, FeatureView> = {
        recognition: { ready: recognitionReady, skipped: recognitionSkipped && !run, running },
        translation: { ready: !translationNeed, skipped: translationValue === SKIP && !translationRun, running: translationRun?.phase === "running" },
        speech: { ready: speechReadyBefore || speechRun?.phase === "done", skipped: speechChoice === SKIP && !speechRun, running: speechRun?.phase === "running" },
    };
    const finished = Object.values(features).every(isSettled);
    const finish = (forGood: boolean) => {
        close();
        if (forGood) setup.dismissNotice();
        // "Done" at the end: the main screen's switches of the features prepared stand out until
        // each is turned on (#955). Nothing is turned on here.
        if (forGood && finished) leads.lead(switchesToLead(features));
        setup.closeSetup();
    };
    // Each run has its own id, so the error watch below starts over with it.
    const begin = () => {
        if (!draftPlan?.length || (needsConsent && !consent) || running) return;
        setRun({ id: newRunId(), phase: "running", plan: draftPlan, version: downloads.catalog?.catalog_version,
            started: {}, applied: [], sentServer: false, failure: null });
    };
    const retry = () => setRun(previous => previous && { ...previous, id: newRunId(), phase: "running",
        started: {}, applied: [], sentServer: false, failure: null });
    const stop = () => {
        // Stop shows only while a run goes, and a run has its plan.
        if (!plan) return;
        const step = plan.find((item): item is ModelStep => item.kind === "model" && ACTIVE.includes(downloads.state.jobs[item.entry.id]?.phase));
        const job = step && downloads.state.jobs[step.entry.id];
        if (step && job && job.phase !== "cancelling") downloads.send("/run/cancel_model_download", { id: step.entry.id, job_id: job.job_id });
        else setRun(previous => previous && { ...previous, phase: "failed", failure: { step: plan.findIndex((_, i) => stepState(plan, i, view, null) !== "done"), code: "stopped" } });
    };
    const choiceLabel = t("first_run_setup.choice.label");
    // A model that may be too heavy for the PC says so in its choice (#955), as in the catalogs: the
    // speech models for where the speech engine runs (automatic), the translation's for its device.
    const hardware = downloads.hardware;
    const speechWarned = (entry: SetupEntry) => !!hardwareWarning(entry, hardware);
    const translationMode = translationDeviceMode(currentSelectedTranslationComputeDevice?.data, hardware);
    const translationWarned = (entry: SetupEntry) => translationMode !== null && !!hardwareWarning(entry, hardware, { deviceMode: translationMode });
    const recognitionDone = recognitionReady;

    // The kit's Dialog (D-23). What the setup is for is drawn as its description; the dialog is
    // named by its title alone and has no description, as before the kit (D-43).
    return <div className={`${styles.container} ${dialogStyles.host}`}>
        <Dialog ref={dialog} open={open} onOpenChange={() => finish(false)} className={ui.dialog} aria-describedby={undefined}>
            <DialogHeader>
                <DialogTitle>{t("first_run_setup.title")}</DialogTitle>
                <DialogDescription>{t("first_run_setup.purpose")}</DialogDescription>
            </DialogHeader>
            <Findings recognition={recognition} onLeave={() => finish(false)}
                translationPreparing={translationRun?.phase === "running"} translationHere={!!translationOffered}
                translationSwitches={!!translationOffered?.switches} translationLoading={!!translationNeed && !translationOffered && !downloads.catalog && translationValue !== SKIP} />
            {!["cloud", "own_server"].includes(recognition) && <section className={ui.section} aria-labelledby="first-run-recognition">
                <h4 id="first-run-recognition" className={ui.sectionTitle}>{t("first_run_setup.recognition.heading")}</h4>
                {recognitionDone
                    ? <p role="status" className={ui.finished}>{t("first_run_setup.recognition.finished")}</p>
                    : <>
                        {!run && recognition === "needs_setup" && recognitionChoices.length > 0 && <ModelChoice label={choiceLabel} choices={recognitionChoices}
                            recommended={recommendedRecognition?.id} value={recognitionValue ?? SKIP} onChange={setRecognitionChoice} warned={speechWarned} />}
                        {recognitionSkipped && !run
                            ? <p className={ui.text}>{t("first_run_setup.recognition.skipped")}</p>
                            : <RecognitionSetup plan={plan} view={view} run={run} consent={consent} setConsent={setConsent}
                                catalogReady={!!downloads.catalog} />}
                    </>}
                {/* Stop is the kit's danger Button, as every stop (D-10). */}
                {!recognitionDone && <div className={ui.actions}>
                    {!run && !recognitionSkipped && <Button tone="primary" disabled={(needsConsent && !consent) || !draftPlan?.length} onClick={begin}>
                        {t("first_run_setup.recognition.start")}</Button>}
                    {running && <Button tone="danger" onClick={stop}>{t("first_run_setup.recognition.stop")}</Button>}
                    {run?.phase === "failed" && <Button tone="primary" onClick={retry}>{t("first_run_setup.recognition.retry")}</Button>}
                    {!running && <OpenSettings tab="transcription" label={t("first_run_setup.recognition.choose_other")} onLeave={() => finish(false)} />}
                </div>}
            </section>}
            {(translationNeed || translationRun) && <ModelSetup words="translation" offer={translationOffered} run={translationRun} setRun={setTranslationRun}
                choice={translationChoices.length > 0 && <ModelChoice label={choiceLabel} choices={translationChoices} recommended={defaultTranslation?.id}
                    value={translationValue ?? SKIP} onChange={setTranslationChoice} warned={translationWarned} />}
                modelReady={!!translationOffered && downloadedWeights.includes(translationOffered.weight)} onLeave={() => finish(false)}
                settingsTab="translation" settingsLabel={t("first_run_setup.found.translation_open_settings")}
                version={downloads.catalog?.catalog_version} jobs={downloads.state.jobs} send={downloads.send} />}
            <ModelSetup words="speech" offer={speechOffered} run={speechRun} setRun={setSpeechRun} alreadyReady={speechReadyBefore}
                choice={speechChoices.length > 0 && <ModelChoice label={choiceLabel} choices={speechChoices} recommended={recommendedVoice?.id}
                    value={speechChoice} onChange={setSpeechChoice} groupOf={entry => t(`first_run_setup.speech.group_${entry.target}`)} warned={speechWarned} />}
                modelReady={speechDone} onLeave={() => finish(false)}
                settingsTab="tts" settingsLabel={t("first_run_setup.speech.choose_other")}
                version={downloads.catalog?.catalog_version} jobs={downloads.state.jobs} send={downloads.send} />
            {/* The setup's end (#955): which switches on the main screen to turn on, for the features
                prepared; the others can stay off. Nothing is turned on here. */}
            {finished && <NextSteps features={features} />}
            <DialogFooter>
                <Button onClick={() => finish(false)}>{t("first_run_setup.later")}</Button>
                {finished && <Button tone="primary" autoFocus onClick={() => finish(true)}>{t("first_run_setup.done")}</Button>}
                {/* Ending the suggestion: the kit's quiet Button, on its own line under the two (decided on 2026-11-25). */}
                {!finished && setup.notice === true && <div className={ui.footerLine}>
                    <Button tone="quiet" onClick={() => finish(true)}>{t("first_run_setup.dont_show")}</Button>
                </div>}
            </DialogFooter>
        </Dialog>
    </div>;
};

// What to do on the main screen once the setup is settled (#955): for each feature, its switch to
// turn on when it was prepared, or that it is not used now and its switch can stay off. The rows
// are drawn as the findings' quiet list: a mark, the feature's name, then the words.
const FEATURE_SWITCHES: Record<SetupFeature, string> = {
    recognition: "first_run_setup.next.switch_recognition",
    translation: "first_run_setup.next.switch_translation",
    speech: "first_run_setup.next.switch_speech",
};
const NextSteps = ({ features }: { features: Record<SetupFeature, FeatureView> }) => {
    const { t } = useI18n();
    return <section className={ui.section} aria-labelledby="first-run-next">
        <h4 id="first-run-next" className={ui.sectionTitle}>{t("first_run_setup.next.heading")}</h4>
        <ItemGroup variant="outline">
            {(Object.keys(features) as SetupFeature[]).map(feature => {
                const outcome = featureOutcome(features[feature]);
                return <Finding key={feature} id={`next-${feature}`} state={outcome === "use" ? "ready" : "neutral"} name={t(`first_run_setup.next.name_${feature}`)}>
                    {t(outcome === "use" ? "first_run_setup.next.use" : "first_run_setup.next.unused", { switches: t(FEATURE_SWITCHES[feature]) })}
                </Finding>;
            })}
        </ItemGroup>
    </section>;
};

let runCount = 0;
const newRunId = () => ++runCount;

// An error counts for a run only once it was clear during that run: every request clears the
// error before it is sent, so an error left from before the run is not this run's, while the
// same code coming back after a retry is.
const useRunError = (runId: number | undefined, active: boolean, error: string | null): string | null => {
    const watch = useRef<{ runId: number | null | undefined; clear: boolean }>({ runId: null, clear: false });
    if (watch.current.runId !== runId) watch.current = { runId, clear: false };
    if (active && !error) watch.current.clear = true;
    return active && watch.current.clear && error ? error : null;
};

// Sends the next request of a run, once each, and records how the run ends.
interface RunnerProps {
    run: SetupRun | null;
    setRun: Dispatch<SetStateAction<SetupRun | null>>;
    view: RunView;
    downloads: ReturnType<typeof useModelDownloads>;
    realtime: ReturnType<typeof useRealtimeASR>;
    setSelectedTranscriptionEngine: ReturnType<typeof useTranscription>["setSelectedTranscriptionEngine"];
}
const useRunner = ({ run, setRun, view, downloads, realtime, setSelectedTranscriptionEngine }: RunnerProps) => {
    const sent = useRef(new Set<string | null>());
    const running = run?.phase === "running";
    const action = running ? nextAction(run.plan, view) : null;
    const key = action && run && JSON.stringify([run.id, action.kind, "entry" in action ? action.entry.id : null, "jobId" in action ? action.jobId : null]);
    // A refused request (consent, catalog changed, busy, a server running) stops the run with its reason.
    const downloadError = useRunError(run?.id, running, downloads.error);
    const realtimeError = useRunError(run?.id, running && run.sentServer, realtime.error);
    useEffect(() => {
        if (!running) { sent.current.clear(); return; }
        const failAt = (code: string) => setRun(previous => previous && {
            ...previous, phase: "failed",
            failure: { step: previous.plan.findIndex((_, i) => stepState(previous.plan, i, view, null) !== "done"), code } });
        if (downloadError) return failAt(downloadError);
        if (realtimeError) return failAt(realtimeError);
        if (!action || action.kind === "wait") return;
        if (action.kind === "done") { setRun(previous => previous && { ...previous, phase: "done" }); return; }
        if (action.kind === "failed") {
            setRun(previous => previous && { ...previous, phase: "failed", failure: { step: action.step, code: action.code } });
            return;
        }
        if (sent.current.has(key)) return;
        sent.current.add(key);
        if (action.kind === "start") {
            setRun(previous => previous && { ...previous, started: { ...previous.started, [action.entry.id]: view.jobs[action.entry.id]?.job_id ?? null } });
            downloads.send("/run/start_model_download", { id: action.entry.id, consent: true, catalog_version: run.version });
        } else if (action.kind === "apply") {
            setRun(previous => previous && { ...previous, applied: [...previous.applied, action.jobId] });
            downloads.send("/run/apply_model_download", { id: action.entry.id, job_id: action.jobId, expected: action.expected });
        } else if (action.kind === "server") {
            if (!realtime.settings) { sent.current.delete(key); return; }
            setRun(previous => previous && { ...previous, sentServer: true });
            realtime.send("/set/data/realtime_asr_settings", { ...realtime.settings, server: "bundled" });
        } else if (action.kind === "engine") {
            Promise.resolve(setSelectedTranscriptionEngine("SpeechCpp")).then(result => { if (result === false) failAt("backend_unavailable"); });
        }
    }, [running, key, downloadError, realtimeError]);
};

// Sends the translation run's next request, once each, and records how it ends (#936).
// Sends a one-model run's next request, once each, and records how it ends (#936, #955).
interface ModelRunnerProps {
    run: ModelRun | null;
    setRun: Dispatch<SetStateAction<ModelRun | null>>;
    // The setup no longer needs the model.
    ready: boolean;
    // The offered model is on the PC.
    modelReady: boolean;
    downloads: ReturnType<typeof useModelDownloads>;
    // Selects the translation model (/set/data/selected_ctranslate2_weight_type), with the consent
    // to its restricted license when one was acknowledged. The text to speech selects nothing.
    select?: (request: WeightRequest) => unknown;
    // What the settings hold where the download goes: nothing for a model found by its catalog id
    // (the translation's), the profile's path for a text-to-speech model.
    expected: Record<string, string>;
}
const useModelRunner = ({ run, setRun, ready, modelReady, downloads, select, expected }: ModelRunnerProps) => {
    const sent = useRef(new Set<string | null>());
    const running = run?.phase === "running";
    const entry = run?.offer.entry ?? null;
    const job = entry ? downloads.state.jobs[entry.id] : undefined;
    const action = running ? translationNext({ job, started: run.started, applied: run.applied, ready, modelReady,
        switches: run.offer.switches, switched: run.switched }) : null;
    const key = action && run && JSON.stringify([run.id, action.kind, "jobId" in action ? action.jobId : null]);
    const downloadError = useRunError(run?.id, running, downloads.error);
    useEffect(() => {
        if (!running || !run) { sent.current.clear(); return; }
        if (downloadError) { setRun(previous => previous && { ...previous, phase: "failed", failure: downloadError }); return; }
        if (!action || action.kind === "wait") return;
        if (action.kind === "done") { setRun(previous => previous && { ...previous, phase: "done" }); return; }
        if (action.kind === "failed") { setRun(previous => previous && { ...previous, phase: "failed", failure: action.code }); return; }
        if (sent.current.has(key)) return;
        sent.current.add(key);
        if (action.kind === "switch") {
            if (!select) return;
            // As the recognition's section selects its engine: the model is on the PC, so the choice can change.
            setRun(previous => previous && { ...previous, switched: true });
            const accepted = run.offer.restrictions.length > 0 && run.offer.restrictions.every(kind => run.acknowledged.includes(kind));
            Promise.resolve(select(weightRequest(run.offer.weight, accepted))).then(result => {
                if (result === false) setRun(previous => previous && { ...previous, phase: "failed", failure: "backend_unavailable" });
            });
        } else if (!entry) {
            return;
        } else if (action.kind === "start") {
            setRun(previous => previous && { ...previous, started: job?.job_id ?? null });
            downloads.send("/run/start_model_download", startRequest({ id: entry.id, catalog_version: String(run.version ?? ""),
                restrictions: entry.restrictions }, run.acknowledged));
        } else {
            setRun(previous => previous && { ...previous, applied: [...previous.applied, action.jobId] });
            downloads.send("/run/apply_model_download", { id: entry.id, job_id: action.jobId, expected });
        }
    }, [running, key, downloadError]);
};

// The model a section prepares, chosen in the setup (#955): one file per model, the recommended
// one first and marked, and "do not install" last. A list of the forms' kind, as every choice
// from a list is; the section's facts and consent follow for the model chosen.
interface ModelChoiceProps {
    label: string;
    choices: readonly SetupEntry[];
    recommended: string | null | undefined;
    value: string;
    onChange: (value: string) => void;
    // The heading of a choice's group, when the list holds more than one kind (the text to speech's).
    groupOf?: (entry: SetupEntry) => string;
    // Whether the model may be too heavy for the user's PC (modelHardwareWarning.ts): its option
    // then says so, as the catalog's file choice does.
    warned?: (entry: SetupEntry) => boolean;
}
const ModelChoice = ({ label, choices, recommended, value, onChange, groupOf, warned }: ModelChoiceProps) => {
    const { t } = useI18n();
    // The recommended mark is part of the words, so each language places it as it writes it.
    const option = (entry: SetupEntry) => <SelectOption key={entry.id} value={entry.id}>
        {[t(entry.id === recommended ? "first_run_setup.choice.option_recommended" : "first_run_setup.choice.option",
            { name: familyLabel(entry), size: gib(entry.total_bytes) }),
            warned?.(entry) && t("model_catalog.hardware_warning.option")].filter(Boolean).join(" · ")}
    </SelectOption>;
    const groups = groupOf ? [...new Set(choices.map(groupOf))] : [];
    return <label className={ui.choice}>
        <span>{label}</span>
        <Select value={value} onChange={event => onChange(event.target.value)}>
            {groupOf
                ? groups.map(group => <SelectOptGroup key={group} label={group}>{choices.filter(entry => groupOf(entry) === group).map(option)}</SelectOptGroup>)
                : choices.map(option)}
            <SelectOption value={SKIP}>{t("first_run_setup.choice.skip")}</SelectOption>
        </Select>
    </label>;
};

// A one-model section (#936, #955), laid out as the recognition's section above: the choice of the
// model, what it does, the model with its facts and total, the consent (and one for each license
// restriction), then the steps (download it; select it when another model is selected) and the way
// to the settings page for more. Nothing downloads before the consent, and the feature itself is
// not turned on. words: the section's own words (first_run_setup.<words>.*). offer: null while
// "do not install" is chosen; the section then says the feature is not used now.
interface ModelSetupProps {
    words: "translation" | "speech";
    choice: ReactNode;
    offer: TranslationOffer | null;
    run: ModelRun | null;
    setRun: Dispatch<SetStateAction<ModelRun | null>>;
    // The offered model is on the PC.
    modelReady: boolean;
    // The section's feature was ready before it opened: no choice, only that.
    alreadyReady?: boolean;
    settingsTab: string;
    settingsLabel: string;
    onLeave: () => void;
    version: unknown;
    jobs: ReturnType<typeof useModelDownloads>["state"]["jobs"];
    send: ReturnType<typeof useModelDownloads>["send"];
}
const ModelSetup = ({ words, choice, offer, run, setRun, modelReady, alreadyReady = false, settingsTab, settingsLabel, onLeave, version, jobs, send }: ModelSetupProps) => {
    const { t } = useI18n();
    const [consent, setConsent] = useState(false);
    const [acknowledged, setAcknowledged] = useState<string[]>([]);
    const [linkFailed, setLinkFailed] = useState<string | null>(null);
    const key = (name: string) => `first_run_setup.${words}.${name}`;
    const shown = run?.offer ?? offer;
    const entry = shown?.entry ?? null, switches = !!shown?.switches;
    const restrictions = shown?.restrictions ?? [];
    const job = entry ? jobs[entry.id] : undefined;
    const active = !!job && ACTIVE.includes(job.phase);
    const running = run?.phase === "running";
    const failed = run?.phase === "failed";
    const acknowledgedAll = restrictions.every(kind => acknowledged.includes(kind));
    // Nothing to download: no consent is asked, as the recognition's section with no model; a
    // restricted license is still acknowledged before the choice changes.
    const ready = !!shown && (entry ? canStart(entry, consent, acknowledged) : acknowledgedAll);
    const openLink = async (event: MouseEvent<HTMLAnchorElement>, url: string) => {
        if (!isTauri()) return;
        event.preventDefault();
        try { await openUrl(url); setLinkFailed(null); } catch { setLinkFailed(url); }
    };
    const begin = () => {
        if (running || !ready || !shown) return;
        setRun({ id: newRunId(), phase: "running", offer: shown, version, acknowledged, started: undefined, applied: [], switched: false, failure: null });
    };
    const retry = () => setRun(previous => previous && { ...previous, id: newRunId(), phase: "running", started: undefined, applied: [], switched: false, failure: null });
    const stop = () => {
        if (active && job.phase !== "cancelling") send("/run/cancel_model_download", { id: entry?.id, job_id: job.job_id });
        else setRun(previous => previous && { ...previous, phase: "failed", failure: "stopped" });
    };
    const card = entry ? entry.source ?? entry.licenses?.[0] : undefined;
    const what = !shown ? "" : !entry ? t(key("what_switch_only"), { name: shown.name }) : t(key(switches ? "what_switch" : "what"));
    // The steps, as the recognition's: the download, then the choice. One that failed says why.
    const modelLabel = entry ? t(key("step_model"), { name: entry.name }) : "";
    const modelState = modelReady ? "done" : failed ? "failed" : "working";
    const switchState = !modelReady ? "waiting" : failed ? "failed" : "working";
    const stateText = (state: string) => state === "failed" ? failureText(t, run?.failure ?? undefined) : t(`first_run_setup.recognition.state_${state}`);
    const acknowledge = (kind: string, checked: boolean) =>
        setAcknowledged(previous => checked ? [...previous.filter(item => item !== kind), kind] : previous.filter(item => item !== kind));
    return <section className={ui.section} aria-labelledby={`first-run-${words}`}>
        <h4 id={`first-run-${words}`} className={ui.sectionTitle}>{t(key("heading"))}</h4>
        {run?.phase === "done" || (alreadyReady && !run)
            ? <p role="status" className={ui.finished}>{t(key("finished"))}</p>
            : <>
                {!run && choice}
                {!shown ? <p className={ui.text}>{t(key("skipped"))}</p> : <>
                <p className={ui.text}>{what}</p>
                {entry && <ul className={ui.models} aria-label={t(key("model"))}>
                    <li className={ui.model}>
                        <span className={ui.modelName}>{entry.name}</span>
                        <span className={ui.modelFacts}>
                            <span>{t("first_run_setup.recognition.model_provider", { provider: entry.provider ?? "" })}</span>
                            <span>{t("first_run_setup.recognition.model_license", { license: entry.license ?? "" })}</span>
                            <span>{t("first_run_setup.recognition.model_size", { size: gib(entry.total_bytes) })}</span>
                            {card && <a href={card} target="_blank" rel="noreferrer" onClick={event => openLink(event, card)}>
                                {t("first_run_setup.recognition.model_card")}</a>}
                        </span>
                    </li>
                </ul>}
                {linkFailed && <p role="alert">{t("model_downloads.link_error")} <code className={dialogStyles.path}>{linkFailed}</code></p>}
                {entry && <p className={ui.total}>{t("first_run_setup.recognition.total", { size: gib(entry.total_bytes),
                    bytes: Number.isFinite(entry.total_bytes) ? entry.total_bytes.toLocaleString("en-US") : "0" })}</p>}
                {/* A license that restricts the use is said, and acknowledged on its own (#411). */}
                {restrictions.map(kind => <p key={kind} className={ui.text}>
                    <strong>{t([`model_downloads.restriction.${kind}.title`, "model_downloads.restriction.other.title"])}</strong>{" "}
                    {t([`model_downloads.restriction.${kind}.note`, "model_downloads.restriction.other.note"], { license: shown.entry?.license ?? "" })}</p>)}
                {!run && <>
                    {entry && <label className={styles.checkLabel}>
                        <input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />
                        {t("first_run_setup.recognition.consent")}
                    </label>}
                    {restrictions.map(kind => <label key={kind} className={styles.checkLabel}>
                        <input type="checkbox" checked={acknowledged.includes(kind)} onChange={event => acknowledge(kind, event.target.checked)} />
                        {t(`model_downloads.restriction.${kind}.acknowledge`, { license: shown.entry?.license ?? "" })}
                    </label>)}
                </>}
                {run && <ol className={ui.steps} aria-label={t("first_run_setup.recognition.progress")}>
                    {entry && <li className={ui.step} data-state={modelState}>
                        <span className={ui.stepLabel}>{modelLabel}</span>
                        <span className={ui.stepState} role={modelState === "failed" ? "alert" : undefined}>
                            {modelState === "working" && active && job.phase === "downloading" && finiteNumber(job.total_bytes) && job.total_bytes > 0
                                ? t("first_run_setup.recognition.state_downloading", { done: gib(job.received_bytes ?? 0), total: gib(job.total_bytes) })
                                : modelState === "working" && active ? t(`model_downloads.phase_${job.phase}`) : stateText(modelState)}
                        </span>
                        {running && active && job.phase === "downloading" && (job.total_bytes ?? 0) > 0 &&
                            <Progress value={job.received_bytes ?? 0} max={job.total_bytes} aria-label={modelLabel} />}
                    </li>}
                    {switches && <li className={ui.step} data-state={switchState}>
                        <span className={ui.stepLabel}>{t(key("step_switch"), { name: shown.name })}</span>
                        <span className={ui.stepState} role={switchState === "failed" ? "alert" : undefined}>{stateText(switchState)}</span>
                    </li>}
                </ol>}
                {failed && <p className={ui.text}>{t(key("kept"))}</p>}
                </>}
                <div className={ui.actions}>
                    {!run && shown && <Button tone="primary" disabled={!ready} onClick={begin}>
                        {t("first_run_setup.recognition.start")}</Button>}
                    {running && <Button tone="danger" onClick={stop}>{t("first_run_setup.recognition.stop")}</Button>}
                    {failed && <Button tone="primary" onClick={retry}>{t("first_run_setup.recognition.retry")}</Button>}
                    {!running && <OpenSettings tab={settingsTab} label={settingsLabel} onLeave={onLeave} />}
                </div>
            </>}
    </section>;
};

// What was found. Each row only reads; its button leads to the place where it is set.
// Whether a row needs the user is told by the layout before the words are read (#614): what
// needs the user comes first, each row a card of its own with the warning's amber rule and tint,
// a larger mark and its name in full strength; the rest follow in one quiet frame, smaller and
// muted. The words are the same in both.
// translationHere: the translation's model is prepared in the setup's own section below (#936);
// translationSwitches: that section selects the default model, another one being selected;
// translationPreparing: that section's run is under way; translationLoading: the model's list
// is not read yet.
interface FindingsProps {
    recognition: RecognitionState;
    onLeave: () => void;
    translationHere?: boolean;
    translationSwitches?: boolean;
    translationPreparing?: boolean;
    translationLoading?: boolean;
}
const Findings = ({ recognition, onLeave, translationHere = false, translationSwitches = false, translationPreparing = false,
    translationLoading = false }: FindingsProps) => {
    const { t } = useI18n();
    const mic = useSettingValue("SelectedMicDevice");
    const vrchat = useVrchatPresence();
    const { status: virtualMic, openGuide } = useVirtualMic();
    const { needs } = useSetupNeeds();
    const openSettings = useOpenSettings();
    const micName = mic?.state === "ok" && typeof mic.data === "string" && mic.data && mic.data !== "NoDevice" ? mic.data : null;
    const translation = needs.find(need => need.id === "translation");
    // The section below prepares the model the setup recommends, without leaving the setup
    // (#936), and the row says where. With another model selected, the row also leads to the
    // Translation settings, where an API key is registered or another model prepared (decided in
    // #938). The model's list not read yet: the row waits for it. Nothing to prepare here: only
    // the Translation settings. A download started elsewhere shows how far it has come.
    const openTranslationSettings = <Button onClick={() => { onLeave(); openSettings({ page: "translation" }); }}>
        {t("first_run_setup.found.translation_open_settings")}</Button>;
    const translationProgress = translation ? downloadProgress(translation.weight) : null;
    const translationRow = (): Pick<FindingProps, "state" | "action" | "children"> => {
        if (!translation) return { state: "ready", children: t("first_run_setup.found.translation_ready") };
        if (translationPreparing) return { state: "checking", children: t("first_run_setup.found.translation_preparing") };
        if (translationProgress !== null) return { state: "checking",
            children: t(translationProgress === "pending" ? "studio.setup_preparing" : "studio.setup_downloading", { progress: translationProgress }) };
        if (translationHere && translationSwitches) return { state: "attention", children: t("first_run_setup.found.translation_switch_here"),
            action: openTranslationSettings };
        if (translationHere) return { state: "attention", children: t("first_run_setup.found.translation_model_missing") };
        if (translationLoading) return { state: "checking", children: t("first_run_setup.recognition.loading") };
        return { state: "attention", children: t("first_run_setup.found.translation_missing"), action: openTranslationSettings };
    };
    const cables = virtualMic?.supported === true && virtualMic.error === null ? virtualMic.cables.length : null;
    // No virtual cable needs the user, like the other things the setup looks for (decided in #759):
    // its row goes to the cards, and its words say when it is needed.
    const virtualMicRow: FindingProps | null = cables === null ? null : { id: "virtual_mic", state: cables > 0 ? "ready" : "attention",
        name: t("first_run_setup.found.virtual_mic"),
        action: <Button onClick={() => { onLeave(); openGuide(); }}>{t("first_run_setup.found.virtual_mic_open")}</Button>,
        children: t(cables > 0 ? "first_run_setup.found.virtual_mic_found" : "first_run_setup.found.virtual_mic_missing") };
    const rows: FindingProps[] = [
        { id: "mic", state: micName ? "ready" : "attention", name: t("first_run_setup.found.mic"),
            children: micName ?? t("first_run_setup.found.mic_missing") },
        // The readout's words, as the other rows' (its frame stays on the VRChat page). They
        // change by themselves while the dialog is open, so they are announced.
        { id: "vrchat", state: VRCHAT_STATES[vrchat.state], name: t("first_run_setup.found.vrchat"), live: true,
            children: vrchat.lines.map(line => <span key={line}>{line}</span>) },
        ...(virtualMicRow ? [virtualMicRow] : []),
        { id: "translation", name: t("first_run_setup.found.translation"), ...translationRow() },
        { id: "recognition", state: RECOGNITION_STATES[recognition], name: t("first_run_setup.found.recognition"),
            children: t(`first_run_setup.found.recognition_${recognition}`) },
    ];
    const urgent = rows.filter(row => row.state === "attention");
    const settled = rows.filter(row => row.state !== "attention");
    return <section className={ui.section} aria-labelledby="first-run-found">
        <h4 id="first-run-found" className={ui.sectionTitle}>{t("first_run_setup.found.heading")}</h4>
        {urgent.length > 0 && <ItemGroup data-state="attention">
            {urgent.map(row => <Finding key={row.id} {...row} />)}</ItemGroup>}
        {settled.length > 0 && <ItemGroup variant="outline">
            {settled.map(row => <Finding key={row.id} {...row} />)}</ItemGroup>}
    </section>;
};

// How a row reads at a glance, as the kit's Item marks it. ready: nothing to do; attention: the
// user has something to do (its words say what); checking: not known yet; neutral: neither, such as
// a choice made elsewhere.
type FindingState = ItemState;
const VRCHAT_STATES: Record<VrchatPresenceState, FindingState> = {
    found: "ready", not_found: "attention", checking: "checking", unknown: "neutral", sending_off: "neutral", osc_query_off: "neutral",
};
const RECOGNITION_STATES: Record<RecognitionState, FindingState> = {
    ready: "ready", needs_setup: "attention", unknown: "checking", cloud: "neutral", own_server: "neutral",
};

// One row, the kit's Item (shadcn/ui's): the mark, the name over what was found, and the row's
// action under the words. A row that needs the user is the attention card.
interface FindingProps {
    id: string;
    state: FindingState;
    name: string;
    live?: boolean;
    action?: ReactNode;
    children: ReactNode;
}
const Finding = ({ state, name, live = false, action, children }: FindingProps) =>
    <Item variant={state === "attention" ? "attention" : "default"} data-state={state}>
        <ItemMedia state={state} />
        <ItemContent>
            <ItemTitle>{name}</ItemTitle>
            <ItemDescription role={live ? "status" : undefined}>{children}</ItemDescription>
        </ItemContent>
        {action && <ItemActions>{action}</ItemActions>}
    </Item>;

// The consent for the recognition models, then each step's progress.
interface RecognitionSetupProps {
    plan: SetupStep[] | null;
    view: RunView;
    run: SetupRun | null;
    consent: boolean;
    setConsent: (consent: boolean) => void;
    catalogReady: boolean;
}
const RecognitionSetup = ({ plan, view, run, consent, setConsent, catalogReady }: RecognitionSetupProps) => {
    const { t } = useI18n();
    const [linkFailed, setLinkFailed] = useState<string | null>(null);
    if (!catalogReady || !plan) return <p role="status" className={ui.text}>{t("first_run_setup.recognition.loading")}</p>;
    const models = planModels(plan);
    const openLink = async (event: MouseEvent<HTMLAnchorElement>, url: string) => {
        if (!isTauri()) return;
        event.preventDefault();
        try { await openUrl(url); setLinkFailed(null); } catch { setLinkFailed(url); }
    };
    const failedAt = run?.phase === "failed" ? run.failure?.step ?? null : null;
    return <>
        <p className={ui.text}>{t("first_run_setup.recognition.what")}</p>
        {models.length > 0 && <ul className={ui.models} aria-label={t("first_run_setup.recognition.models")}>
            {models.map(entry => <li key={entry.id} className={ui.model}>
                <span className={ui.modelName}>{entry.name}</span>
                {/* Each fact keeps its label and value together; a long provider name wraps inside its own item. */}
                <span className={ui.modelFacts}>
                    <span>{t("first_run_setup.recognition.model_provider", { provider: entry.provider ?? "" })}</span>
                    <span>{t("first_run_setup.recognition.model_license", { license: entry.license ?? "" })}</span>
                    <span>{t("first_run_setup.recognition.model_size", { size: gib(entry.total_bytes) })}</span>
                    {entry.licenses?.[0] && <a href={entry.licenses[0]} target="_blank" rel="noreferrer"
                        onClick={event => { const url = entry.licenses?.[0]; if (url) openLink(event, url); }}>{t("first_run_setup.recognition.model_card")}</a>}
                </span>
            </li>)}
        </ul>}
        {linkFailed && <p role="alert">{t("model_downloads.link_error")} <code className={dialogStyles.path}>{linkFailed}</code></p>}
        {models.length > 0 && <p className={ui.total}>{t("first_run_setup.recognition.total", { size: gib(planBytes(plan)),
            bytes: planBytes(plan).toLocaleString("en-US") })}</p>}
        {!run && models.length > 0 && <label className={styles.checkLabel}>
            <input type="checkbox" autoFocus checked={consent} onChange={event => setConsent(event.target.checked)} />
            {t("first_run_setup.recognition.consent")}
        </label>}
        {!run && models.length === 0 && plan.length > 0 && <p className={ui.text}>{t("first_run_setup.recognition.no_download")}</p>}
        {run && <ol className={ui.steps} aria-label={t("first_run_setup.recognition.progress")}>
            {plan.map((step, index) => {
                const state = stepState(plan, index, view, failedAt);
                const job = step.kind === "model" ? view.jobs[step.entry.id] : null;
                const active = job && ACTIVE.includes(job.phase);
                const label = step.kind === "model" ? t("first_run_setup.recognition.step_model", { name: step.entry.name })
                    : t(`first_run_setup.recognition.step_${step.kind}`);
                return <li key={index} className={ui.step} data-state={state}>
                    <span className={ui.stepLabel}>{label}</span>
                    <span className={ui.stepState} role={state === "failed" ? "alert" : undefined}>
                        {state === "working" && active && job.phase === "downloading" && finiteNumber(job.total_bytes) && job.total_bytes > 0
                            ? t("first_run_setup.recognition.state_downloading", { done: gib(job.received_bytes ?? 0), total: gib(job.total_bytes) })
                            : state === "working" && active ? t(`model_downloads.phase_${job.phase}`)
                            : state === "failed" ? failureText(t, run.failure?.code)
                            : t(`first_run_setup.recognition.state_${state}`)}
                    </span>
                    {state === "working" && active && job.phase === "downloading" && (job.total_bytes ?? 0) > 0 &&
                        <Progress value={job.received_bytes ?? 0} max={job.total_bytes} aria-label={label} />}
                </li>;
            })}
        </ol>}
        {run?.phase === "failed" && <p className={ui.text}>{t("first_run_setup.recognition.kept")}</p>}
    </>;
};

// A failure in words: the download's own message when it has one, else a general one.
const failureText = (t: TFunction, code: string | undefined) => {
    if (code === "stopped" || code === "cancelled") return t("first_run_setup.recognition.state_stopped");
    return t([`model_downloads.errors.${code}`, "first_run_setup.recognition.state_failed"]);
};

const OpenSettings = ({ tab, label, onLeave }: { tab: string; label: string; onLeave: () => void }) => {
    const openSettings = useOpenSettings();
    return <Button onClick={() => { onLeave(); openSettings({ page: tab }); }}>{label}</Button>;
};
