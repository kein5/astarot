import { useEffect, useRef, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { useI18n } from "@useI18n";
import { useTranslation } from "@logics_configs";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useModelDownloads } from "../../../../../../../logics/voice/useModelDownloads";
import { legacyDownloadRequest, legacyReviewSize } from "../../../../../../../logics/configs/legacyModelConsent";
import type { LegacyDownloadRequest, LegacyModelReview } from "../../../../../../../logics/configs/legacyModelConsent";
import styles from "../../advanced_settings/VoiceSettings.module.scss";
import dialogStyles from "./LegacyModelDownloadDialog.module.scss";
import { useConsentDialog } from "../../../../../../../logics/common/useConsentDialog";
import { translationCatalogIds } from "../../../../../../../logics/main/setupNeeds";
import { ModelDownloads } from "../../advanced_settings/ModelDownloads";
import type { TranslationDevice } from "../../../../../../../logics/voice/modelHardwareWarning";
import { CustomModelLink } from "../custom_model_link/CustomModelLink";

// Native modal scope, initial focus on Back and the shared catalog form styles.
// A snapshot remains on screen until closed, even if the catalog is refreshed.
// extraAction: another way forward that closes this review without downloading.
// note: what the download changes, when the caller continues something afterwards.
// The translation models of the ONNX engine come through the shared consent catalog
// (target "translation"): this review lists them there, or says that none is published yet
// and that a model of one's own is added in the translation catalog, instead of waiting for a
// review that never comes.
// It shows the variants of the model it was opened for, or every translation model when the
// catalog has none of that one.
// The download catalog, as far as the review reads it (docs/voice-stack/model-downloads.md):
// the reviews of the built-in downloads, the models, and the folder for one's own translation
// models. Like the hook's catalog, it is declared, not checked.
interface ReviewCatalog {
    legacy_models?: readonly LegacyModelReview[] | null;
    models?: readonly { id: string; target?: string }[] | null;
    translation_models_folder?: string | null;
}

export interface LegacyModelDownloadDialogProps {
    // "ctranslate2": the built-in translation models.
    kind: string;
    weightType: string;
    onCancel: () => void;
    onDownload: (request: LegacyDownloadRequest) => void;
    extraAction?: { label: ReactNode; onClick: () => void } | null;
    note?: ReactNode;
    // The saved device of the local translation (SELECTED_TRANSLATION_COMPUTE_DEVICE); the
    // models' memory is compared with it, the CPU's by default.
    computeDevice?: TranslationDevice;
}

export const LegacyModelDownloadDialog = ({ kind, weightType, onCancel, onDownload, extraAction = null, note = null, computeDevice }: LegacyModelDownloadDialogProps) => {
    const { t } = useI18n();
    const { catalog: downloadCatalog, error, send } = useModelDownloads();
    const { currentCTranslate2WeightTypeStatus } = useTranslation();
    const catalog: ReviewCatalog | null = downloadCatalog;
    const [entry, setEntry] = useState<LegacyModelReview | null>(null), [consent, setConsent] = useState(false);
    const [linkError, setLinkError] = useState<string | null>(null);
    const { dialog, close } = useConsentDialog(true);
    const submitted = useRef(false);
    const cancel = () => { close(); onCancel(); };
    useEffect(() => {
        send("/get/data/model_download_catalog");
    }, [send]);
    useEffect(() => {
        const reviewed = catalog?.legacy_models?.find(item => item.kind === kind && item.weight_type === weightType);
        if (reviewed) setEntry(previous => previous ?? reviewed);
    }, [catalog, kind, weightType]);
    const openLink = async (event: MouseEvent<HTMLAnchorElement>, url: string) => {
        if (!isTauri()) return;
        event.preventDefault();
        try { await openUrl(url); setLinkError(null); }
        catch { setLinkError(url); }
    };
    const modelCard = (model: { repo: string; revision: string }) => `https://huggingface.co/${model.repo}/blob/${model.revision}/README.md`;
    const revision = (value: string) => <code title={value} aria-description={value}>{value.slice(0, 12)}</code>;
    const request = legacyDownloadRequest(entry, consent);
    // The reviewed tokenizer, read by the link's handler as well.
    const tokenizer = entry?.tokenizer;
    const translation = kind === "ctranslate2" && !!catalog && !entry;
    const translationRows = translation ? (catalog.models ?? []).filter(model => model.target === "translation") : [];
    const variants = translationCatalogIds(weightType);
    const ownRows = translationRows.filter(model => variants.includes(model.id));
    // The translation models the app can use: their weights count as downloaded in the core, which
    // checks every file before it does. Their cards offer no check or preparation again (#947).
    const usable = (currentCTranslate2WeightTypeStatus?.data ?? []).filter(item => item.is_downloaded).flatMap(item => translationCatalogIds(item.id));
    return <div className={`${styles.container} ${dialogStyles.host}`}>
        <dialog ref={dialog} className={dialogStyles.dialog} aria-label={t("model_downloads.warning_title")} onCancel={event => { event.preventDefault(); cancel(); }}>
            <h3>{t("model_downloads.warning_title")}</h3>
            {entry ? <>
                <dl className={dialogStyles.facts}>
                    <div className={dialogStyles.fact}>
                        <dt>{t("legacy_model_downloads.model")}</dt><dd>{entry.name}</dd>
                    </div>
                    <div className={dialogStyles.fact}>
                        <dt>{t("legacy_model_downloads.provider")}</dt><dd>{entry.provider}</dd>
                    </div>
                    <div className={dialogStyles.fact}>
                        <dt>{t("legacy_model_downloads.license")}</dt>
                        <dd>{entry.license}
                            {entry.non_commercial && <p role="alert">{t("legacy_model_downloads.non_commercial")}</p>}
                        </dd>
                    </div>
                    <div className={dialogStyles.fact}>
                        <dt>{t("legacy_model_downloads.size")}</dt><dd>{legacyReviewSize(entry, t)}</dd>
                    </div>
                    {tokenizer && <div className={dialogStyles.fact}>
                        <dt>{t("legacy_model_downloads.additional_files")}</dt>
                        <dd>{t("legacy_model_downloads.tokenizer_label")}: <a href={modelCard(tokenizer)}
                            onClick={event => openLink(event, modelCard(tokenizer))} target="_blank" rel="noreferrer">{tokenizer.repo}</a>
                            {" ("}{t("legacy_model_downloads.revision_label")} {revision(tokenizer.revision)}{")"}
                            {tokenizer.bundled && <p>{t("legacy_model_downloads.included_tokenizer")}</p>}
                            {entry.tokenizer_size_unknown && <p>{t("legacy_model_downloads.plus_tokenizer")}</p>}
                        </dd>
                    </div>}
                    <div className={dialogStyles.fact}>
                        <dt>{t("legacy_model_downloads.revision_label")}</dt><dd>{revision(entry.revision)}</dd>
                    </div>
                    <div className={dialogStyles.fact}>
                        <dt>{t("legacy_model_downloads.terms")}</dt>
                        <dd><a href={modelCard(entry)} onClick={event => openLink(event, modelCard(entry))}
                            target="_blank" rel="noreferrer">{t("model_downloads.model_card")} ({entry.repo})</a></dd>
                    </div>
                </dl>
                {linkError && <div role="alert"><p>{t("model_downloads.link_error")}</p><code>{linkError}</code></div>}
                <p>{note ?? t("legacy_model_downloads.no_start")}</p>
                <label className={styles.checkLabel}><input type="checkbox" checked={consent}
                    onChange={event => setConsent(event.target.checked)} />{t(entry.tokenizer
                        ? "legacy_model_downloads.consent" : "legacy_model_downloads.consent_without_extra_files")}</label>
            </> : translation ? <>
                {translationRows.length > 0
                    ? <ModelDownloads targets={["translation"]} expected={{ translation: {} }} usable={usable}
                        only={ownRows.length > 0 ? ownRows.map(model => model.id) : undefined} translationDevice={computeDevice} />
                    : <p role="status">{t("legacy_model_downloads.translation_not_published")}</p>}
                {/* A model of one's own is added in the translation catalog, from any folder (#597). */}
                <p>{t("legacy_model_downloads.translation_own_model")}</p>
                <CustomModelLink section="translation" />
            </> : <p role="status">{t(error ? "legacy_model_downloads.review_unavailable" : "model_downloads.loading")}</p>}
            <div className={styles.actions}>
                <button type="button" autoFocus onClick={cancel}>{t(translation ? "legacy_model_downloads.close" : "model_downloads.back")}</button>
                {/* The main action, blue (#462); VoiceSettings' .container reaches it through the host div. */}
                {!translation && <button type="button" className="primary" disabled={!request} onClick={() => {
                    if (!request || submitted.current) return;
                    submitted.current = true;
                    close(); onDownload(request); onCancel();
                }}>{t("model_downloads.start")}</button>}
            </div>
            {extraAction && <p className={dialogStyles.alternative}>
                <button type="button" onClick={() => { cancel(); extraAction.onClick(); }}>{extraAction.label}</button>
            </p>}
        </dialog>
    </div>;
};
