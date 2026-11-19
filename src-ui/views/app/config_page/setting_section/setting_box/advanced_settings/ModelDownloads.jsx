import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "@useI18n";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useModelDownloads } from "../../../../../../logics/voice/useModelDownloads";
import { modelAdvice } from "../../../../../../logics/voice/modelHardwareAdvice";
import { hardwareWarning, translationDeviceMode } from "../../../../../../logics/voice/modelHardwareWarning";
import { RESTRICTIONS, canStart, restrictionsOf, startRequest } from "../../../../../../logics/voice/modelRestrictions";
import { catalogFamilies, downloadStatus, firstVariant, familyLabel, variantLabel } from "../../../../../../logics/voice/modelCatalog";
import styles from "./VoiceSettings.module.scss";
import { EnvReadout } from "../_components/env_readout/EnvReadout";
import { useConsentDialog } from "../../../../../../logics/common/useConsentDialog";
import { createLanguageNames } from "../../../../../../logics/common/languageNames";
import { EngineCatalog } from "./EngineCatalog";
import { UserModelCards, UserModelRegistration } from "./UserModels";
import { AuditionButton, AuditionNote } from "./VoiceAudition";
import { USER_MODEL_FILES } from "../../../../../../logics/voice/modelCatalog";

const activePhases = ["queued", "downloading", "verifying", "cancelling"];
// The time of a reading in the display language, not the system's (\4:19:57 AM\ in a Japanese UI).
export const measuredTime = (ms, language) => new Date(ms).toLocaleTimeString(language);
const bytes = (value, t) => `${t("model_downloads.exact_bytes", { bytes: Number(value).toLocaleString("en-US") })} (${(value / 1073741824).toFixed(2)} GiB)`;
// The page lists sizes in GiB; the consent dialog keeps the exact byte counts.
const gib = value => `${(value / 1073741824).toFixed(2)} GiB`;

const reserveBytes = reserve => (reserve === 'vr' ? 2 : .5) * 1024 ** 3;
// The local translation runs on its own device (translationDeviceMode), mostly the CPU: the
// advice on free GPU memory for the speech models says nothing of it.
const NO_ADVICE = { recommended: null, reason: "unknown", device: null, multiple: false };

// Language codes as names in the UI language, joined the way that language lists things.
// A long list shows its first few and how many more there are.
const useLanguageList = () => {
    const { t, i18n } = useI18n();
    const language = i18n?.language || "en";
    const names = createLanguageNames(language);
    let list;
    try { list = new Intl.ListFormat(language, { type: "conjunction" }); }
    catch { list = null; }
    return (codes, limit = Infinity) => {
        const labels = codes.slice(0, limit).map(code => names.fromCode(code, code));
        const more = codes.length - labels.length;
        const text = list ? list.format(labels) : labels.join(", ");
        return more > 0 ? t("model_catalog.languages_more", { languages: text, count: more }) : text;
    };
};

// One GPU/memory reading for a page with several TTS engines: the headroom
// choice, the refresh action and the measured device. Each engine's
// ModelDownloads takes the same reserve and reads the same shared hardware.
export const HardwareReadout = ({ reserve, setReserve }) => {
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
    const memory = value => Number.isFinite(value) ? gib(value) : t('model_downloads.hardware_unknown');
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
        <details className={styles.more}><summary>{t('model_downloads.memory_boundary_summary')}</summary>
            <p>{t('model_downloads.memory_boundary')}</p>
        </details>
    </div>;
};

// What a user compares before choosing (the catalog row's `profile`, docs/voice-stack/model-downloads.md):
// languages, download size, hardware and whom it is suggested for. Rows outside speech.cpp
// (RVC) have no profile and show their size and terms only.
const ModelFacts = ({ entry }) => {
    const { t } = useI18n();
    const languages = useLanguageList();
    const profile = entry.profile;
    const supported = profile?.languages ?? entry.speech?.languages ?? [];
    const hardware = profile && [
        profile.tier && t(`model_catalog.tier.${profile.tier}`),
        Number.isFinite(profile.memory_bytes) && t("model_catalog.memory", { memory: gib(profile.memory_bytes), device: profile.memory_measured_on }),
        t(`model_catalog.cpu.${profile.cpu}`, { defaultValue: "" }),
        t(`model_catalog.gpu.${profile.gpu}`, { defaultValue: "" }),
    ].filter(Boolean).join(" · ");
    // A translation model says the memory it needs while translating (guidance.rs), or that it
    // has not been measured: never a figure made up for it.
    const translationMemory = entry.target === "translation" && (Number.isFinite(entry.guidance?.reference_memory_bytes)
        ? t("model_catalog.translation_memory", { memory: gib(entry.guidance.reference_memory_bytes) })
        : t("model_catalog.translation_memory_unknown"));
    return <dl className={styles.facts}>
        {supported.length > 0 && <div><dt>{t("model_catalog.languages")}</dt><dd>{languages(supported, 12)}</dd></div>}
        <div><dt>{t("model_catalog.size")}</dt><dd>{gib(entry.total_bytes)}</dd></div>
        {hardware && <div><dt>{t("model_catalog.hardware")}</dt><dd>{hardware}</dd></div>}
        {translationMemory && <div><dt>{t("model_catalog.memory_needed")}</dt><dd>{translationMemory}</dd></div>}
        <div><dt>{t("model_catalog.terms")}</dt><dd>{entry.provider} · {entry.license}</dd></div>
    </dl>;
};

// A short word on the card's head for the state of the shown file; the readout below says more.
const StatusBadge = ({ status }) => {
    const { t } = useI18n();
    return <span className={styles.badge} data-tone={status}>{t(`model_catalog.status.${status}`)}</span>;
};

// A model that looks too heavy for the user's PC (modelHardwareWarning.ts): a mark on the card's
// head, and a plain note that says why. Only guidance: nothing here stops the choice or download.
const WarningBadge = () => {
    const { t } = useI18n();
    return <span className={styles.badge} data-tone="hardware_warning">
        <span className={styles.warning_mark} aria-hidden="true" />{t("model_catalog.hardware_warning.badge")}</span>;
};
const WarningNote = ({ warning }) => {
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
const RestrictionNote = ({ kind, license, id }) => {
    const { t } = useI18n();
    const key = RESTRICTIONS.includes(kind) ? kind : "other";
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
// translationDevice: the saved device of the local translation, which the translation models'
// warnings compare with (deviceMode is the speech engine's).
export const ModelDownloads = ({ targets, expected, blocked = false, deviceMode = 'auto', reserve: sharedReserve, engines = false, only, translationDevice }) => {
    const { t, i18n } = useI18n();
    const languages = useLanguageList();
    const { catalog, state, hardware, error, pending, send, ensureHardware } = useModelDownloads();
    const [selected, setSelected] = useState(null), [consent, setConsent] = useState(false);
    // The restrictions of the selected model the user ticked, apart from the consent.
    const [acknowledged, setAcknowledged] = useState([]);
    const restrictionId = useId();
    const [linkError, setLinkError] = useState(null);
    const [choices, setChoices] = useState({}), [ownReserve, setReserve] = useState('vr');
    const shared = sharedReserve !== undefined, reserve = shared ? sharedReserve : ownReserve;
    const [, setNow] = useState(Date.now());
    const ttsTargets = targets.filter(target => ['japanese', 'multilingual'].includes(target));
    const hasTTS = ttsTargets.length > 0;
    const section = useRef(null);
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
    const openLink = async (event, url) => {
        if (!isTauri()) return;
        event.preventDefault();
        try { await openUrl(url); setLinkError(null); }
        catch { setLinkError(url); }
    };
    // A file in the model's repository is named by its file name (GEMMA_TERMS_OF_USE.md,
    // LICENSE-MIT…), so several terms of one model can be told apart.
    const linkLabel = (url, i) => i === 0 ? t("model_downloads.model_card")
        : url.startsWith("https://huggingface.co/") ? url.split("/").pop() : `${selected.license} (${i})`;
    const request = (endpoint, entry, job) => send(endpoint, { id: entry.id, job_id: job.job_id });
    const failure = code => t(`model_downloads.errors.${code}`, { defaultValue: t("model_downloads.errors.download_failed") });
    const matching = catalog?.models.filter(entry => targets.includes(entry.target) && (!only || only.includes(entry.id))) ?? [];
    const advice = Object.fromEntries(targets.map(target => [target, target === "translation" ? NO_ADVICE
        : modelAdvice(matching.filter(entry => entry.target === target), hardware, { now: Date.now(), deviceMode, reserveBytes: reserveBytes(reserve) })]));
    const memory = value => Number.isFinite(value) ? `${(value / 1024 ** 3).toFixed(2)} GiB` : t('model_downloads.hardware_unknown');
    const status = entry => downloadStatus(entry, state.jobs[entry.id], state.downloaded, expected?.[entry.target]);
    const translationMode = translationDeviceMode(translationDevice, hardware);
    const warningOf = entry => entry.target !== "translation" ? hardwareWarning(entry, hardware, { deviceMode })
        : translationMode === null ? null : hardwareWarning(entry, hardware, { deviceMode: translationMode });
    const selectedWarning = selected && warningOf(selected);
    const selectedRestrictions = restrictionsOf(selected);
    // The consent and every restriction ticked: only then may the review start.
    const agreed = !!selected && canStart(selected, consent, acknowledged);
    const acknowledge = (kind, checked) => setAcknowledged(previous => checked ? [...previous.filter(k => k !== kind), kind] : previous.filter(k => k !== kind));

    // One card: the chosen file of a model, its facts and its download.
    const card = (target, family) => {
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
        const jobView = (entry, own) => {
            const job = state.jobs[entry.id], active = activePhases.includes(job?.phase);
            if (!job) return null;
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
                    {job.phase === "ready" && <button type="button" className="primary" disabled={busy || blocked || !expected?.[entry.target]}
                        onClick={() => send("/run/apply_model_download", { id: entry.id, job_id: job.job_id, expected: expected[entry.target] })}>{t("model_downloads.apply")}</button>}
                </div>}
                {job.phase === "ready" && blocked && <p>{t(blocked === "edited" ? "model_downloads.blocked_edited" : "model_downloads.blocked")}</p>}
            </div>;
        };
        return <li key={family.key} data-model-download tabIndex={-1} role="group" aria-label={label} className={styles.card}>
            <div className={styles.card_head}>
                <strong>{label}</strong>
                {suggested.length > 0 && <span className={styles.badge} data-tone="recommended">{t("model_catalog.recommended_for", { languages: languages(suggested, 3) })}</span>}
                {hint.recommended && family.rows.some(entry => entry.id === hint.recommended) &&
                    <span className={styles.badge} data-tone="recommended">{t("model_catalog.fits_memory")}</span>}
                {warning && <WarningBadge />}
                <StatusBadge status={shownStatus} />
            </div>
            {current.profile?.summary && <p>{t(`model_downloads.summary.${current.profile.summary}`)}</p>}
            {warning && <WarningNote warning={warning} />}
            {family.rows.length > 1 && <label>{t("model_catalog.variant")}
                <select aria-label={t("model_catalog.variant_of", { model: label })} value={current.id}
                    onChange={event => setChoices(previous => ({ ...previous, [family.key]: event.target.value }))}>
                    {family.rows.map(entry => <option key={entry.id} value={entry.id}>
                        {[variantLabel(entry), gib(entry.total_bytes), entry.speech?.default && t("model_downloads.asr_type_default"),
                            ["downloaded", "in_use"].includes(status(entry)) && t(`model_catalog.status.${status(entry)}`),
                            warningOf(entry) && t("model_catalog.hardware_warning.option")].filter(Boolean).join(" · ")}
                    </option>)}
                </select></label>}
            {family.rows.length === 1 && variantLabel(current) !== current.name && <p className={styles.variant}>{t("model_catalog.variant")}: {variantLabel(current)}</p>}
            <ModelFacts entry={current} />
            {current.guidance?.reference_memory_bytes && <details className={styles.more}><summary>{t('model_downloads.guidance_summary')}</summary>
                {/* A tier's own wording where the speech models' (a GPU, a provider's figure) does not fit. */}
                <p>{t(`model_downloads.tier_${current.guidance.tier}`)} · {t([`model_downloads.memory_reference_${current.guidance.tier}`, 'model_downloads.memory_reference'])}: {memory(current.guidance.reference_memory_bytes)}</p>
                <p>{t([`model_downloads.validation_${current.guidance.validation.state}_${current.guidance.tier}`, `model_downloads.validation_${current.guidance.validation.state}`])} {current.guidance.validation.device ?? ''}</p>
                {current.guidance.validation.scope && <p>{t(`model_downloads.scope_${current.guidance.validation.scope}`)}</p>}
                {hint.device && hint.device.description !== current.guidance.validation.device && <p>{t('model_downloads.gpu_unverified')}</p>}
            </details>}
            {/* Only after the user picks another file; the file in use shown first is not a choice. */}
            {choices[family.key] && hint.recommended && family.rows.some(entry => entry.id === hint.recommended) && current.id !== hint.recommended &&
                <p>{t('model_downloads.manual_choice')}</p>}
            {jobView(current, true)}
            {others.map(entry => jobView(entry, false))}
            <div className={styles.actions}>
                <button type="button" disabled={busy} onClick={() => {
                    setConsent(false);
                    setAcknowledged([]);
                    setSelected({ ...current, catalog_version: catalog.catalog_version, downloaded });
                }}>{t(downloaded ? "model_catalog.prepare" : "model_downloads.review")}</button>
                {/* The TTS models: a short sentence on the monitor output only (#415). */}
                <AuditionButton target={target} status={shownStatus} />
            </div>
            {downloaded && !job && shownStatus !== "in_use" && <p>{t("model_catalog.prepare_hint")}</p>}
            <AuditionNote target={target} status={shownStatus} />
        </li>;
    };

    return <section ref={section} tabIndex={-1} className={styles.container} aria-label={t("model_downloads.title")}>
        <h3>{t("model_downloads.title")}</h3>
        <p>{t("model_downloads.help")}</p>
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
            return <section key={target} className={styles.catalog_group} aria-labelledby={heading}>
                <h4 id={heading}>{t(`model_catalog.group.${target}`)}</h4>
                <p>{t(`model_catalog.group_help.${target}`)}</p>
                {tts && <>
                    {!shared && hint.device && <p>{hint.device.name}: {hint.device.description} · {t('model_downloads.hardware_free')}: {memory(hint.device.memory_free)} / {t('model_downloads.hardware_total')}: {memory(hint.device.memory_total)}</p>}
                    {!shared && hardware.measured_at_ms && <p>{t('model_downloads.hardware_measured')}: {measuredTime(hardware.measured_at_ms, i18n?.language)}</p>}
                    <p>{t(`model_downloads.advice_${hint.reason}`)}</p>
                    {!shared && hint.multiple && <p>{t('model_downloads.multiple_gpus')}</p>}
                    {hint.recommended && <p><strong>{t('model_downloads.recommended')}</strong>: {matching.find(entry => entry.id === hint.recommended)?.name}</p>}
                    {families.length > 1 && <p>{t(`model_downloads.choice_${target}`)}</p>}
                </>}
                {target === "asr" && <p>{t("model_downloads.asr_choice")}</p>}
                {["rvc", "asr", "vad", "diarization"].includes(target) && <p>{t(`model_downloads.${target}_requirements`)}</p>}
                {/* The models of one's own sit in the same list, after the reviewed ones (#403). */}
                <ul className={styles.catalog} role="list">
                    {families.map(family => card(target, family))}
                    {own && <UserModelCards target={target} expected={expected} blocked={blocked} busy={busy} />}
                </ul>
                {own && <UserModelRegistration target={target} busy={busy} />}
            </section>;
        })}
        {hasTTS && !shared && <details className={styles.more}><summary>{t('model_downloads.memory_boundary_summary')}</summary>
            <p>{t('model_downloads.memory_boundary')}</p>
        </details>}
        {engines && targets.includes("japanese") && <EngineCatalog />}
        {selected && <dialog ref={dialog} aria-label={t("model_downloads.warning_title")} onCancel={event => { event.preventDefault(); close(); }}>
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
            <p>{t("model_downloads.license_links")}: {selected.licenses.map((url, i) => <span key={url}> <a href={url} onClick={event => openLink(event, url)} target="_blank" rel="noreferrer">{linkLabel(url, i)}</a> </span>)}</p>
            {linkError && <div role="alert"><p>{t("model_downloads.link_error")}</p><code style={{ overflowWrap: "anywhere" }}>{linkError}</code></div>}
            <p>{t("model_downloads.destination")}: <code style={{ overflowWrap: "anywhere" }}>{selected.destination}</code></p>
            <ul>{selected.artifacts.map(file => <li key={file.filename}>{file.filename} · {bytes(file.size, t)}</li>)}</ul>
            <label className={styles.checkLabel}><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />{t("model_downloads.consent")}</label>
            {/* One more checkbox per restriction, each ticked on its own (#411). */}
            {selectedRestrictions.filter(kind => RESTRICTIONS.includes(kind)).map(kind => <label key={kind} className={styles.checkLabel}>
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
