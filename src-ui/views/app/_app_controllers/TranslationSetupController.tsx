import { useEffect, useRef } from "react";
import { useI18n } from "@useI18n";
import { useTranslation } from "@logics_configs";
import { useMainFunction } from "@logics_main";
import { useNotificationStatus } from "@logics_common";
import { useTranslationSetup } from "../../../logics/translation/useTranslationSetup";
import { useOpenTranslatorList } from "../../../logics/translation/useOpenTranslatorList";
import { translationCatalogIds } from "../../../logics/main/setupNeeds";
import { useModelDownloads } from "../../../logics/voice/useModelDownloads";
import { LegacyModelDownloadDialog } from "../config_page/setting_section/setting_box/_components/download_models/LegacyModelDownloadDialog";

// Turning Translation on without its model used to fail with a notice that
// named a settings path and vanished. The review settings use (the translation
// models of the catalog) now opens where the user is. When they pressed the
// switch to get here, the switch is turned on once the model has arrived (#1015):
// the catalog's download is applied once it is verified, as the first-run setup
// applies its downloads. The user asked for the switch and agreed to the download,
// and applying a translation model writes no setting (the core finds it by its catalog id).
export const TranslationSetupController = () => {
    const { t } = useI18n();
    const { request, setRequest, waiting, setWaiting, chooseRequests } = useTranslationSetup();
    const { currentCTranslate2WeightTypeStatus, currentSelectedCTranslate2WeightType, currentSelectedTranslationComputeDevice } = useTranslation();
    const { currentTranslationStatus, setTranslation } = useMainFunction();
    const { showNotification_Success } = useNotificationStatus();
    const openTranslatorList = useOpenTranslatorList();
    const { state: downloads, send: sendDownload } = useModelDownloads();

    // An open review closes with the page; the wait for the model outlives it.
    useEffect(() => () => { setRequest(null); }, [setRequest]);
    // A model that cannot be downloaded yet: the empty conversation and the switch offer the translator list.
    // Only requests made while mounted: drawing the page again does not reopen the list.
    const handledChoose = useRef(chooseRequests);
    useEffect(() => {
        if (chooseRequests === handledChoose.current) return;
        handledChoose.current = chooseRequests;
        openTranslatorList();
    }, [chooseRequests]);
    const weights = currentCTranslate2WeightTypeStatus.data || [];
    const awaited = waiting ? weights.find(item => item.id === waiting.weightType) : undefined;
    const arrived = awaited?.is_downloaded === true;
    // The download's own job, once it has one: a job of an earlier try is not it.
    const job = waiting ? downloads.jobs[waiting.model] : undefined;
    const ours = job?.job_id && job.job_id !== waiting?.before ? job : undefined;
    const abandoned = ours?.phase === "failed" || ours?.phase === "cancelled";
    // Applied once; the core then marks the weight downloaded, and the switch goes on.
    const ready = ours?.phase === "ready" ? ours.job_id : null;
    const applied = useRef<string | null>(null);
    useEffect(() => {
        if (!ready || !waiting || applied.current === ready) return;
        applied.current = ready;
        sendDownload("/run/apply_model_download", { id: waiting.model, job_id: ready, expected: {} });
    }, [ready]);
    useEffect(() => {
        if (!waiting) return;
        if (arrived) {
            setWaiting(null);
            showNotification_Success(t("studio.setup_translation_ready"), { category_id: "translation_setup_ready" });
            if (currentTranslationStatus.data !== true) setTranslation(true);
        } else if (abandoned) {
            setWaiting(null);  // cancelled or failed; its own notice says why
        }
    }, [arrived, abandoned]);

    if (!request) return null;
    const close = () => setRequest(null);
    const reviewed = request.weightType ?? currentSelectedCTranslate2WeightType.data;
    return <LegacyModelDownloadDialog weightType={reviewed}
        onCancel={close} computeDevice={currentSelectedTranslationComputeDevice?.data}
        onCatalogStart={model => {
            // Only a variant of the reviewed model brings the weight the switch asked for; another
            // model the review lists is only fetched.
            if (!request.resume || !translationCatalogIds(reviewed).includes(model)) return;
            setWaiting({ weightType: reviewed, model, before: downloads.jobs[model]?.job_id ?? null });
        }}
        note={request.resume ? t("studio.setup_translation_resume") : null}
        extraAction={{ label: t("studio.setup_other_translator"), onClick: openTranslatorList }} />;
};
