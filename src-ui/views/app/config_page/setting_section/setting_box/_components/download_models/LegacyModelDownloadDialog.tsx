import { useEffect } from "react";
import type { ReactNode } from "react";
import { useI18n } from "@useI18n";
import { useTranslation } from "@logics_configs";
import { useModelDownloads } from "../../../../../../../logics/voice/useModelDownloads";
import * as styles from "../../advanced_settings/VoiceSettings.css.ts";
import * as dialogStyles from "./LegacyModelDownloadDialog.css.ts";
import { useConsentDialog } from "../../../../../../../logics/common/useConsentDialog";
import { translationCatalogIds } from "../../../../../../../logics/main/setupNeeds";
import { ModelDownloads } from "../../advanced_settings/ModelDownloads";
import type { TranslationDevice } from "../../../../../../../logics/voice/modelHardwareWarning";
import { CustomModelLink } from "../custom_model_link/CustomModelLink";
import { Button, Dialog, DialogFooter, DialogHeader, DialogTitle } from "../../../../../../kit/index.ts";

// The review of a translation model (#1015). Native modal scope, initial focus on Back and the
// shared catalog form styles.
// extraAction: another way forward that closes this review without downloading.
// note: what the download goes on to, when the caller continues something afterwards.
// The translation models of the ONNX engine come through the shared consent catalog (target
// "translation"): the review lists them there, or says that none is published yet and that a
// model of one's own is added in the translation catalog. It shows the variants of the model it
// was opened for, or every translation model when the catalog has none of that one. The built-in
// CTranslate2 download it reviewed before is gone: the core retired it in 0.5.0 (#1015).
// A model of one file opens its review, with the consent, at once: the press that opened this
// dialog asked for it, and a card with one more 「取得内容を確認」 was a second press (#1266 T-3).
// Back there closes this dialog too; a started download stays here with its progress.
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
    // Named by its title, without a description, as before the kit (D-23, D-43).
    return <div className={`${styles.container} ${dialogStyles.host}`}>
        <Dialog ref={dialog} open onOpenChange={cancel} stepsBack aria-describedby={undefined}>
            <DialogHeader>
                <DialogTitle>{t("model_downloads.warning_title")}</DialogTitle>
            </DialogHeader>
            {catalog ? <>
                {translationRows.length > 0
                    ? <ModelDownloads targets={["translation"]} expected={{ translation: {} }} usable={usable}
                        only={ownRows.length > 0 ? ownRows.map(model => model.id) : undefined} translationDevice={computeDevice}
                        onStart={onCatalogStart} reviewAtOnce={ownRows.length > 0} onReviewDone={started => { if (!started) cancel(); }} />
                    : <p role="status">{t("legacy_model_downloads.translation_not_published")}</p>}
                {/* What the download goes on to, when the caller continues something (#1015). */}
                {note && translationRows.length > 0 && <p>{note}</p>}
                {/* A model of one's own is added in the translation catalog, from any folder (#597). Said
                    only when none is published: someone getting a built-in model is not asked about
                    their own (#1266). */}
                {translationRows.length === 0 && <>
                    <p>{t("legacy_model_downloads.translation_own_model")}</p>
                    <CustomModelLink section="translation" />
                </>}
            </> : <p role="status">{t(error ? "legacy_model_downloads.review_unavailable" : "model_downloads.loading")}</p>}
            <DialogFooter>
                <Button autoFocus onClick={cancel}>{t(catalog ? "legacy_model_downloads.close" : "model_downloads.back")}</Button>
            </DialogFooter>
            {/* Another way forward: the kit's quiet Button, on its own line under the footer
                (decided on 2026-11-25). */}
            {extraAction && <Button tone="quiet" className={dialogStyles.ownLine} onClick={() => { cancel(); extraAction.onClick(); }}>{extraAction.label}</Button>}
        </Dialog>
    </div>;
};
