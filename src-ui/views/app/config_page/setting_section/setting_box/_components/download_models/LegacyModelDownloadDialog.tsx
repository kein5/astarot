import { useEffect } from "react";
import type { ReactNode } from "react";
import { useI18n } from "@useI18n";
import { useTranslation } from "@logics_configs";
import { useModelDownloads } from "../../../../../../../logics/voice/useModelDownloads";
import styles from "../../advanced_settings/VoiceSettings.module.scss";
import dialogStyles from "./LegacyModelDownloadDialog.module.scss";
import { useConsentDialog } from "../../../../../../../logics/common/useConsentDialog";
import { translationCatalogIds } from "../../../../../../../logics/main/setupNeeds";
import { ModelDownloads } from "../../advanced_settings/ModelDownloads";
import type { TranslationDevice } from "../../../../../../../logics/voice/modelHardwareWarning";
import { CustomModelLink } from "../custom_model_link/CustomModelLink";

// The review of a translation model (#1015). Native modal scope, initial focus on Back and the
// shared catalog form styles.
// extraAction: another way forward that closes this review without downloading.
// note: what the download goes on to, when the caller continues something afterwards.
// The translation models of the ONNX engine come through the shared consent catalog (target
// "translation"): the review lists them there, or says that none is published yet and that a
// model of one's own is added in the translation catalog. It shows the variants of the model it
// was opened for, or every translation model when the catalog has none of that one. The built-in
// CTranslate2 download it reviewed before is gone: the core retired it in 0.5.0 (#1015).
// The download catalog, as far as the review reads it (docs/voice-stack/model-downloads.md).
// Like the hook's catalog, it is declared, not checked.
interface ReviewCatalog {
    models?: readonly { id: string; target?: string }[] | null;
}

export interface LegacyModelDownloadDialogProps {
    // The translation model (CTranslate2 weight type) the review is about.
    weightType: string;
    onCancel: () => void;
    extraAction?: { label: ReactNode; onClick: () => void } | null;
    note?: ReactNode;
    // The saved device of the local translation (SELECTED_TRANSLATION_COMPUTE_DEVICE); the
    // models' memory is compared with it, the CPU's by default.
    computeDevice?: TranslationDevice;
    // A translation model of the catalog the user started to download here (#1015).
    onCatalogStart?: (id: string) => void;
}

export const LegacyModelDownloadDialog = ({ weightType, onCancel, extraAction = null, note = null, computeDevice, onCatalogStart }: LegacyModelDownloadDialogProps) => {
    const { t } = useI18n();
    const { catalog: downloadCatalog, error, send } = useModelDownloads();
    const { currentCTranslate2WeightTypeStatus } = useTranslation();
    const catalog: ReviewCatalog | null = downloadCatalog;
    const { dialog, close } = useConsentDialog(true);
    const cancel = () => { close(); onCancel(); };
    useEffect(() => {
        send("/get/data/model_download_catalog");
    }, [send]);
    const translationRows = catalog ? (catalog.models ?? []).filter(model => model.target === "translation") : [];
    const variants = translationCatalogIds(weightType);
    const ownRows = translationRows.filter(model => variants.includes(model.id));
    // The translation models the app can use: their weights count as downloaded in the core, which
    // checks every file before it does. Their cards offer no check or preparation again (#947).
    const usable = (currentCTranslate2WeightTypeStatus?.data ?? []).filter(item => item.is_downloaded).flatMap(item => translationCatalogIds(item.id));
    return <div className={`${styles.container} ${dialogStyles.host}`}>
        <dialog ref={dialog} className={dialogStyles.dialog} aria-label={t("model_downloads.warning_title")} onCancel={event => { event.preventDefault(); cancel(); }}>
            <h3>{t("model_downloads.warning_title")}</h3>
            {catalog ? <>
                {translationRows.length > 0
                    ? <ModelDownloads targets={["translation"]} expected={{ translation: {} }} usable={usable}
                        only={ownRows.length > 0 ? ownRows.map(model => model.id) : undefined} translationDevice={computeDevice}
                        onStart={onCatalogStart} />
                    : <p role="status">{t("legacy_model_downloads.translation_not_published")}</p>}
                {/* What the download goes on to, when the caller continues something (#1015). */}
                {note && translationRows.length > 0 && <p>{note}</p>}
                {/* A model of one's own is added in the translation catalog, from any folder (#597). */}
                <p>{t("legacy_model_downloads.translation_own_model")}</p>
                <CustomModelLink section="translation" />
            </> : <p role="status">{t(error ? "legacy_model_downloads.review_unavailable" : "model_downloads.loading")}</p>}
            <div className={styles.actions}>
                <button type="button" autoFocus onClick={cancel}>{t(catalog ? "legacy_model_downloads.close" : "model_downloads.back")}</button>
            </div>
            {extraAction && <p className={dialogStyles.alternative}>
                <button type="button" onClick={() => { cancel(); extraAction.onClick(); }}>{extraAction.label}</button>
            </p>}
        </dialog>
    </div>;
};
