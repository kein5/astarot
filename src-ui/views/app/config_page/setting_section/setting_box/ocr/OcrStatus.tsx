import { useEffect, useRef } from "react";
import { useI18n } from "@useI18n";
import { useOcr } from "@logics_configs";
import { captureStatusSummary } from "../../../../../../logics/configs/ocrReadiness";
import type { OcrReadiness } from "../../../../../../logics/configs/ocrReadiness";
import { EnvReadout } from "../_components/env_readout/EnvReadout";
import styles from "./Ocr.module.scss";

type OcrStatusProps = {
    readiness: OcrReadiness | null;
    onRefresh: () => unknown;
};

export const OcrStatus = ({ readiness, onRefresh }: OcrStatusProps) => {
    const { t } = useI18n();
    const { currentOcrCaptureStatus, getOcrCaptureStatus } = useOcr();
    const getStatus = useRef(getOcrCaptureStatus);
    getStatus.current = getOcrCaptureStatus;
    useEffect(() => {
        getStatus.current();
        const timer = setInterval(() => getStatus.current(), 1000);
        return () => clearInterval(timer);
    }, []);
    const summary = captureStatusSummary(currentOcrCaptureStatus.data, readiness);
    // Only the summary while the status is still being asked for has no params and no source.
    const params = "params" in summary ? summary.params : undefined;
    const sourceKey = "sourceKey" in summary ? summary.sourceKey : null;
    const message = summary.key === undefined ? "" : t(summary.key, params);
    return (
        <EnvReadout className={styles.readiness} tone={summary.tone}
            actions={<button type="button" onClick={onRefresh}>{t("config_page.ocr.models.refresh")}</button>}>
            <p role="status">{sourceKey ? t(sourceKey, { status: message }) : message}</p>
        </EnvReadout>
    );
};
