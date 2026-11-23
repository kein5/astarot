import { useI18n } from "@useI18n";
import { useIoFlow } from "../../../../../logics/flow/useIoFlow";
import { useGpuMemory } from "../../../../../logics/flow/useGpuMemory";
import { IoFlowView } from "../../../io_flow/IoFlowView";
import { Hint } from "../../../config_page/setting_section/setting_box/_components/hint/Hint";
import * as styles from "./IoFlowPanel.css.ts";

// Opened from the top bar: where the user's voice and chat go now, how long the latest
// of each took, and how much GPU memory the app holds. It sits above the conversation and
// scrolls on its own, so the log and the composer stay usable while it is open.
// What the panel is for is the hint of its title (#614): it opens while the pointer is on the
// title and while its mark has keyboard focus, and takes no line of the panel.
export const IoFlowPanel = () => {
    const { t } = useI18n();
    const { isPanelOpen, togglePanel, currentIoFlow, currentIoTraces } = useIoFlow();
    const { currentGpuMemory } = useGpuMemory();
    if (!isPanelOpen) return null;
    return <section id="io_flow_panel" className={styles.panel} aria-label={t("io_flow.title")}>
        <div className={styles.head}>
            <div className={styles.title_line} data-hint-host>
                <h2 className={styles.title}>{t("io_flow.title")}</h2>
                <Hint text={t("io_flow.hint")} focusable />
            </div>
            <button type="button" className={styles.close} onClick={togglePanel}>{t("io_flow.close")}</button>
        </div>
        <IoFlowView flow={currentIoFlow.data} traces={currentIoTraces.data} gpuMemory={currentGpuMemory.data} />
    </section>;
};
