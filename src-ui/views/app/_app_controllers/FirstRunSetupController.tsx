import { useEffect, useRef, useState } from "react";
import type { Dispatch, MouseEvent, ReactNode, SetStateAction } from "react";
import type { TFunction } from "i18next";
import { useI18n } from "@useI18n";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranscription, useTranslation, useSettingValue } from "@logics_configs";
import { useStore_IsBackendReady, useStore_IsOpenedConfigPage, useStore_SelectedConfigTabId } from "@store";
import { useConsentDialog } from "../../../logics/common/useConsentDialog";
import { useRealtimeASR } from "../../../logics/transcription/useRealtimeASR";
import { useModelDownloads } from "../../../logics/voice/useModelDownloads";
import { useVirtualMic } from "../../../logics/voice/useVirtualMic";
import { useSetupNeeds } from "../../../logics/main/useSetupNeeds";
import { downloadProgress } from "../../../logics/main/setupNeeds";
import { useFirstRunSetup } from "../../../logics/setup/useFirstRunSetup";
import { useRecognitionState } from "../../../logics/setup/useRecognitionState";
import { setupPlan, planModels, planBytes, nextAction, stepState } from "../../../logics/setup/firstRunSetup.ts";
import type { RecognitionState, RunView, SetupStep } from "../../../logics/setup/firstRunSetup.ts";
import { translationNext, translationOffer } from "../../../logics/setup/translationSetup.ts";
import type { TranslationOffer } from "../../../logics/setup/translationSetup.ts";
import { startRequest } from "../../../logics/voice/modelRestrictions";
import { useVrchatPresence } from "../others/vrchat_presence/VrchatPresence";
import type { VrchatPresenceState } from "../others/vrchat_presence/VrchatPresence";
import styles from "../config_page/setting_section/setting_box/advanced_settings/VoiceSettings.module.scss";
import dialogStyles from "../config_page/setting_section/setting_box/_components/download_models/LegacyModelDownloadDialog.module.scss";
import * as ui from "./FirstRunSetupController.css.ts";

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

// One run of the translation's preparation (translationSetup.ts): what the consent was given for
// (the model, whether the choice changes) with the catalog version, and how far it has come.
// switched: it has asked to select the model.
interface TranslationRun {
    id: number;
    phase: "running" | "done" | "failed";
    offer: TranslationOffer;
    version: unknown;
    started: string | null | undefined;
    applied: readonly string[];
    switched: boolean;
    failure: string | null;
}

export const FirstRunSetupController = () => {
    const { t, i18n } = useI18n();
    const setup = useFirstRunSetup();
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

    // The plan is fixed when the consent is shown, with the catalog version it was shown for.
    const [consent, setConsent] = useState(false);
    const [run, setRun] = useState<SetupRun | null>(null);
    const draftPlan = setupPlan({ catalog: downloads.catalog, language: i18n?.language, engine, server, paths });
    const plan = run?.plan ?? draftPlan;
    const view: RunView = { engine, server, paths, jobs: downloads.state.jobs, started: run?.started ?? {}, applied: run?.applied ?? [] };

    // Ask for the catalog when the dialog opens without it (it normally comes after the start).
    useEffect(() => { if (open && !downloads.catalog) downloads.send("/get/data/model_download_catalog"); }, [open, !!downloads.catalog]);

    useRunner({ run, setRun, view, downloads, realtime, setSelectedTranscriptionEngine });

    // The translation's model: while the selected one is not on the PC, the setup prepares the model
    // it recommends (the default), as the recognition's section does, and selects it (#936).
    const { currentSelectedCTranslate2WeightType, currentCTranslate2WeightTypeStatus, setSelectedCTranslate2WeightType } = useTranslation();
    const downloadedWeights = (currentCTranslate2WeightTypeStatus.data ?? []).filter(item => item.is_downloaded).map(item => item.id);
    const [translationRun, setTranslationRun] = useState<TranslationRun | null>(null);
    const translationOffered = translationRun?.offer
        ?? (translationNeed ? translationOffer(downloads.catalog, currentSelectedCTranslate2WeightType.data, downloadedWeights) : null);
    useTranslationRunner({ run: translationRun, setRun: setTranslationRun, ready: !translationNeed, downloads,
        modelReady: !!translationRun && downloadedWeights.includes(translationRun.offer.weight), select: setSelectedCTranslate2WeightType });

    if (!open) return null;
    const running = run?.phase === "running";
    const finished = run?.phase === "done" || (!running && recognition === "ready");
    const needsConsent = planModels(draftPlan).length > 0;
    const finish = (forGood: boolean) => {
        close();
        if (forGood) setup.dismissNotice();
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

    return <div className={`${styles.container} ${dialogStyles.host}`}>
        <dialog ref={dialog} className={`${dialogStyles.dialog} ${ui.dialog}`} aria-label={t("first_run_setup.title")}
            onCancel={event => { event.preventDefault(); finish(false); }}>
            <div className={ui.header} data-slot="dialog-header">
                <h3 className={ui.title} data-slot="dialog-title">{t("first_run_setup.title")}</h3>
                <p className={ui.description} data-slot="dialog-description">{t("first_run_setup.purpose")}</p>
            </div>
            <Findings recognition={recognition} onLeave={() => finish(false)}
                translationPreparing={translationRun?.phase === "running"} translationHere={!!translationOffered}
                translationSwitches={!!translationOffered?.switches} translationLoading={!!translationNeed && !translationOffered && !downloads.catalog} />
            {!["cloud", "own_server"].includes(recognition) && <section className={ui.section} aria-labelledby="first-run-recognition">
                <h4 id="first-run-recognition" className={ui.sectionTitle}>{t("first_run_setup.recognition.heading")}</h4>
                {finished
                    ? <p role="status" className={ui.finished}>{t("first_run_setup.recognition.finished")}</p>
                    : <RecognitionSetup plan={plan} view={view} run={run} consent={consent} setConsent={setConsent}
                        catalogReady={!!downloads.catalog} />}
                {!finished && <div className={ui.actions}>
                    {!run && <button type="button" className="primary" disabled={(needsConsent && !consent) || !draftPlan?.length} onClick={begin}>
                        {t("first_run_setup.recognition.start")}</button>}
                    {running && <button type="button" onClick={stop}>{t("first_run_setup.recognition.stop")}</button>}
                    {run?.phase === "failed" && <button type="button" className="primary" onClick={retry}>{t("first_run_setup.recognition.retry")}</button>}
                    {!running && <OpenSettings tab="transcription" label={t("first_run_setup.recognition.choose_other")} onLeave={() => finish(false)} />}
                </div>}
            </section>}
            {translationOffered && <TranslationSetup offer={translationOffered} run={translationRun} setRun={setTranslationRun}
                modelReady={downloadedWeights.includes(translationOffered.weight)} onLeave={() => finish(false)}
                version={downloads.catalog?.catalog_version} jobs={downloads.state.jobs} send={downloads.send} />}
            <div className={ui.footer} data-slot="dialog-footer">
                <div className={ui.actions}>
                    <button type="button" onClick={() => finish(false)}>{t("first_run_setup.later")}</button>
                    {finished && <button type="button" className="primary" autoFocus onClick={() => finish(true)}>{t("first_run_setup.done")}</button>}
                </div>
                {!finished && setup.notice === true && <div className={dialogStyles.alternative}>
                    <button type="button" onClick={() => finish(true)}>{t("first_run_setup.dont_show")}</button>
                </div>}
            </div>
        </dialog>
    </div>;
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
interface TranslationRunnerProps {
    run: TranslationRun | null;
    setRun: Dispatch<SetStateAction<TranslationRun | null>>;
    // The setup no longer needs the model.
    ready: boolean;
    // The offered model is on the PC.
    modelReady: boolean;
    downloads: ReturnType<typeof useModelDownloads>;
    // Selects a translation model (/set/data/selected_ctranslate2_weight_type).
    select: (weight: string) => unknown;
}
const useTranslationRunner = ({ run, setRun, ready, modelReady, downloads, select }: TranslationRunnerProps) => {
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
            // As the recognition's section selects its engine: the model is on the PC, so the choice can change.
            setRun(previous => previous && { ...previous, switched: true });
            Promise.resolve(select(run.offer.weight)).then(result => {
                if (result === false) setRun(previous => previous && { ...previous, phase: "failed", failure: "backend_unavailable" });
            });
        } else if (!entry) {
            return;
        } else if (action.kind === "start") {
            setRun(previous => previous && { ...previous, started: job?.job_id ?? null });
            // The recommended model's license allows any use, so the one consent is all, as the recognition's.
            downloads.send("/run/start_model_download", startRequest({ id: entry.id, catalog_version: String(run.version ?? ""),
                restrictions: entry.restrictions }, []));
        } else {
            setRun(previous => previous && { ...previous, applied: [...previous.applied, action.jobId] });
            // The translation's download holds no path: nothing in the settings is expected.
            downloads.send("/run/apply_model_download", { id: entry.id, job_id: action.jobId, expected: {} });
        }
    }, [running, key, downloadError]);
};

// The translation's own section (#936), laid out as the recognition's section above: what it
// does, the model the setup recommends with its facts and total, the consent, then the steps
// (download it; select it when another model is selected) and the way to the Translation
// settings for other models. Nothing downloads before the consent, and the translation itself
// is not turned on.
interface TranslationSetupProps {
    offer: TranslationOffer;
    run: TranslationRun | null;
    setRun: Dispatch<SetStateAction<TranslationRun | null>>;
    // The offered model is on the PC.
    modelReady: boolean;
    onLeave: () => void;
    version: unknown;
    jobs: ReturnType<typeof useModelDownloads>["state"]["jobs"];
    send: ReturnType<typeof useModelDownloads>["send"];
}
const TranslationSetup = ({ offer, run, setRun, modelReady, onLeave, version, jobs, send }: TranslationSetupProps) => {
    const { t } = useI18n();
    const [consent, setConsent] = useState(false);
    const [linkFailed, setLinkFailed] = useState<string | null>(null);
    const { entry, switches } = offer;
    const job = entry ? jobs[entry.id] : undefined;
    const active = !!job && ACTIVE.includes(job.phase);
    const running = run?.phase === "running";
    const failed = run?.phase === "failed";
    // Nothing to download: no consent is asked, as the recognition's section with no model.
    const ready = entry ? consent : true;
    const openLink = async (event: MouseEvent<HTMLAnchorElement>, url: string) => {
        if (!isTauri()) return;
        event.preventDefault();
        try { await openUrl(url); setLinkFailed(null); } catch { setLinkFailed(url); }
    };
    const begin = () => {
        if (running || !ready) return;
        setRun({ id: newRunId(), phase: "running", offer, version, started: undefined, applied: [], switched: false, failure: null });
    };
    const retry = () => setRun(previous => previous && { ...previous, id: newRunId(), phase: "running", started: undefined, applied: [], switched: false, failure: null });
    const stop = () => {
        if (active && job.phase !== "cancelling") send("/run/cancel_model_download", { id: entry?.id, job_id: job.job_id });
        else setRun(previous => previous && { ...previous, phase: "failed", failure: "stopped" });
    };
    const card = entry ? entry.source ?? entry.licenses?.[0] : undefined;
    const what = !entry ? t("first_run_setup.translation.what_switch_only", { name: offer.name })
        : t(switches ? "first_run_setup.translation.what_switch" : "first_run_setup.translation.what");
    // The steps, as the recognition's: the download, then the choice. One that failed says why.
    const modelLabel = entry ? t("first_run_setup.translation.step_model", { name: entry.name }) : "";
    const modelState = modelReady ? "done" : failed ? "failed" : "working";
    const switchState = !modelReady ? "waiting" : failed ? "failed" : "working";
    const stateText = (state: string) => state === "failed" ? failureText(t, run?.failure ?? undefined) : t(`first_run_setup.recognition.state_${state}`);
    return <section className={ui.section} aria-labelledby="first-run-translation">
        <h4 id="first-run-translation" className={ui.sectionTitle}>{t("first_run_setup.translation.heading")}</h4>
        {run?.phase === "done"
            ? <p role="status" className={ui.finished}>{t("first_run_setup.translation.finished")}</p>
            : <>
                <p className={ui.text}>{what}</p>
                {entry && <ul className={ui.models} aria-label={t("first_run_setup.translation.model")}>
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
                {!run && entry && <label className={styles.checkLabel}>
                    <input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />
                    {t("first_run_setup.recognition.consent")}
                </label>}
                {run && <ol className={ui.steps} aria-label={t("first_run_setup.recognition.progress")}>
                    {entry && <li className={ui.step} data-state={modelState}>
                        <span className={ui.stepLabel}>{modelLabel}</span>
                        <span className={ui.stepState} role={modelState === "failed" ? "alert" : undefined}>
                            {modelState === "working" && active && job.phase === "downloading" && finiteNumber(job.total_bytes) && job.total_bytes > 0
                                ? t("first_run_setup.recognition.state_downloading", { done: gib(job.received_bytes ?? 0), total: gib(job.total_bytes) })
                                : modelState === "working" && active ? t(`model_downloads.phase_${job.phase}`) : stateText(modelState)}
                        </span>
                        {running && active && job.phase === "downloading" && (job.total_bytes ?? 0) > 0 &&
                            <progress className={styles.progress} value={job.received_bytes ?? 0} max={job.total_bytes} aria-label={modelLabel} />}
                    </li>}
                    {switches && <li className={ui.step} data-state={switchState}>
                        <span className={ui.stepLabel}>{t("first_run_setup.translation.step_switch", { name: offer.name })}</span>
                        <span className={ui.stepState} role={switchState === "failed" ? "alert" : undefined}>{stateText(switchState)}</span>
                    </li>}
                </ol>}
                {failed && <p className={ui.text}>{t("first_run_setup.translation.kept")}</p>}
                <div className={ui.actions}>
                    {!run && <button type="button" className="primary" disabled={!ready} onClick={begin}>
                        {t("first_run_setup.recognition.start")}</button>}
                    {running && <button type="button" onClick={stop}>{t("first_run_setup.recognition.stop")}</button>}
                    {failed && <button type="button" className="primary" onClick={retry}>{t("first_run_setup.recognition.retry")}</button>}
                    {!running && <OpenSettings tab="translation" label={t("first_run_setup.found.translation_open_settings")} onLeave={onLeave} />}
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
    const { updateIsOpenedConfigPage } = useStore_IsOpenedConfigPage();
    const { updateSelectedConfigTabId } = useStore_SelectedConfigTabId();
    const micName = mic?.state === "ok" && typeof mic.data === "string" && mic.data && mic.data !== "NoDevice" ? mic.data : null;
    const translation = needs.find(need => need.id === "translation");
    // The section below prepares the model the setup recommends, without leaving the setup
    // (#936), and the row says where. With another model selected, the row also leads to the
    // Translation settings, where an API key is registered or another model prepared (decided in
    // #938). The model's list not read yet: the row waits for it. Nothing to prepare here: only
    // the Translation settings. A download started elsewhere shows how far it has come.
    const openTranslationSettings = <button type="button" onClick={() => { onLeave(); updateSelectedConfigTabId("translation"); updateIsOpenedConfigPage(true); }}>
        {t("first_run_setup.found.translation_open_settings")}</button>;
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
        action: <button type="button" onClick={() => { onLeave(); openGuide(); }}>{t("first_run_setup.found.virtual_mic_open")}</button>,
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
        {urgent.length > 0 && <ul className={ui.urgent} data-slot="item-group" data-state="attention">
            {urgent.map(row => <Finding key={row.id} {...row} />)}</ul>}
        {settled.length > 0 && <ul className={ui.items} data-slot="item-group">
            {settled.map(row => <Finding key={row.id} {...row} />)}</ul>}
    </section>;
};

// How a row reads at a glance. ready: nothing to do; attention: the user has something to do
// (its words say what); checking: not known yet; neutral: neither, such as a choice made
// elsewhere.
type FindingState = "ready" | "attention" | "checking" | "neutral";
const VRCHAT_STATES: Record<VrchatPresenceState, FindingState> = {
    found: "ready", not_found: "attention", checking: "checking", unknown: "neutral", sending_off: "neutral", osc_query_off: "neutral",
};
const RECOGNITION_STATES: Record<RecognitionState, FindingState> = {
    ready: "ready", needs_setup: "attention", unknown: "checking", cloud: "neutral", own_server: "neutral",
};

// One row (shadcn/ui's Item): the mark, the name over what was found, and the row's action.
interface FindingProps {
    id: string;
    state: FindingState;
    name: string;
    live?: boolean;
    action?: ReactNode;
    children: ReactNode;
}
const Finding = ({ state, name, live = false, action, children }: FindingProps) =>
    <li className={state === "attention" ? ui.urgentItem : ui.item} data-slot="item" data-state={state}>
        <StateMark state={state} />
        <div className={ui.content} data-slot="item-content">
            <span className={ui.itemTitle} data-slot="item-title">{name}</span>
            <span className={ui.itemDescription} data-slot="item-description" role={live ? "status" : undefined}>{children}</span>
        </div>
        {action && <div className={ui.itemActions} data-slot="item-actions">{action}</div>}
    </li>;

// The mark only repeats what the row's words say, so it is hidden from screen readers.
const StateMark = ({ state }: { state: FindingState }) =>
    <span className={ui.mark} data-slot="item-media" data-state={state} aria-hidden="true">
        <svg viewBox="0 0 16 16">
            {state === "ready" && <>
                <circle className={ui.markShape.ready} cx="8" cy="8" r="7" />
                <path className={ui.markShape.glyph} d="M4.6 8.3l2.3 2.3 4.5-4.6" />
            </>}
            {state === "attention" && <>
                <circle className={ui.markShape.attention} cx="8" cy="8" r="7" />
                <path className={ui.markShape.glyph} d="M8 4.4v4.4M8 11.4v.2" />
            </>}
            {state === "checking" && <circle className={ui.markShape.arc} cx="8" cy="8" r="6" />}
            {state === "neutral" && <circle className={ui.markShape.ring} cx="8" cy="8" r="6.2" />}
        </svg>
    </span>;

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
                        <progress className={styles.progress} value={job.received_bytes ?? 0} max={job.total_bytes} aria-label={label} />}
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
    const { updateIsOpenedConfigPage } = useStore_IsOpenedConfigPage();
    const { updateSelectedConfigTabId } = useStore_SelectedConfigTabId();
    return <button type="button" onClick={() => { onLeave(); updateSelectedConfigTabId(tab); updateIsOpenedConfigPage(true); }}>{label}</button>;
};
