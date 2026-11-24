import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { useI18n } from "@useI18n";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useModelDownloads } from "../../../../../../logics/voice/useModelDownloads";
import * as voiceStyles from "../advanced_settings/VoiceSettings.css.ts";
import * as styles from "./Ocr.css.ts";
import { EnvReadout } from "../_components/env_readout/EnvReadout";
import { CatalogFacts, CatalogLayoutSwitch, CatalogList, CatalogSection, useCatalogLayout } from "../advanced_settings/catalogLayout";
import { useConsentDialog } from "../../../../../../logics/common/useConsentDialog";
import { Button } from "../../../../../kit/index.ts";

const activePhases: readonly unknown[] = ["queued", "downloading", "verifying", "cancelling"];
const megabytes = (value: number) => `${(Number(value) / 1048576).toFixed(1)} MB`;
// A byte count of a download's job, for its progress bar.
const bytesOf = (value: unknown) => typeof value === "number" ? value : undefined;

// What this page reads of a model in /get/data/model_download_catalog (the catalog of the core,
// native/ops/src/downloads/manager.rs). Declared, not checked, like the hook's catalog.
interface OcrCatalogModel {
    id: string;
    target: string;
    name: string;
    provider: string;
    license: string;
    licenses: readonly string[];
    notice: string;
    artifacts: readonly { filename: string; size: number }[];
    total_bytes: number;
    destination: string;
    source: string;
    sources?: readonly string[];
}
interface OcrCatalog {
    catalog_version?: string;
    models?: readonly OcrCatalogModel[];
}
// The model whose terms the dialog shows, with the catalog it came from.
type ReviewedModel = OcrCatalogModel & { catalog_version: string | undefined };

type OcrModelsProps = {
    // The models the page needs, and those of them not installed yet.
    ids: readonly string[];
    missing: readonly string[];
    // Asks for the page's readiness again once one of them is ready.
    onChanged: () => unknown;
    title: string;
    desc?: string;
    note: string;
    settingId?: string;
    // The page has not heard yet which models the language needs: the part's bar is drawn with
    // that in its readout, so the page does not move when the answer comes (#912).
    checking?: boolean;
};

// Chat reading downloads (PP-OCR for the current language, or the optional chatbox
// detector). Same consent flow as the other default models: review source, terms,
// size and destination, then agree. Nothing needs applying afterwards: chat
// reading finds verified files by id.
// The models are a part of a catalog, drawn as the model catalogs' (catalogLayout.tsx): a bar with
// the part's name and readout, cards in the layout chosen for every catalog (the buttons at the top
// of the part), each with its name and state, its size, its details and its download. The part
// starts closed as the catalogs' parts do; its readout says how many are on the PC, and the chat
// reading guide opens it on its way to a model's download (focusOcrModels).
export const OcrModels = ({ ids, missing, onChanged, title, desc, note, settingId, checking = false }: OcrModelsProps) => {
    const { t } = useI18n();
    const { catalog: downloadCatalog, state, error, pending, send } = useModelDownloads();
    const catalog: OcrCatalog | null = downloadCatalog;
    const [selected, setSelected] = useState<ReviewedModel | null>(null), [consent, setConsent] = useState(false);
    const [linkError, setLinkError] = useState<string | null>(null);
    const section = useRef<HTMLElement>(null);
    const { dialog, close: closeDialog } = useConsentDialog(!!selected, section);
    const hasCatalog = !!catalog;

    useEffect(() => {
        if (!hasCatalog) send("/get/data/model_download_catalog");
        send("/get/data/model_download_state");
    }, [hasCatalog, send]);

    const entries = (catalog?.models ?? []).filter(entry => entry.target === "ocr" && ids.includes(entry.id));
    const readyIds = entries.filter(entry => state.jobs[entry.id]?.phase === "ready").map(entry => entry.id).join(",");
    useEffect(() => { if (readyIds) onChanged(); }, [readyIds, onChanged]);

    const busy = !!pending || Object.values(state.jobs).some(job => activePhases.includes(job.phase));
    const close = () => { closeDialog(); setSelected(null); setConsent(false); setLinkError(null); };
    const failure = (code: unknown) => t(`model_downloads.errors.${code}`, { defaultValue: t("model_downloads.errors.download_failed") });
    const openLink = async (event: MouseEvent<HTMLAnchorElement>, url: string) => {
        if (!isTauri()) return;
        event.preventDefault();
        try { await openUrl(url); setLinkError(null); }
        catch { setLinkError(url); }
    };

    const layout = useCatalogLayout();
    const installedOf = (entry: OcrCatalogModel) => !missing.includes(entry.id) || state.jobs[entry.id]?.phase === "ready";
    const obtained = entries.filter(installedOf).length;
    return <section ref={section} tabIndex={-1} className={`${voiceStyles.container} ${styles.models}`} aria-label={title} data-setting-id={settingId}>
        <CatalogSection level={3} title={title} help={desc ? [desc] : []}
            readout={checking ? t("config_page.ocr.readiness.checking") : t("model_catalog.group_readout", { count: entries.length, obtained })}>
            <div className={styles.layout}><CatalogLayoutSwitch /></div>
            {!catalog && <p aria-busy="true">{t("model_downloads.loading")}</p>}
            <CatalogList layout={layout}>
                {entries.map(entry => {
                    const job = state.jobs[entry.id], active = activePhases.includes(job?.phase);
                    const installed = installedOf(entry);
                    const status = active ? "working" : installed ? "downloaded" : "not_downloaded";
                    // The size is on the card in either layout; the terms are beside it in the list, in
                    // the card's fold in the grid.
                    const size = <div><dt>{t("model_catalog.size")}</dt><dd>{megabytes(entry.total_bytes)}</dd></div>;
                    const terms = <div><dt>{t("model_catalog.terms")}</dt><dd>{entry.provider} · {entry.license}</dd></div>;
                    // The card's parts in the order they are read (#614), as a model catalog's card:
                    // what it is and its state, its size and terms, then what runs and the download.
                    return <li key={entry.id} data-model-download tabIndex={-1} role="group" aria-label={entry.name}
                        className={voiceStyles.card} data-status={status}>
                        <div className={voiceStyles.card_intro}>
                            <div className={voiceStyles.card_head}>
                                <strong>{entry.name}</strong>
                                <span className={`${voiceStyles.badge} ${voiceStyles.status}`} data-tone={status}>{t(`model_catalog.status.${status}`)}</span>
                            </div>
                            {/* Why the page lists it: needed for the reading language, or optional. */}
                            <div className={voiceStyles.card_badges}><span className={voiceStyles.badge}>{note}</span></div>
                        </div>
                        {layout === "grid" && <dl className={`${voiceStyles.facts} ${voiceStyles.card_key}`}>{size}</dl>}
                        {layout === "grid"
                            ? <CatalogFacts layout="grid"><dl className={voiceStyles.facts}>{terms}</dl></CatalogFacts>
                            : <dl className={`${voiceStyles.facts} ${voiceStyles.card_spec}`}>{size}{terms}</dl>}
                        <div className={voiceStyles.card_foot}>
                            {job && (active || job.phase === "failed") && <EnvReadout tone={job.phase === "failed" ? "failed" : "neutral"}
                                progress={active && job.phase !== "cancelling" ? "working" : undefined}>
                                <p>{t(`model_downloads.phase_${job.phase}`)}{active && ` · ${megabytes(bytesOf(job.received_bytes) ?? 0)} / ${megabytes(bytesOf(job.total_bytes) ?? 0)}`}</p>
                            </EnvReadout>}
                            {active && job && <progress className={voiceStyles.progress} aria-label={t("model_downloads.progress")}
                                value={bytesOf(job.received_bytes)} max={bytesOf(job.total_bytes)} />}
                            {!!job?.error_code && <p role="alert">{failure(job.error_code)}</p>}
                            {/* Opening a review is not the download itself: the same plain button as everywhere (#474). */}
                            <div className={voiceStyles.actions}>
                                {active && job && <Button disabled={!!pending || job.phase === "cancelling"}
                                    onClick={() => send("/run/cancel_model_download", { id: entry.id, job_id: job.job_id })}>{t("model_downloads.cancel")}</Button>}
                                {!installed && !active && <Button disabled={busy}
                                    onClick={() => { setConsent(false); setSelected({ ...entry, catalog_version: catalog?.catalog_version }); }}>
                                    {t("model_downloads.review")}</Button>}
                            </div>
                        </div>
                    </li>;
                })}
            </CatalogList>
        </CatalogSection>
        {selected && <dialog ref={dialog} aria-label={t("model_downloads.warning_title")} onCancel={event => { event.preventDefault(); close(); }}>
            <div className={voiceStyles.dialog_text}>
                <h3>{t("model_downloads.warning_title")}</h3>
                <p>{selected.name} · {selected.provider}</p>
                <p>{t("model_downloads.exact_bytes", { bytes: Number(selected.total_bytes).toLocaleString("en-US") })} · {selected.license}</p>
                <p>{t(`model_downloads.notice_${selected.notice}`)}</p>
                <p>{t("model_downloads.connection_notice")}</p>
                <p>{t("model_downloads.source")}: {(selected.sources ?? [selected.source]).map(url =>
                    <span key={url}> <a href={url} onClick={event => openLink(event, url)} target="_blank" rel="noreferrer">{url.replace("https://huggingface.co/", "").replace(/\/tree\/.*/, "")}</a> </span>)}</p>
                <p>{t("model_downloads.license_links")}: {selected.licenses.map((url, i) =>
                    <span key={url}> <a href={url} onClick={event => openLink(event, url)} target="_blank" rel="noreferrer">{new URL(url).hostname === "www.apache.org" || url.endsWith("/LICENSE") ? selected.license : `${t("model_downloads.model_card")} (${i + 1})`}</a> </span>)}</p>
                {linkError && <div role="alert"><p>{t("model_downloads.link_error")}</p><code style={{ overflowWrap: "anywhere" }}>{linkError}</code></div>}
                <p>{t("model_downloads.destination")}: <code style={{ overflowWrap: "anywhere" }}>{selected.destination}</code></p>
                <ul>{selected.artifacts.map(file => <li key={file.filename}>{file.filename} · {t("model_downloads.exact_bytes", { bytes: Number(file.size).toLocaleString("en-US") })}</li>)}</ul>
            </div>
            <label className={voiceStyles.checkLabel}><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />{t("model_downloads.consent")}</label>
            <div className={voiceStyles.actions}>
                <button type="button" autoFocus onClick={close}>{t("model_downloads.back")}</button>
                {/* Start is the dialog's main action: blue like the voice models' (#462). */}
                <button type="button" className="primary" disabled={!consent || busy} onClick={() => {
                    if (!consent || busy) return;
                    send("/run/start_model_download", { id: selected.id, consent: true, catalog_version: selected.catalog_version }); close();
                }}>{t("model_downloads.start")}</button>
            </div>
        </dialog>}
        {error && <p role="alert">{failure(error)}</p>}
    </section>;
};
