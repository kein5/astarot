import { useI18n } from "@useI18n";
import { CircularProgress } from "@common_components";
import * as styles from "./_DownloadButton.css.ts";
import { legacyDownloadPhase, useLegacyDownloadStatus } from "../../../../../../../../logics/common/useLegacyDownloadStatus";
import type { LegacyDownloadOption } from "../../../../../../../../logics/common/useLegacyDownloadStatus";

// One built-in model in the list of a download choice (DownloadModels).
export interface DownloadOption extends LegacyDownloadOption {
    id: string;
    label?: string;
    is_default?: boolean;
    // Nothing is published to download yet.
    download_unavailable?: boolean;
}

export interface DownloadButtonProps {
    option: DownloadOption;
    downloadStartFunction?: (id: string) => void;
}

export const _DownloadButton = ({option, ...props}: DownloadButtonProps) => {
    const { t } = useI18n();
    // The built-in downloads are the local translation models (Whisper's were removed in #288).
    // Their row names the model; the engine's old name is not shown (#565).
    const model = option.label ?? option.id;
    const progressName = t("legacy_model_downloads.progress_name", { model });
    const status = useLegacyDownloadStatus(option, model, t);
    const phase = legacyDownloadPhase(option);
    // A number while the download runs: Number.isFinite is false for anything else.
    const progress = typeof option.progress === "number" && Number.isFinite(option.progress) ? option.progress : null;

    const renderContent = () => {
        switch (true) {
            case progress !== null:
                return (
                    <div className={styles.progress_wrapper}>
                        <CircularProgress
                            aria-label={progressName}
                            variant={phase === "finalizing" ? "indeterminate" : "determinate"}
                            value={progress}
                            size="3rem"
                            sx={{ color: "var(--primary_300_color)" }}
                        />
                        <p className={styles.progress_label} aria-hidden="true">{`${Math.round(progress)}%`}</p>
                    </div>
                );
            case option.is_pending === true:
                return (
                    <div className={styles.progress_wrapper}>
                        <CircularProgress aria-label={progressName} size="3rem" sx={{ color: "var(--dark_600_color)" }}/>
                    </div>
                );
            // Nothing to download yet: say so instead of a button that only opens a dead end.
            case !option.is_downloaded && option.download_unavailable === true:
                return <span className={styles.unavailable}>{t("config_page.translation.download_unavailable")}</span>;
            case !option.is_downloaded:
                return (
                    <button
                        className={styles.download_button}
                        onClick={() => props.downloadStartFunction?.(option.id)}
                    >
                        <p className={styles.download_button_label}>{t("model_downloads.review")}</p>
                    </button>
                );
            case option.is_default === true:
                return (
                    <span className={styles.default_badge}>
                        {t("common.default_label")}
                    </span>
                );
            default:
                return null;
        }
    };

    return <div className={styles.download_container}>
        {renderContent()}
        <span className={styles.status} role="status" aria-live="polite" aria-atomic="true">{status}</span>
    </div>;
};
