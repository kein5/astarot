import { useI18n } from "@useI18n";
import { useOcr } from "@logics_configs";
import { FULL_REGION, isFullRegion, normalizeRegion, regionPercent, withRegionValue } from "../../../../../../logics/configs/ocrReadiness";
import type { OcrRegion, RegionKey } from "../../../../../../logics/configs/ocrReadiness";
import type { AtomState } from "@store";
import { SliderContainer } from "../_templates/Templates";
import { Hint, useHintDescriptions } from "../_components/hint/Hint";
import * as styles from "./Ocr.css.ts";
import { Button } from "../../../../../kit/index.ts";

export const OcrRegions = () => {
    const { t } = useI18n();
    const hints = useHintDescriptions();
    const { currentOcrCaptureStatus, currentOcrCaptureRegion, setOcrCaptureRegion,
        currentOcrVrCaptureRegion, setOcrVrCaptureRegion } = useOcr();
    const status = currentOcrCaptureStatus.data;
    const hasVr = status?.available_sources?.includes("vr") === true;
    // How the window and the headset are read in turn: a line over both regions, or the first
    // region's hint on a page reviewed against #614.
    const switching = hasVr ? t("config_page.ocr.region.source_switch") : null;
    return (
        <div data-setting-id="region">
            {switching && !hints && <p className={styles.regionDesc}>{switching}</p>}
            <OcrRegionEditor source="window" variable={currentOcrCaptureRegion} setRegion={setOcrCaptureRegion} lead={hints ? switching : null} />
            {hasVr && <OcrRegionEditor source="vr" variable={currentOcrVrCaptureRegion} setRegion={setOcrVrCaptureRegion} />}
        </div>
    );
};

// The region's name with what it is: under the name, or the name's hint on a page reviewed
// against #614 (its mark takes focus, since no single field stands for the region).
type RegionTitleProps = {
    label: string;
    desc: string;
};

export const RegionTitle = ({ label, desc }: RegionTitleProps) => {
    const hints = useHintDescriptions();
    if (!hints) return <div>
        <p className={styles.regionLabel}>{label}</p>
        <p className={styles.regionDesc}>{desc}</p>
    </div>;
    return <div className={styles.regionTitle} data-hint-host>
        <p className={styles.regionLabel}>{label}</p>
        <Hint text={desc} focusable />
    </div>;
};

// The sliders of one region: the window's or the headset's view. `lead` comes before the
// region's description in its hint.
type OcrRegionEditorProps = {
    source: "window" | "vr";
    variable: AtomState<OcrRegion>;
    setRegion: (region: OcrRegion) => unknown;
    lead?: string | null;
};

const REGION_KEYS: readonly RegionKey[] = ["x", "y", "width", "height"];

export const OcrRegionEditor = ({ source, variable, setRegion, lead = null }: OcrRegionEditorProps) => {
    const { t } = useI18n();
    const region = normalizeRegion(variable.data);
    const label = t(`config_page.ocr.region.${source}_label`);
    const desc = t(`config_page.ocr.region.${source === "vr" ? "vr_desc" : "desc"}`);
    const slider = (key: RegionKey) => (
        <SliderContainer
            key={key}
            label={t(`config_page.ocr.region.${key}`)}
            state={variable.state}
            variable={regionPercent(region, key)}
            setterFunction={value => setRegion(withRegionValue(region, key, value))}
            min={key === "width" || key === "height" ? 2 : 0}
            max={100}
            step={1}
            show_label_values={[0, 25, 50, 75, 100]}
            valueLabelFormat={v => `${v}%`}
        />
    );
    return (
        <section className={styles.region} aria-label={label}>
            <div className={styles.regionHeader}>
                <RegionTitle label={label} desc={lead ? `${lead}\n${desc}` : desc} />
                <div className={styles.preview} role="img"
                    aria-label={t(`config_page.ocr.region.${source === "vr" ? "vr_preview_label" : "preview_label"}`)}>
                    <div className={styles.previewArea} style={{
                        left: `${region.x * 100}%`, top: `${region.y * 100}%`,
                        width: `${region.width * 100}%`, height: `${region.height * 100}%`,
                    }} />
                </div>
            </div>
            {REGION_KEYS.map(slider)}
            <Button className={styles.region_reset}
                disabled={isFullRegion(region) || variable.state !== "ok"}
                onClick={() => setRegion({ ...FULL_REGION })}>
                {t(`config_page.ocr.region.${source === "vr" ? "vr_reset" : "reset"}`)}
            </Button>
        </section>
    );
};
