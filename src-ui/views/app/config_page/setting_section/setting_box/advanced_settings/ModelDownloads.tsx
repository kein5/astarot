import { useEffect, useId, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { useI18n } from "@useI18n";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useModelDownloads } from "../../../../../../logics/voice/useModelDownloads";
import { modelAdvice } from "../../../../../../logics/voice/modelHardwareAdvice";
import type { ModelAdvice } from "../../../../../../logics/voice/modelHardwareAdvice";
import { hardwareWarning, translationDeviceMode } from "../../../../../../logics/voice/modelHardwareWarning";
import { RESTRICTIONS, canStart, restrictionsOf, startRequest } from "../../../../../../logics/voice/modelRestrictions";
import { catalogFamilies, downloadStatus, firstVariant, familyLabel, variantLabel } from "../../../../../../logics/voice/modelCatalog";
import styles from "./VoiceSettings.module.scss";
import { Fold } from "../_components/fold/Fold";
import { EnvReadout } from "../_components/env_readout/EnvReadout";
import { Hint, useHintDescriptions } from "../_components/hint/Hint";
import { catalogHeading } from "./catalogHeading";
import { CatalogFacts, CatalogLayoutSwitch, CatalogList, CatalogSection, useCatalogLayout } from "./catalogLayout";
import { useConsentDialog } from "../../../../../../logics/common/useConsentDialog";
import { createLanguageNames } from "../../../../../../logics/common/languageNames";
import { EngineCatalog } from "./EngineCatalog";
import { UserModelCards, UserModelRegistration } from "./UserModels";
import { AuditionButton, AuditionNote } from "./VoiceAudition";
import { USER_MODEL_FILES, userModelStatus } from "../../../../../../logics/voice/modelCatalog";
import type { CatalogFamily, DownloadStatus } from "../../../../../../logics/voice/modelCatalog";
import type { ModelCatalogRow, ModelDownloadJob } from "../../../../../../logics/voice/useModelDownloads";
import type { HardwareWarning, TranslationDevice } from "../../../../../../logics/voice/modelHardwareWarning";
import type { Translate } from "../../../../../../logics/voice/voiceErrorText.ts";

// Why the Apply of a ready download waits: the page is busy, or the field it writes was edited.
export type DownloadBlock = false | "busy" | "edited";
// The saved paths each target's Apply replaces, as the page passes them (an RVC model has an index too).
export type ExpectedPaths = Readonly<Partial<Record<string, { readonly model?: string; readonly index?: string }>>>;
// A file under review: its catalog row, the catalog version the user saw and whether it is on disk already.
type SelectedModel = ModelCatalogRow & { catalog_version: string; downloaded: boolean };
// The restrictions the dialog has words for, as names to compare with any kind.
const RESTRICTION_KINDS: readonly string[] = RESTRICTIONS;
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const activePhases = ["queued", "downloading", "verifying", "cancelling"];
// The time of a reading in the display language, not the system's (\4:19:57 AM\ in a Japanese UI).
export const measuredTime = (ms: number, language?: string) => new Date(ms).toLocaleTimeString(language);
const bytes = (value: number, t: Translate) => `${t("model_downloads.exact_bytes", { bytes: Number(value).toLocaleString("en-US") })} (${(value / 1073741824).toFixed(2)} GiB)`;
// The page lists sizes in GiB; the consent dialog keeps the exact byte counts.
const gib = (value: number) => `${(value / 1073741824).toFixed(2)} GiB`;
// A file's size in the facts: one under 0.01 GiB (a voice activity model) in MiB, not "0.00 GiB".
const fileSize = (value: number) => value < 0.01 * 1073741824 ? `${(value / 1048576).toFixed(1)} MiB` : gib(value);

const reserveBytes = (reserve: string) => (reserve === 'vr' ? 2 : .5) * 1024 ** 3;
// The local translation runs on its own device (translationDeviceMode), mostly the CPU: the
// advice on free GPU memory for the speech models says nothing of it.
const NO_ADVICE: ModelAdvice = { recommended: null, reason: "unknown", device: null, multiple: false };

// Language codes as names in the UI language, joined the way that language lists things.
// A long list shows its first few and how many more there are.
const useLanguageList = () => {
    const { t, i18n } = useI18n();
    const language = i18n?.language || "en";
    const names = createLanguageNames(language);
    let list: Intl.ListFormat | null;
    try { list = new Intl.ListFormat(language, { type: "conjunction" }); }
    catch { list = null; }
    return (codes: readonly string[], limit = Infinity) => {
        // A code is its own fallback, so every label is a string.
        const labels = codes.slice(0, limit).map(code => names.fromCode(code, code) ?? code);
        const more = codes.length - labels.length;
        const text = list ? list.format(labels) : labels.join(", ");
        return more > 0 ? t("model_catalog.languages_more", { languages: text, count: more }) : text;
    };
};

// One GPU/memory reading for a page with several TTS engines: the headroom
// choice, the refresh action and the measured device. Each engine's
// ModelDownloads takes the same reserve and reads the same shared hardware.
// reserve: "vr" keeps memory for VR beside the engines, "alone" less.
export interface HardwareReadoutProps {
    reserve: string;
    setReserve: (reserve: string) => void;
}

export const HardwareReadout = ({ reserve, setReserve }: HardwareReadoutProps) => {
    const { t, i18n } = useI18n();
    const { hardware, send, ensureHardware } = useModelDownloads();
    const [, setNow] = useState(Date.now());
    useEffect(() => { ensureHardware(); }, [hardware.phase, ensureHardware]);
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 5000);
        return () => clearInterval(timer);
    }, []);
    // The device line uses the same pick as the per-engine advice (first GPU).
    const reading = modelAdvice([], hardware, { now: Date.now(), reserveBytes: reserveBytes(reserve) });
    const memory = (value: number | null) => isNumber(value) ? gib(value) : t('model_downloads.hardware_unknown');
    return <div className={styles.hardware} aria-label={t('model_downloads.hardware_title')} role="group">
        <h3>{t('model_downloads.hardware_title')}</h3>
        <label>{t('model_downloads.headroom')}<select aria-label={t('model_downloads.headroom')} value={reserve} onChange={event => setReserve(event.target.value)}>
            <option value="vr">{t('model_downloads.headroom_vr')}</option>
            <option value="alone">{t('model_downloads.headroom_alone')}</option>
        </select></label>
        <div className={` ${styles.control_column}`}>
            <button type="button" disabled={hardware.phase === 'probing'} onClick={() => send('/run/refresh_model_download_hardware', {})}>
                {t('model_downloads.hardware_refresh')}</button>
            {hardware.phase === 'probing' && <span aria-busy="true">{t('model_downloads.hardware_probing')}</span>}
        </div>
        {(reading.device || hardware.measured_at_ms) && <EnvReadout live={false}>
            {reading.device && <p>{reading.device.name}: {reading.device.description} · {t('model_downloads.hardware_free')}: {memory(reading.device.memory_free)} / {t('model_downloads.hardware_total')}: {memory(reading.device.memory_total)}</p>}
            {hardware.measured_at_ms && <p>{t('model_downloads.hardware_measured')}: {measuredTime(hardware.measured_at_ms, i18n?.language)}</p>}
            {reading.multiple && <p>{t('model_downloads.multiple_gpus')}</p>}
        </EnvReadout>}
        <Fold size="link" className={styles.more} summary={t('model_downloads.memory_boundary_summary')}>
            <p>{t('model_downloads.memory_boundary')}</p>
        </Fold>
    </div>;
};

// What a user compares before choosing (the catalog row's `profile`, docs/voice-stack/model-downloads.md):
// languages, download size, hardware and whom it is suggested for. Rows outside speech.cpp
// (RVC) have no profile and show their size and terms only.
// guidance: the measured memory and where it was checked, as the hardware term's hint (#614).
// part: the whole table, or a grid card's two parts of it: "key", the size and the hardware (and a
// translation model's memory), on the card; "rest", the languages and the terms, in its fold.
type FactsPart = "all" | "key" | "rest";
const ModelFacts = ({ entry, guidance, part = "all", className }: { entry: ModelCatalogRow; guidance?: readonly string[]; part?: FactsPart; className?: string }) => {
    const { t } = useI18n();
    const languages = useLanguageList();
    const profile = entry.profile;
    const supported = profile?.languages ?? entry.speech?.languages ?? [];
    const hardware = profile && [
        profile.tier && t(`model_catalog.tier.${profile.tier}`),
        isNumber(profile.memory_bytes) && t("model_catalog.memory", { memory: gib(profile.memory_bytes), device: profile.memory_measured_on }),
        t(`model_catalog.cpu.${profile.cpu}`, { defaultValue: "" }),
        t(`model_catalog.gpu.${profile.gpu}`, { defaultValue: "" }),
    ].filter(Boolean).join(" · ");
    // A translation model says the memory it needs while translating (guidance.rs), or that it
    // has not been measured: never a figure made up for it.
    const referenceMemory = entry.guidance?.reference_memory_bytes;
    const translationMemory = entry.target === "translation" && (isNumber(referenceMemory)
        ? t("model_catalog.translation_memory", { memory: gib(referenceMemory) })
        : t("model_catalog.translation_memory_unknown"));
    const key = part !== "rest", rest = part !== "key";
    return <dl className={className ? `${styles.facts} ${className}` : styles.facts}>
        {rest && supported.length > 0 && <div><dt>{t("model_catalog.languages")}</dt><dd>{languages(supported, 12)}</dd></div>}
        {key && <div><dt>{t("model_catalog.size")}</dt><dd>{fileSize(entry.total_bytes)}</dd></div>}
        {key && hardware && <div><dt>{guidance?.length ? <span className={styles.hinted} data-hint-host><span>{t("model_catalog.hardware")}</span>
            <Hint text={guidance.join("\n")} focusable /></span> : t("model_catalog.hardware")}</dt><dd>{hardware}</dd></div>}
        {key && translationMemory && <div><dt>{t("model_catalog.memory_needed")}</dt><dd>{translationMemory}</dd></div>}
        {rest && <div><dt>{t("model_catalog.terms")}</dt><dd>{entry.provider} · {entry.license}</dd></div>}
    </dl>;
};

// A short word on the card's head for the state of the shown file; the readout below says more.
// It ends the name's line, in the same place on every card.
const StatusBadge = ({ status }: { status: DownloadStatus }) => {
    const { t } = useI18n();
    return <span className={`${styles.badge} ${styles.status}`} data-tone={status}>{t(`model_catalog.status.${status}`)}</span>;
};


// A model that looks too heavy for the user's PC (modelHardwareWarning.ts): a mark on the card's
// head, and a plain note that says why. Only guidance: nothing here stops the choice or download.
const WarningBadge = () => {
    const { t } = useI18n();
    return <span className={styles.badge} data-tone="hardware_warning">
        <span className={styles.warning_mark} aria-hidden="true" />{t("model_catalog.hardware_warning.badge")}</span>;
};
const WarningNote = ({ warning }: { warning: HardwareWarning }) => {
    const { t } = useI18n();
    const key = warning.reason === "low_memory" ? `low_memory_${warning.device?.kind === "cpu" ? "cpu" : "gpu"}` : warning.reason;
    // The note's own pattern joins the sentences: with spaces in English, without in Japanese.
    return <p className={styles.hardware_warning}>
        <span className={styles.warning_mark} aria-hidden="true" />
        <span>{t("model_catalog.hardware_warning.note", {
            reason: t(`model_catalog.hardware_warning.${key}`, { required: gib(warning.required ?? 0),
                available: gib(warning.available ?? 0), reserve: gib(warning.reserve ?? 0) }) })}</span>
    </p>;
};

// What a model's license restricts (modelRestrictions.ts), said before the consent: marked
// like a warning, and naming the license. The checkbox under the consent acknowledges it.
const RestrictionNote = ({ kind, license, id }: { kind: string; license: string; id: string }) => {
    const { t } = useI18n();
    const key = RESTRICTION_KINDS.includes(kind) ? kind : "other";
    // The title on its own line, so the two sentences need no joining rule per language; the
    // space between them is kept for the text a screen reader reads.
    return <p id={id} className={styles.restriction}>
        <span className={styles.warning_mark} aria-hidden="true" />
        <span className={styles.restriction_text}>
            <strong>{t(`model_downloads.restriction.${key}.title`)}</strong>{" "}
            <span>{t(`model_downloads.restriction.${key}.note`, { license })}</span>
        </span>
    </p>;
};

// Every downloadable model of one use (a target), one card per model with its file types.
// The download, verification and apply steps are the same as before; only the choice is laid out
// as a catalog. Nothing here starts a download or changes a setting by itself.
// only: the catalog ids to show, when the caller asks about one model (a translation weight's row).
// reserve: the headroom a page with a shared HardwareReadout chose; without it the catalog asks itself.
// engines: also list the speech engines a user installs (the Japanese TTS catalog).
// translationDevice: the saved device of the local translation, which the translation models'
// warnings compare with (deviceMode is the speech engine's).
export interface ModelDownloadsProps {
    targets: readonly string[];
    expected?: ExpectedPaths;
    blocked?: DownloadBlock;
    deviceMode?: string;
    reserve?: string;
    engines?: boolean;
    only?: readonly string[];
    translationDevice?: TranslationDevice;
}

export const ModelDownloads = ({ targets, expected, blocked = false, deviceMode = 'auto', reserve: sharedReserve, engines = false, only, translationDevice }: ModelDownloadsProps) => {
    const { t, i18n } = useI18n();
    const hints = useHintDescriptions();
    const languages = useLanguageList();
    const { catalog, state, hardware, error, pending, send, ensureHardware, userModels } = useModelDownloads();
    const [selected, setSelected] = useState<SelectedModel | null>(null), [consent, setConsent] = useState(false);
    // The restrictions of the selected model the user ticked, apart from the consent.
    const [acknowledged, setAcknowledged] = useState<string[]>([]);
    const restrictionId = useId();
    const [linkError, setLinkError] = useState<string | null>(null);
    const [choices, setChoices] = useState<Readonly<Record<string, string>>>({}), [ownReserve, setReserve] = useState('vr');
    const shared = sharedReserve !== undefined, reserve = shared ? sharedReserve : ownReserve;
    const [, setNow] = useState(Date.now());
    const ttsTargets = targets.filter(target => ['japanese', 'multilingual'].includes(target));
    const hasTTS = ttsTargets.length > 0;
    const section = useRef<HTMLElement>(null);
    const { dialog, close: closeDialog } = useConsentDialog(!!selected, section);
    useEffect(() => {
        send("/get/data/model_download_catalog"); send("/get/data/model_download_state"); send("/get/data/user_models");
    }, [send]);
    // Every catalog reads the probe: the per-model warnings need it, not only the TTS advice.
    useEffect(() => { ensureHardware(); }, [hardware.phase, ensureHardware]);
    useEffect(() => {
        if (!hasTTS) return;
        const timer = setInterval(() => setNow(Date.now()), 5000);
        return () => clearInterval(timer);
    }, [hasTTS]);
    const busy = !!pending || Object.values(state.jobs).some(job => activePhases.includes(job.phase));
    const close = () => { closeDialog(); setSelected(null); setConsent(false); setAcknowledged([]); setLinkError(null); };
    const openLink = async (event: MouseEvent<HTMLAnchorElement>, url: string) => {
        if (!isTauri()) return;
        event.preventDefault();
        try { await openUrl(url); setLinkError(null); }
        catch { setLinkError(url); }
    };
    // A file in the model's repository is named by its file name (GEMMA_TERMS_OF_USE.md,
    // LICENSE-MIT…), so several terms of one model can be told apart.
    const linkLabel = (model: SelectedModel, url: string, i: number) => i === 0 ? t("model_downloads.model_card")
        : url.startsWith("https://huggingface.co/") ? url.split("/").pop() : `${model.license} (${i})`;
    const request = (endpoint: string, entry: ModelCatalogRow, job: ModelDownloadJob) => send(endpoint, { id: entry.id, job_id: job.job_id });
    const failure = (code: string) => t(`model_downloads.errors.${code}`, { defaultValue: t("model_downloads.errors.download_failed") });
    const matching = catalog?.models.filter(entry => targets.includes(entry.target) && (!only || only.includes(entry.id))) ?? [];
    const advice = Object.fromEntries(targets.map(target => [target, target === "translation" ? NO_ADVICE
        : modelAdvice(matching.filter(entry => entry.target === target), hardware, { now: Date.now(), deviceMode, reserveBytes: reserveBytes(reserve) })]));
    const memory = (value: number | null) => isNumber(value) ? `${(value / 1024 ** 3).toFixed(2)} GiB` : t('model_downloads.hardware_unknown');
    const status = (entry: ModelCatalogRow) => downloadStatus(entry, state.jobs[entry.id], state.downloaded, expected?.[entry.target]);
    const translationMode = translationDeviceMode(translationDevice, hardware);
    const warningOf = (entry: ModelCatalogRow) => entry.target !== "translation" ? hardwareWarning(entry, hardware, { deviceMode })
        : translationMode === null ? null : hardwareWarning(entry, hardware, { deviceMode: translationMode });
    const selectedWarning = selected && warningOf(selected);
    const selectedRestrictions = restrictionsOf(selected);
    // The consent and every restriction ticked: only then may the review start.
    const agreed = !!selected && canStart(selected, consent, acknowledged);
    // The cards' layout: chosen on the heading's line, except for one model asked about (the
    // translation review), which stays a list.
    const chosenLayout = useCatalogLayout();
    const layout = only ? "list" : chosenLayout;
    const acknowledge = (kind: string, checked: boolean) => setAcknowledged(previous => checked ? [...previous.filter(k => k !== kind), kind] : previous.filter(k => k !== kind));

    // One card: the chosen file of a model, its facts and its download. `version` is the catalog's.
    const card = (target: string, family: CatalogFamily<ModelCatalogRow>, version: string) => {
        const hint = advice[target];
        const current = family.rows.find(entry => entry.id === choices[family.key])
            ?? firstVariant(family.rows, hint.recommended, entry => status(entry) === "in_use");
        const job = state.jobs[current.id], active = activePhases.includes(job?.phase);
        const shownStatus = status(current);
        const downloaded = ["downloaded", "in_use"].includes(shownStatus);
        // A download of another file of this model keeps its progress and actions in view.
        const others = family.rows.filter(entry => entry.id !== current.id &&
            (activePhases.includes(state.jobs[entry.id]?.phase) || state.jobs[entry.id]?.phase === "ready"));
        const suggested = family.rows.flatMap(entry => entry.profile?.recommended_for ?? []);
        const label = familyLabel(current);
        const warning = warningOf(current);
        const fits = !!hint.recommended && family.rows.some(entry => entry.id === hint.recommended);
        const jobView = (entry: ModelCatalogRow, own: boolean) => {
            const job = state.jobs[entry.id], active = activePhases.includes(job?.phase);
            if (!job) return null;
            const savedPaths = expected?.[entry.target];
            return <div key={entry.id} className={styles.download_entry}>
                <EnvReadout tone={job.phase === "ready" ? "active" : job.phase === "failed" ? "failed" : "neutral"}
                    progress={active && job.phase !== "cancelling" ? "working" : ["ready", "applied"].includes(job.phase) ? "done" : undefined}>
                    <p>{!own && `${entry.name}: `}{t(`model_downloads.phase_${job.phase}`)}{active && ` · ${gib(job.received_bytes)} / ${gib(job.total_bytes)}`}</p>
                </EnvReadout>
                {/* The bar spans the card under its readout; the actions share one row below. */}
                {active && <progress className={styles.progress} aria-label={t("model_downloads.progress")} value={job.received_bytes} max={job.total_bytes} />}
                {job.error_code && <p role="alert">{failure(job.error_code)}</p>}
                {job.phase === "ready" && <p>{t("model_downloads.apply_hint")}</p>}
                {(active || job.phase === "ready") && <div className={styles.actions}>
                    {active && <button type="button" disabled={job.phase === "cancelling" || !!pending?.some(request =>
                        request.endpoint !== "/run/apply_model_download" || request.id !== entry.id || request.job_id !== job.job_id)}
                        onClick={() => request("/run/cancel_model_download", entry, job)}>{t("model_downloads.cancel")}</button>}
                    {job.phase === "ready" && <button type="button" className="primary" disabled={busy || !!blocked || !savedPaths}
                        onClick={() => send("/run/apply_model_download", { id: entry.id, job_id: job.job_id, expected: savedPaths })}>{t("model_downloads.apply")}</button>}
                </div>}
                {job.phase === "ready" && blocked && <p>{t(blocked === "edited" ? "model_downloads.blocked_edited" : "model_downloads.blocked")}</p>}
            </div>;
        };
        // The measured memory and where it was checked (guidance.rs): the hardware term's hint on a
        // reviewed page (#614), a fold at the card's foot elsewhere.
        const guidance = current.guidance?.reference_memory_bytes ? [
            // A tier's own wording where the speech models' (a GPU, a provider's figure) does not fit.
            `${t(`model_downloads.tier_${current.guidance.tier}`)} · ${t([`model_downloads.memory_reference_${current.guidance.tier}`, 'model_downloads.memory_reference'])}: ${memory(current.guidance.reference_memory_bytes)}`,
            `${t([`model_downloads.validation_${current.guidance.validation.state}_${current.guidance.tier}`, `model_downloads.validation_${current.guidance.validation.state}`])} ${current.guidance.validation.device ?? ''}`,
            current.guidance.validation.scope && t(`model_downloads.scope_${current.guidance.validation.scope}`),
            hint.device && hint.device.description !== current.guidance.validation.device && t('model_downloads.gpu_unverified'),
        ].filter((line): line is string => typeof line === "string") : null;
        // The hint needs the hardware row, which a row with a profile has.
        const guidanceHint = hints && !!guidance && !!current.profile;
        const grid = layout === "grid";
        // Whom the model is suggested for: the languages in the list; in the grid, one language or
        // how many, so the badge stays one short word.
        const forLanguages = [...new Set(suggested)];
        const recommended = !grid || forLanguages.length === 1
            ? t("model_catalog.recommended_for", { languages: languages(suggested, 3) })
            : t("model_catalog.recommended_for_count", { count: forLanguages.length });
        // The file shown and the choice of the others.
        const file = <>
            {family.rows.length > 1 && <label className={styles.variant_choice}>{t("model_catalog.variant")}
                <select aria-label={t("model_catalog.variant_of", { model: label })} value={current.id}
                    onChange={event => setChoices(previous => ({ ...previous, [family.key]: event.target.value }))}>
                    {family.rows.map(entry => <option key={entry.id} value={entry.id}>
                        {[variantLabel(entry), gib(entry.total_bytes), entry.speech?.default && t("model_downloads.asr_type_default"),
                            ["downloaded", "in_use"].includes(status(entry)) && t(`model_catalog.status.${status(entry)}`),
                            warningOf(entry) && t("model_catalog.hardware_warning.option")].filter(Boolean).join(" · ")}
                    </option>)}
                </select></label>}
            {/* One file: its type as the first fact, in the terms' column and the values'. */}
            {family.rows.length === 1 && variantLabel(current) !== current.name &&
                <p className={styles.variant}><span>{t("model_catalog.variant")}</span><span>{variantLabel(current)}</span></p>}
        </>;
        const factsGuidance = guidanceHint ? guidance : undefined;
        // Only after the user picks another file; the file in use shown first is not a choice.
        const manualChoice = choices[family.key] && hint.recommended && family.rows.some(entry => entry.id === hint.recommended) && current.id !== hint.recommended &&
            <p>{t('model_downloads.manual_choice')}</p>;
        const prepareHint = downloaded && !job && shownStatus !== "in_use" && <p>{t("model_catalog.prepare_hint")}</p>;
        const guidanceFold = guidance && !guidanceHint && <Fold size="link" className={styles.more} summary={t('model_downloads.guidance_summary')}>
            {guidance.map(line => <p key={line}>{line}</p>)}
        </Fold>;
        // What runs comes first, with its own actions; the card's actions follow, as before.
        const run = <>
            {jobView(current, true)}
            {others.map(entry => jobView(entry, false))}
            <div className={styles.actions}>
                <button type="button" disabled={busy} onClick={() => {
                    setConsent(false);
                    setAcknowledged([]);
                    setSelected({ ...current, catalog_version: version, downloaded });
                }}>{t(downloaded ? "model_catalog.prepare" : "model_downloads.review")}</button>
                {/* The TTS models: a short sentence on the monitor output only (#415). */}
                <AuditionButton target={target} status={shownStatus} />
            </div>
        </>;
        // The card's parts in the order they are read (#614): what it is, its state and a warning,
        // the file and its facts, then what runs and what can be done. In the grid a card keeps
        // what it is, its size and hardware, and what can be done; the file's choice, the
        // languages, the terms and the notes are in its fold.
        return <li key={family.key} data-model-download tabIndex={-1} role="group" aria-label={label} className={styles.card} data-status={shownStatus}>
            <div className={styles.card_intro}>
                {/* The name and the state on one line, so every card's state is at the same place;
                    what speaks for or against the model under it. */}
                <div className={styles.card_head}>
                    <strong>{label}</strong>
                    <StatusBadge status={shownStatus} />
                </div>
                {(suggested.length > 0 || fits || warning) && <div className={styles.card_badges}>
                    {suggested.length > 0 && <span className={styles.badge} data-tone="recommended">{recommended}</span>}
                    {fits && <span className={styles.badge} data-tone="recommended">{t("model_catalog.fits_memory")}</span>}
                    {warning && <WarningBadge />}
                </div>}
                {current.profile?.summary && <p>{t(`model_downloads.summary.${current.profile.summary}`)}</p>}
                {!grid && warning && <WarningNote warning={warning} />}
            </div>
            {grid && <ModelFacts entry={current} guidance={factsGuidance} part="key" className={styles.card_key} />}
            {grid
                ? <CatalogFacts layout="grid" summary={variantLabel(current) !== current.name
                    ? t("model_catalog.layout.facts_of", { file: variantLabel(current) }) : undefined}>
                    {warning && <WarningNote warning={warning} />}
                    {file}<ModelFacts entry={current} part="rest" />{manualChoice}{prepareHint}
                    <AuditionNote target={target} status={shownStatus} />
                    {guidanceFold}
                </CatalogFacts>
                : <div className={styles.card_spec}>{file}<ModelFacts entry={current} guidance={factsGuidance} />{manualChoice}</div>}
            <div className={styles.card_foot}>
                {run}
                {!grid && prepareHint}
                {!grid && <AuditionNote target={target} status={shownStatus} />}
                {!grid && guidanceFold}
            </div>
        </li>;
    };

    return <section ref={section} tabIndex={-1} className={styles.container} aria-label={t("model_downloads.title")}>
        {catalogHeading(hints, "h3", t("model_downloads.title"), [t("model_downloads.help")], undefined, !only && <CatalogLayoutSwitch />)}
        {!catalog && <p aria-busy="true">{t("model_downloads.loading")}</p>}
        {hasTTS && !shared && <>
            <label>{t('model_downloads.headroom')}<select aria-label={t('model_downloads.headroom')} value={reserve} onChange={event => setReserve(event.target.value)}>
                <option value="vr">{t('model_downloads.headroom_vr')}</option>
                <option value="alone">{t('model_downloads.headroom_alone')}</option>
            </select></label>
            <div className={` ${styles.control_column}`}>
                <button type="button" disabled={hardware.phase === 'probing'} onClick={() => send('/run/refresh_model_download_hardware', {})}>
                    {t('model_downloads.hardware_refresh')}</button>
                {hardware.phase === 'probing' && <span aria-busy="true">{t('model_downloads.hardware_probing')}</span>}
            </div>
        </>}
        {catalog && targets.map(target => {
            const families = catalogFamilies(matching.filter(entry => entry.target === target));
            const own = !!USER_MODEL_FILES[target];
            if (!families.length && !own) return null;
            const hint = advice[target], tts = ttsTargets.includes(target);
            const heading = `model-catalog-${target}`;
            // The part's bar reads out how many models it has and how many are on the PC (a
            // registered model's files are, unless they went missing).
            const ownRows = own ? userModels?.models?.filter(model => model.target === target) ?? [] : [];
            const obtained = families.filter(family => family.rows.some(entry => ["downloaded", "in_use", "ready"].includes(status(entry)))).length
                + ownRows.filter(model => userModelStatus(model, expected?.[target]) !== "missing").length;
            // What the use is for and how to choose in it; on a reviewed page, the heading's hint.
            const help = [t(`model_catalog.group_help.${target}`),
                tts && families.length > 1 && t(`model_downloads.choice_${target}`),
                target === "asr" && t("model_downloads.asr_choice"),
                ["rvc", "asr", "vad", "diarization"].includes(target) && t(`model_downloads.${target}_requirements`)]
                .filter((text): text is string => typeof text === "string");
            // A part of its own, folded; the translation review's one model is not.
            return <CatalogSection key={target} id={heading} level={4} fold={!only} title={t(`model_catalog.group.${target}`)} help={help}
                readout={t("model_catalog.group_readout", { count: families.length + ownRows.length, obtained })}>
                {/* What the GPU reading says for this use: a readout of this session, so it stays on screen. */}
                {tts && <div className={styles.catalog_advice}>
                    {!shared && hint.device && <p>{hint.device.name}: {hint.device.description} · {t('model_downloads.hardware_free')}: {memory(hint.device.memory_free)} / {t('model_downloads.hardware_total')}: {memory(hint.device.memory_total)}</p>}
                    {!shared && hardware.measured_at_ms && <p>{t('model_downloads.hardware_measured')}: {measuredTime(hardware.measured_at_ms, i18n?.language)}</p>}
                    <p>{t(`model_downloads.advice_${hint.reason}`)}</p>
                    {!shared && hint.multiple && <p>{t('model_downloads.multiple_gpus')}</p>}
                    {hint.recommended && <p><strong>{t('model_downloads.recommended')}</strong>: {matching.find(entry => entry.id === hint.recommended)?.name}</p>}
                </div>}
                {/* The models of one's own sit in the same list, after the reviewed ones (#403). */}
                <CatalogList layout={layout}>
                    {families.map(family => card(target, family, catalog.catalog_version))}
                    {own && <UserModelCards target={target} expected={expected} blocked={blocked} busy={busy} layout={layout} />}
                </CatalogList>
                {own && <UserModelRegistration target={target} busy={busy} />}
            </CatalogSection>;
        })}
        {hasTTS && !shared && <Fold size="link" className={styles.more} summary={t('model_downloads.memory_boundary_summary')}>
            <p>{t('model_downloads.memory_boundary')}</p>
        </Fold>}
        {engines && targets.includes("japanese") && <EngineCatalog layout={layout} />}
        {selected && <dialog ref={dialog} aria-label={t("model_downloads.warning_title")} onCancel={event => { event.preventDefault(); close(); }}>
            <div className={styles.dialog_text}>
                <h3>{t("model_downloads.warning_title")}</h3>
                <p>{selected.name} · {selected.provider}</p>
                <p>{bytes(selected.total_bytes, t)} · {selected.license}</p>
                {selectedRestrictions.map(kind => <RestrictionNote key={kind} kind={kind} license={selected.license} id={`${restrictionId}-${kind}`} />)}
                {selected.downloaded && <p>{t("model_catalog.prepare_notice")}</p>}
                {selectedWarning && <WarningNote warning={selectedWarning} />}
                <p>{t(`model_downloads.notice_${selected.notice}`)}</p>
                {selected.target === "rvc" && <p>{t("model_downloads.rvc_requirements")}</p>}
                {selected.target === "asr" && <p>{t("model_downloads.asr_requirements")}</p>}
                {selected.target === "vad" && <p>{t("model_downloads.vad_requirements")}</p>}
                {selected.target === "diarization" && <p>{t("model_downloads.diarization_requirements")}</p>}
                {!selected.downloaded && <p>{t("model_downloads.connection_notice")}</p>}
                <p>{t("model_downloads.no_start")}</p>
                <p>{t("model_downloads.source")}: <a href={selected.source} onClick={event => openLink(event, selected.source)} target="_blank" rel="noreferrer">{selected.repo}</a></p>
                <p>{t("model_downloads.license_links")}: {selected.licenses.map((url, i) => <span key={url}> <a href={url} onClick={event => openLink(event, url)} target="_blank" rel="noreferrer">{linkLabel(selected, url, i)}</a> </span>)}</p>
                {linkError && <div role="alert"><p>{t("model_downloads.link_error")}</p><code style={{ overflowWrap: "anywhere" }}>{linkError}</code></div>}
                <p>{t("model_downloads.destination")}: <code style={{ overflowWrap: "anywhere" }}>{selected.destination}</code></p>
                <ul>{selected.artifacts.map(file => <li key={file.filename}>{file.filename} · {bytes(file.size, t)}</li>)}</ul>
            </div>
            <label className={styles.checkLabel}><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />{t("model_downloads.consent")}</label>
            {/* One more checkbox per restriction, each ticked on its own (#411). */}
            {selectedRestrictions.filter(kind => RESTRICTION_KINDS.includes(kind)).map(kind => <label key={kind} className={styles.checkLabel}>
                <input type="checkbox" checked={acknowledged.includes(kind)} aria-describedby={`${restrictionId}-${kind}`}
                    onChange={event => acknowledge(kind, event.target.checked)} />
                {t(`model_downloads.restriction.${kind}.acknowledge`, { license: selected.license })}</label>)}
            <div className={styles.actions}>
                <button type="button" autoFocus onClick={close}>{t("model_downloads.back")}</button>
                <button type="button" className="primary" disabled={!agreed || busy} onClick={() => {
                    if (!agreed || busy) return;
                    send("/run/start_model_download", startRequest(selected, acknowledged)); close();
                }}>{t(selected.downloaded ? "model_catalog.prepare_start" : "model_downloads.start")}</button>
            </div>
        </dialog>}
        {error && <p role="alert">{t([`user_models.errors.${error}`, `model_downloads.errors.${error}`, "model_downloads.errors.download_failed"])}</p>}
        {!catalog && <button type="button" onClick={() => send("/get/data/model_download_catalog")}>{t("voice.retry")}</button>}
    </section>;
};
