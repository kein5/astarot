import { useEffect, useRef } from "react";
import { useI18n } from "@useI18n";
import { useTranslation } from "@logics_configs";
import { useVcRuntimes } from "../../../../../../logics/voice/useVcRuntimes";
import { VcRuntimeSetup } from "../advanced_settings/VcRuntimeSetup";
import { Description } from "../_components/description/Description";
import styles from "../advanced_settings/VoiceSettings.module.scss";

// The GPU builds of ONNX Runtime for the local translation (core-integration, decision 2 (c)).
// The packages ship the CPU build only. These are fetched after the user's consent, where they
// can run: the CUDA build with an NVIDIA driver, the DirectML build on Windows. The backend
// offers only those, so this renders nothing elsewhere.
export const TRANSLATION_RUNTIMES = ["onnxruntime-cuda", "onnxruntime-directml"];

export const TranslationGpuRuntimes = () => {
    const { t } = useI18n();
    const { catalog, state, send } = useVcRuntimes();
    const { getSelectableTranslationComputeDeviceList } = useTranslation();
    useEffect(() => {
        send("/get/data/vc_runtime_catalog"); send("/get/data/vc_runtime_state");
    }, [send]);
    // A build set up here joins the device list, to be chosen for the next start.
    const installed = TRANSLATION_RUNTIMES.filter(id => state.installed[id]).join(",");
    const seen = useRef(installed);
    useEffect(() => {
        if (installed === seen.current) return;
        seen.current = installed;
        getSelectableTranslationComputeDeviceList?.();
    }, [installed, getSelectableTranslationComputeDeviceList]);
    const offered = TRANSLATION_RUNTIMES.filter(id => catalog?.runtimes?.some(row => row.id === id));
    if (offered.length === 0) return null;
    // The runtime setup's controls and consent dialog take their look from the voice settings' container.
    return <section className={styles.container} aria-label={t("config_page.translation.gpu_runtimes.label")}>
        <Description text={t("config_page.translation.gpu_runtimes.desc")} />
        {offered.map(id => <VcRuntimeSetup key={id} engine={id} />)}
    </section>;
};
