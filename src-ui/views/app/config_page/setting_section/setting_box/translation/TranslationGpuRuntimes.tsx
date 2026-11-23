import { useEffect, useRef } from "react";
import { useI18n } from "@useI18n";
import { useTranslation } from "@logics_configs";
import { useVcRuntimes } from "../../../../../../logics/voice/useVcRuntimes";
import { VcRuntimeSetup } from "../advanced_settings/VcRuntimeSetup";
import { SectionLabelComponent } from "../_components";
import styles from "../advanced_settings/VoiceSettings.module.scss";
import * as pair from "./TranslationGpuRuntimes.css.ts";

// The GPU builds of ONNX Runtime for the local translation (core-integration, decision 2 (c)).
// The packages ship the CPU build only. These are fetched after the user's consent, where they
// can run: the CUDA build with an NVIDIA driver, the DirectML build on Windows. The backend
// offers only those, so this renders nothing elsewhere.
const CUDA = "onnxruntime-cuda", DIRECTML = "onnxruntime-directml";
export const TRANSLATION_RUNTIMES = [CUDA, DIRECTML];
const CUDA_NAME = "ONNX Runtime · CUDA"; // i18n-exempt: the build's name, as the catalog names it

// Which build fits the GPU (#945). The two are one choice: the user needs the one their GPU runs.
// The core offers CUDA only where an NVIDIA driver is and DirectML only on Windows, so with CUDA
// offered it is the one (DirectML is not needed then), and on Windows without it DirectML is,
// while CUDA would need an NVIDIA GPU. Off Windows CUDA is the only build: no choice to show.
export const runtimeChoice = (offered: readonly string[]) => {
    const fitting = offered.includes(CUDA) ? CUDA : offered[0] ?? null;
    const others = offered.filter(id => id !== fitting);
    const needsNvidia = offered.includes(DIRECTML) && !offered.includes(CUDA);
    return { fitting, others, needsNvidia, choice: others.length > 0 || needsNvidia };
};

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
    const { fitting, others, needsNvidia, choice } = runtimeChoice(offered);
    if (!fitting) return null;
    // The runtime setup's controls and consent dialog take their look from the voice settings' container.
    // The part has its name as a subheading; what the builds are for is the heading's hint on a page
    // that shows descriptions as hints (#614), a line under it elsewhere.
    // The builds are one choice, and its layout says so before its words (#614): one frame, the
    // build that fits the GPU first and at full strength with the main action, "or" on the line
    // between, and the other quieter, or, where it cannot run, its name and what it needs alone.
    return <section className={styles.container} aria-label={t("config_page.translation.gpu_runtimes.label")}>
        <SectionLabelComponent sub label={t("config_page.translation.gpu_runtimes.label")} desc={t("config_page.translation.gpu_runtimes.desc")} />
        {choice
            ? <div className={pair.choice} role="group" aria-label={t("config_page.translation.gpu_runtimes.label")}>
                <VcRuntimeSetup engine={fitting} fit="fits" />
                <span className={pair.or}>{t("config_page.translation.gpu_runtimes.or")}</span>
                {others.map(id => <VcRuntimeSetup key={id} engine={id} fit="unneeded" />)}
                {needsNvidia && <section className={styles.download_entry} data-fit="unavailable" aria-label={t("vc_runtime.title", { name: CUDA_NAME })}>
                    <strong>{t("vc_runtime.title", { name: CUDA_NAME })}</strong>
                    <div className={styles.card_badges}><span className={styles.badge}>{t("config_page.translation.gpu_runtimes.needs_nvidia")}</span></div>
                </section>}
            </div>
            : <VcRuntimeSetup engine={fitting} />}
    </section>;
};
