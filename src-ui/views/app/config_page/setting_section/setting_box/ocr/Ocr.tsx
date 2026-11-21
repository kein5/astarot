import { useCallback, useEffect, useRef } from "react";
import { useI18n } from "@useI18n";
import { createLanguageNames } from "../../../../../../logics/common/languageNames.ts";
import styles from "./Ocr.module.scss";

import { useOcr } from "@logics_configs";
import { useSaveButtonLogic } from "@logics_configs";
import { detectorStatus } from "../../../../../../logics/configs/ocrReadiness";

import {
    CheckboxContainer,
    DropdownMenuContainer,
    EntryWithSaveButtonContainer,
    SliderContainer,
} from "../_templates/Templates";

import { SectionLabelComponent } from "../_components";
import { OcrRegions } from "./OcrRegions";
import { OcrModels } from "./OcrModels";
import { OCR_MODELS_SETTING_ID } from "../../../../../../logics/ocr/useOcrSetup";
import { OcrStatus } from "./OcrStatus";
import { OcrSharedWindow } from "./OcrSharedWindow";
import { AdvancedSection } from "../_components/advanced_section/AdvancedSection";
import { StableWords } from "../../../../../common_components/stable_words/StableWords";
import { HintDescriptions } from "../_components/hint/Hint";
import type { DropdownSelection } from "../_components/_atoms/_dropdown_menu/_DropdownMenu";

// The field's draft as the entry shows it: what was typed, or the value the backend answered.
const entryValue = (value: unknown) => typeof value === "string" || typeof value === "number" ? value : null;

// What chat reading needs to start is in sight: its state, the language, the models, and on
// Wayland the window to share. Where on the screen it reads and how often are set once, in
// 「詳細設定」, whose line shows the interval and the confidence (#554).
export const Ocr = () => {
    const { t } = useI18n();
    const { currentOcrPollIntervalMs, currentOcrMinConfidence } = useOcr();
    // Reviewed against #614: the rows' descriptions are their labels' hints, and the page's
    // opening line is its heading's. What the readouts and the model download say stays in sight.
    return (
        <HintDescriptions>
        <div className={styles.container}>
            <Main_Container />
            <AdvancedSection status={t("config_page.advanced_status.ocr", {
                interval: currentOcrPollIntervalMs.data ?? "-", confidence: currentOcrMinConfidence.data ?? "-" })}>
                <Detection_Container />
                <CaptureTarget_Container />
                <Performance_Container />
            </AdvancedSection>
        </div>
        </HintDescriptions>
    );
};


const Main_Container = () => {
    const { t } = useI18n();
    const { currentOcrReadiness, getOcrReadiness,
        currentOcrSourceLanguage, currentOcrWindowTitle } = useOcr();
    // useOcr() hands out new functions on every render; pin the latest one so
    // refreshing does not itself trigger another refresh.
    const getReadiness = useRef(getOcrReadiness);
    getReadiness.current = getOcrReadiness;
    const refresh = useCallback(() => getReadiness.current(), []);
    const language = currentOcrSourceLanguage.data, title = currentOcrWindowTitle.data;
    // The models a language needs and whether VRChat is open change with these settings.
    useEffect(() => { refresh(); }, [refresh, language, title]);
    const readiness = currentOcrReadiness.data;
    // The core sends both lists with every reply (an empty list when nothing is needed).
    const required = readiness?.required_models ?? [];
    return (
        <div>
            <SectionLabelComponent label={t("config_page.ocr.section_title")} desc={t("config_page.ocr.section_desc")} />
            <OcrStatus readiness={readiness} onRefresh={refresh} />
            <OcrSourceLanguage_Box />
            {/* Wayland only: without a shared window there is nothing to read. */}
            <OcrSharedWindow />
            {/* Until the readiness arrives, the models' bar keeps its place (checking), so the
                rows under it do not move when the answer comes (#912). */}
            {(!readiness || required.length > 0) &&
                <OcrModels ids={required} missing={readiness?.missing_models ?? []} onChanged={refresh}
                    settingId={OCR_MODELS_SETTING_ID} checking={!readiness}
                    title={t("config_page.ocr.models.title")} desc={t("config_page.ocr.models.desc")}
                    note={t("config_page.ocr.models.required")} />}
        </div>
    );
};

const Detection_Container = () => {
    const { t } = useI18n();
    return (
        <div>
            <SectionLabelComponent sub label={t("config_page.ocr.detection")} />
            <OcrChatboxDetector_Box />
            <OcrRegions />
            <OcrChatboxFilter_Box />
        </div>
    );
};

// The detector's states, whose line keeps the lines of the longest of them.
const DETECTOR_STATES = ["on", "ready", "restart", "paused", "off", "missing"] as const;

// VRCT-VOX's own chatbox detector: optional download, then a switch (on by default).
// Until the readiness arrives, the part is drawn as it will be: the switch unavailable, the line
// and the model's bar saying it is being checked. The line keeps the lines of its longest state,
// and the model's bar stays once the model is on the PC, saying so. The part keeps one size, so
// the rows under it do not move when the answer comes (#912).
export const OcrChatboxDetector_Box = () => {
    const { t } = useI18n();
    const { currentOcrReadiness, getOcrReadiness, currentOcrCaptureStatus,
        currentOcrUseChatboxDetector, toggleOcrUseChatboxDetector } = useOcr();
    const getReadiness = useRef(getOcrReadiness);
    getReadiness.current = getOcrReadiness;
    const refresh = useCallback(() => getReadiness.current(), []);
    const readiness = currentOcrReadiness.data;
    const status = detectorStatus(readiness, currentOcrUseChatboxDetector.data, currentOcrCaptureStatus.data ?? readiness?.runtime);
    // A core that names no detector has none to offer.
    if (readiness && !status) return null;
    const installed = status?.installed === true;
    return (
        <div className={styles.detector}>
            <CheckboxContainer
                setting_id="ocr_use_chatbox_detector"
                label={t("config_page.ocr.detector.label")}
                desc={t("config_page.ocr.detector.desc")}
                variable={{ ...currentOcrUseChatboxDetector, data: installed && status?.preferred === true }}
                is_available={installed}
                toggleFunction={installed ? toggleOcrUseChatboxDetector : undefined}
            />
            <p role="status" className={styles.detectorStatus} data-state={status?.on ? "on" : "off"}>
                <StableWords align="start" current={t(status?.key ?? "config_page.ocr.readiness.checking")}
                    words={DETECTOR_STATES.map(state => t(`config_page.ocr.detector.status_${state}`))} /></p>
            <OcrModels ids={status ? [status.model] : []} missing={status && !installed ? [status.model] : []} onChanged={refresh}
                checking={!status}
                title={t("config_page.ocr.detector.models_title")} note={t("config_page.ocr.detector.optional")} />
        </div>
    );
};

const OcrChatboxFilter_Box = () => {
    const { t } = useI18n();
    const { currentOcrChatboxFilter, toggleOcrChatboxFilter } = useOcr();
    return (
        <CheckboxContainer
            setting_id="ocr_chatbox_filter"
            label={t("config_page.ocr.chatbox_filter.label")}
            desc={t("config_page.ocr.chatbox_filter.desc")}
            variable={currentOcrChatboxFilter}
            toggleFunction={toggleOcrChatboxFilter}
        />
    );
};

const OcrSourceLanguage_Box = () => {
    const { t, i18n } = useI18n();
    const { currentSelectableOcrSourceLanguageList, currentOcrSourceLanguage, setOcrSourceLanguage } = useOcr();

    const names = createLanguageNames(i18n.language);
    const label = (id: string) => id === "auto" ? t("config_page.ocr.source_language.auto") : names.language(id);
    const list = Object.fromEntries(Object.keys(currentSelectableOcrSourceLanguageList.data ?? {}).map(id => [id, label(id)]));
    // Old configs can retain a language now covered by the automatic model, and the saved
    // choice shows before the list arrives: name it the same way ("auto" is never shown raw).
    if (currentOcrSourceLanguage.data && !list[currentOcrSourceLanguage.data]) {
        list[currentOcrSourceLanguage.data] = label(currentOcrSourceLanguage.data);
    }
    const selectFunction = (selected_data: DropdownSelection) => {
        setOcrSourceLanguage(selected_data.selected_id);
    };

    return (
        <DropdownMenuContainer
            setting_id="ocr_source_language"
            dropdown_id="ocr_source_language"
            label={t("config_page.ocr.source_language.label")}
            desc={t("config_page.ocr.source_language.desc")}
            selected_id={currentOcrSourceLanguage.data}
            list={list}
            selectFunction={selectFunction}
            state={currentOcrSourceLanguage.state}
            remove_border_bottom={true}
        />
    );
};


const CaptureTarget_Container = () => {
    const { t } = useI18n();
    return (
        <div>
            <SectionLabelComponent sub label={t("config_page.ocr.capture_target")} />
            <OcrWindowTitle_Box />
        </div>
    );
};

const Performance_Container = () => {
    const { t } = useI18n();
    return (
        <div>
            <SectionLabelComponent sub label={t("config_page.ocr.performance")} />
            <OcrPollIntervalMs_Box />
            <OcrMinConfidence_Box />
            <OcrBubbleMinTextLength_Box />
        </div>
    );
};

const OcrWindowTitle_Box = () => {
    const { t } = useI18n();
    const { currentOcrWindowTitle, setOcrWindowTitle } = useOcr();

    const { variable, onChangeFunction, saveFunction } = useSaveButtonLogic({
        variable: currentOcrWindowTitle.data,
        state: currentOcrWindowTitle.state,
        setFunction: setOcrWindowTitle,
        label: t("config_page.ocr.window_title.label"),
    });

    return (
        <EntryWithSaveButtonContainer
            label={t("config_page.ocr.window_title.label")}
            desc={t("config_page.ocr.window_title.desc")}
            variable={entryValue(variable)}
            saveFunction={saveFunction}
            onChangeFunction={onChangeFunction}
            state={currentOcrWindowTitle.state}
            remove_border_bottom={true}
        />
    );
};

const OcrPollIntervalMs_Box = () => {
    const { t } = useI18n();
    const { currentOcrPollIntervalMs, setOcrPollIntervalMs } = useOcr();

    return (
        <SliderContainer
            label={t("config_page.ocr.poll_interval_ms.label")}
            desc={t("config_page.ocr.poll_interval_ms.desc")}
            state={currentOcrPollIntervalMs.state}
            variable={currentOcrPollIntervalMs.data}
            setterFunction={setOcrPollIntervalMs}
            min={100}
            max={5000}
            step={50}
            show_label_values={[100, 1000, 2000, 3000, 4000, 5000]}
            valueLabelFormat={(v) => `${v} ms`}
        />
    );
};

const OcrMinConfidence_Box = () => {
    const { t } = useI18n();
    const { currentOcrMinConfidence, setOcrMinConfidence } = useOcr();

    return (
        <SliderContainer
            label={t("config_page.ocr.min_confidence.label")}
            desc={t("config_page.ocr.min_confidence.desc")}
            state={currentOcrMinConfidence.state}
            variable={currentOcrMinConfidence.data}
            setterFunction={setOcrMinConfidence}
            min={0.1}
            max={0.99}
            step={0.01}
            marks_step={0.1}
            show_label_values={[0.1, 0.3, 0.5, 0.7, 0.9]}
        />
    );
};

const OcrBubbleMinTextLength_Box = () => {
    const { t } = useI18n();
    const { currentOcrBubbleMinTextLength, setOcrBubbleMinTextLength } = useOcr();

    return (
        <SliderContainer
            label={t("config_page.ocr.bubble_min_text_length.label")}
            desc={t("config_page.ocr.bubble_min_text_length.desc")}
            state={currentOcrBubbleMinTextLength.state}
            variable={currentOcrBubbleMinTextLength.data}
            setterFunction={setOcrBubbleMinTextLength}
            min={1}
            max={50}
            step={1}
            show_label_values={[1, 10, 20, 30, 40, 50]}
            remove_border_bottom={true}
        />
    );
};
