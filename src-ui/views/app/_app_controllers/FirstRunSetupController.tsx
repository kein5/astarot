import { useEffect, useRef, useState } from "react";
import type { Dispatch, MouseEvent, ReactNode, SetStateAction } from "react";
import type { TFunction } from "i18next";
import { useI18n } from "@useI18n";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useOthers, useTranscription, useSettingValue } from "@logics_configs";
import { useStore_IsBackendReady, useStore_IsOpenedConfigPage, useStore_SelectedConfigTabId } from "@store";
import { useConsentDialog } from "../../../logics/common/useConsentDialog";
import { useRealtimeASR } from "../../../logics/transcription/useRealtimeASR";
import { useModelDownloads } from "../../../logics/voice/useModelDownloads";
import { useVirtualMic } from "../../../logics/voice/useVirtualMic";
import { useSetupNeeds } from "../../../logics/main/useSetupNeeds";
import { useOpenTranslatorList } from "../../../logics/translation/useOpenTranslatorList";
import { useFirstRunSetup } from "../../../logics/setup/useFirstRunSetup";
import { useRecognitionState } from "../../../logics/setup/useRecognitionState";
import { setupPlan, planModels, planBytes, nextAction, stepState, setupOpensByItself }
    from "../../../logics/setup/firstRunSetup.ts";
import type { RecognitionState, RunView, SetupStep } from "../../../logics/setup/firstRunSetup.ts";
import { useVrchatPresence } from "../others/vrchat_presence/VrchatPresence";
import type { VrchatPresenceState } from "../others/vrchat_presence/VrchatPresence";
import styles from "../config_page/setting_section/setting_box/advanced_settings/VoiceSettings.module.scss";
import dialogStyles from "../config_page/setting_section/setting_box/_components/download_models/LegacyModelDownloadDialog.module.scss";
import * as ui from "./FirstRunSetupController.css.ts";

const ACTIVE: readonly unknown[] = ["queued", "downloading", "verifying", "cancelling"];
const finiteNumber = (value: unknown): value is number => Number.isFinite(value);
// GiB with two decimals; a file under 0.1 GiB (the VAD model) in MiB, so it never reads "0.00 GiB".
const gib = (value: number) => value < 0.1 * 1073741824 ? `${(value / 1048576).toFixed(1)} MiB` : `${(value / 1073741824).toFixed(2)} GiB`;

// The first-run setup (#557). It opens by itself once the start-up notices are closed, when the
// local speech recognition is not ready yet, and from the first screen at any time.
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
// "Later" and Escape put it away for this run; downloads already started go on. "Done" and
// "Don't show again" stop it from opening by itself.
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

export const FirstRunSetupController = () => {
    const { t, i18n } = useI18n();
    const setup = useFirstRunSetup();
    const { currentIsBackendReady } = useStore_IsBackendReady();
    const { currentTelemetryNotice } = useOthers();
    const { setSelectedTranscriptionEngine } = useTranscription();
    const realtime = useRealtimeASR();
    const downloads = useModelDownloads();
    const ready = currentIsBackendReady.data === true;
    const { state: recognition, engine, server, paths } = useRecognitionState();

    // Other first-run notices come first; one dialog at a time.
    const othersFirst = currentTelemetryNotice.state === "ok" && currentTelemetryNotice.data?.pending === true;
    const byItself = ready && !setup.settled && !othersFirst && setupOpensByItself(setup.notice, recognition);
    // Once open by itself it stays open until the user closes it, even when the run makes it ready.
    const [shown, setShown] = useState(false);
    useEffect(() => { if (byItself) setShown(true); }, [byItself]);
    // Known not to be needed: it will not open by itself this run, so the next notice may.
    const known = recognition !== "unknown" && setup.notice !== null;
    useEffect(() => {
        if (ready && known && !shown && !setupOpensByItself(setup.notice, recognition)) setup.markSettled();
    }, [ready, known, shown, setup.notice, recognition]);

    const open = setup.opened || shown;
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

    if (!open) return null;
    const running = run?.phase === "running";
    const finished = run?.phase === "done" || (!running && recognition === "ready");
    const needsConsent = planModels(draftPlan).length > 0;
    const finish = (forGood: boolean) => {
        close();
        if (forGood) setup.dismissNotice();
        setShown(false);
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
            <Findings recognition={recognition} onLeave={() => finish(false)} />
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

// What was found. Each row only reads; its button leads to the place where it is set.
// Whether a row needs the user is told by the layout before the words are read (#614): what
// needs the user comes first, each row a card of its own with the warning's amber rule and tint,
// a larger mark and its name in full strength; the rest follow in one quiet frame, smaller and
// muted. The words are the same in both.
const Findings = ({ recognition, onLeave }: { recognition: RecognitionState; onLeave: () => void }) => {
    const { t } = useI18n();
    const mic = useSettingValue("SelectedMicDevice");
    const vrchat = useVrchatPresence();
    const { status: virtualMic, openGuide } = useVirtualMic();
    const { needs } = useSetupNeeds();
    const openTranslatorList = useOpenTranslatorList();
    const micName = mic?.state === "ok" && typeof mic.data === "string" && mic.data && mic.data !== "NoDevice" ? mic.data : null;
    const translation = needs.find(need => need.id === "translation");
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
        { id: "translation", state: translation ? "attention" : "ready", name: t("first_run_setup.found.translation"),
            action: translation && <button type="button" onClick={() => { onLeave(); openTranslatorList(); }}>
                {t("first_run_setup.found.translation_choose")}</button>,
            children: t(translation ? "first_run_setup.found.translation_missing" : "first_run_setup.found.translation_ready") },
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
