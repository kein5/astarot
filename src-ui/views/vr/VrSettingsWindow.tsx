import { createLanguageNames } from "../../logics/common/languageNames.ts";
import { useLayoutEffect, useRef, useState } from "react";
import type { ComponentType, SVGProps } from "react";
import clsx from "clsx";

import { useI18n } from "@useI18n";
import { useIsOpenedConfigPage, useIsOscAvailable, useVolume } from "@logics_common";
import { useAppearance, useDevice, useOcr, useOthers, useTranscription, useTranslation, useVr } from "@logics_configs";
import { useStore_MicVolume, useStore_SelectableFontFamilyList, useStore_SpeakerVolume } from "@store";
import { ui_configs } from "@ui_configs";

import HmdSvg from "@images/mui_head_mounted_device.svg?react";
import ConfigurationSvg from "@images/configuration.svg?react";
import MicSvg from "@images/mic.svg?react";
import AppearanceSvg from "@images/mui_palette.svg?react";
import HeadphonesSvg from "@images/headphones.svg?react";
import TranslationSvg from "@images/translation.svg?react";
import GraphicEqSvg from "@images/mui_graphic_eq.svg?react";
import ChatTranscribeSvg from "@images/chat_transcribe.svg?react";
import WarningSvg from "@images/warning.svg?react";

import { VrWindow } from "./VrWindow";
import { Disclosure, Picker, SectionLabel, SegmentRow, SelectRow, StepperRow, ThresholdRow, ToggleRow } from "./VrSettingsRows";
import type { PickerOption, RowValue } from "./VrSettingsRows";
import { VrHandIcon } from "./VrHandIcon";
import { buildComputeDeviceOptions } from "../app/config_page/setting_section/setting_box/_components/compute_device/computeDeviceOptions";
import type { ComputeDeviceChoice, ComputeDeviceList } from "../app/config_page/setting_section/setting_box/_components/compute_device/computeDeviceOptions";
import { CLOUD_TRANSCRIPTION_ENGINES } from "../../logics/configs/cloudTranscription";
import { isNonCommercialWeight } from "../../logics/configs/ctranslate2License";
import styles from "./VrSettingsWindow.module.scss";
import { splitFeatureLabel } from "../../logics/common/featureLabel.ts";

type Translate = ReturnType<typeof useI18n>["t"];
type Translation = ReturnType<typeof useTranslation>;
type LanguageKind = "ui" | "ocr";
type OpenPicker = (title: string, options: readonly PickerOption[], selected_id: unknown, onPick: (id: string) => unknown, languageKind?: LanguageKind) => void;

// The list open in place of the settings: its title, choices, the current one and what picking does.
interface PickerState {
    title: string;
    options: readonly PickerOption[];
    selected_id: unknown;
    onPick: (id: string) => unknown;
    languageKind?: LanguageKind;
}

// 左のカテゴリはデスクトップの設定画面と同じ順序・名前・アイコン。VRでは文字入力が要る項目
// (APIキー、URL、単語フィルターなど) と、モデルのダウンロードは載せない
const CATEGORIES: readonly { id: string; Icon: ComponentType<SVGProps<SVGSVGElement>> }[] = [
    { id: "device", Icon: MicSvg },
    { id: "appearance", Icon: AppearanceSvg },
    { id: "translation", Icon: TranslationSvg },
    { id: "transcription", Icon: GraphicEqSvg },
    { id: "vrchat", Icon: ChatTranscribeSvg },
    { id: "vr", Icon: HmdSvg },
];

// An AI translator: its models, the chosen one and how to choose, read from useTranslation.
interface AiProvider {
    i18n: string;
    list: (tl: Translation) => RowValue;
    selected: (tl: Translation) => RowValue;
    set: (tl: Translation) => (id: string) => unknown;
}

// 翻訳のAIのうち、接続済み (モデルの一覧が取れている) ものだけモデルを選べる
// 呼ぶ関数の名前は組み立てずに書く。VR から送れる操作の一覧 (vrPanelWire.ts) と照らす試験が、
// ソースに書かれた名前を拾うため (組み立てた名前は拾えず、一覧から漏れても試験が通ってしまう)
const AI_PROVIDERS: readonly AiProvider[] = [
    { i18n: "plamo", list: tl => tl.currentSelectablePlamoModelList, selected: tl => tl.currentSelectedPlamoModel, set: tl => tl.setSelectedPlamoModel },
    { i18n: "gemini", list: tl => tl.currentSelectableGeminiModelList, selected: tl => tl.currentSelectedGeminiModel, set: tl => tl.setSelectedGeminiModel },
    { i18n: "openai", list: tl => tl.currentSelectableOpenAIModelList, selected: tl => tl.currentSelectedOpenAIModel, set: tl => tl.setSelectedOpenAIModel },
    { i18n: "groq", list: tl => tl.currentSelectableGroqModelList, selected: tl => tl.currentSelectedGroqModel, set: tl => tl.setSelectedGroqModel },
    { i18n: "openrouter", list: tl => tl.currentSelectableOpenRouterModelList, selected: tl => tl.currentSelectedOpenRouterModel,
        set: tl => tl.setSelectedOpenRouterModel },
    { i18n: "lmstudio", list: tl => tl.currentSelectableLMStudioModelList, selected: tl => tl.currentSelectedLMStudioModel,
        set: tl => tl.setSelectedLMStudioModel },
    { i18n: "openai_compatible", list: tl => tl.currentSelectableOpenAICompatibleModelList, selected: tl => tl.currentSelectedOpenAICompatibleModel,
        set: tl => tl.setSelectedOpenAICompatibleModel },
    { i18n: "ollama", list: tl => tl.currentSelectableOllamaModelList, selected: tl => tl.currentSelectedOllamaModel, set: tl => tl.setSelectedOllamaModel },
];

const THRESHOLD_STEP = 50;
const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null;
const isElement = (target: EventTarget | null): target is Element => target !== null && "closest" in target;
// 一覧 ({ id: label }) を Picker の形にする
const toOptions = (list: unknown): PickerOption[] => Object.entries(isRecord(list) ? list : {})
    .map(([id, label]) => ({ id, label: typeof label === "string" ? label : String(label) }));
// The label a list ({ id: label }) gives an id, if it has one.
const labelIn = (list: unknown, id: unknown): string | undefined => {
    const label = isRecord(list) && typeof id === "string" ? list[id] : undefined;
    return typeof label === "string" ? label : undefined;
};

// VR設定ウィンドウ。開いている間はデスクトップで設定画面を開いたのと同じ扱いで、
// 翻訳と文字起こしが止まる (VrApp / VrPanelSyncController)
export const VrSettingsWindow = ({ onClose }: { onClose: () => void }) => {
    const { t, i18n } = useI18n();
    const names = createLanguageNames(i18n.language);
    const { currentIsOpenedConfigPage } = useIsOpenedConfigPage();
    const [category, setCategory] = useState("device");
    // 選択肢の一覧を開いているとき: { title, options, selected_id, onPick }
    const [picker, setPicker] = useState<PickerState | null>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const pickerRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const savedScroll = useRef(0);
    // Picker 中も設定を保持し、戻ったら元の位置と操作行へ戻す。
    useLayoutEffect(() => {
        if (picker) {
            pickerRef.current?.querySelector("button")?.focus({ preventScroll: true });
        } else if (listRef.current) {
            listRef.current.scrollTop = savedScroll.current;
            if (triggerRef.current) {
                const trigger = triggerRef.current;
                const disclosure_button = trigger.closest(`.${styles.disclosure}`)?.querySelector<HTMLButtonElement>(`.${styles.disclosure_toggle}`);
                const fallback = disclosure_button && listRef.current.contains(disclosure_button) && !disclosure_button.disabled
                    ? disclosure_button : listRef.current.querySelector<HTMLButtonElement>("button:not(:disabled)");
                const can_restore = listRef.current.contains(trigger) && !trigger.disabled;
                (can_restore ? trigger : fallback)?.focus({ preventScroll: true });
            }
        }
    }, [picker, category]);

    // メインが設定画面を開いてメイン機能を止めるまでは操作させない (音量の確認がマイクを奪い合わないように)
    const is_ready = currentIsOpenedConfigPage.data === true;
    const openPicker: OpenPicker = (title, options, selected_id, onPick, languageKind) => {
        savedScroll.current = listRef.current?.scrollTop ?? 0;
        setPicker({ title, options, selected_id, onPick, languageKind });
    };

    // Resolve language labels at render time, including a picker already open during a UI-language change.
    const languageOptions = picker?.languageKind === "ui" ? names.uiOptions(picker.options)
        : picker?.languageKind === "ocr" ? picker.options.map(option => ({ ...option,
            label: option.id === "auto" ? t("config_page.ocr.source_language.auto") : names.language(option.id) })) : picker?.options;
    const pickerTitle = picker?.languageKind === "ui" ? t("config_page.appearance.ui_language.label")
        : picker?.languageKind === "ocr" ? t("config_page.ocr.source_language.label") : picker?.title;
    const category_label = (id: string) => (id === "vr" ? "VR" : t(`config_page.side_menu_labels.${id}`));

    return (
        <VrWindow Icon={ConfigurationSvg} title={t("vr_panel.window_settings")} onClose={onClose} close_label={t("vr_panel.settings.close")} is_lockable={false}>
            <div className={styles.window_body}>
                <p className={styles.banner}>
                    <WarningSvg className={styles.banner_icon} aria-hidden="true" />
                    {t("vr_panel.paused_while_settings")}
                </p>
                <fieldset className={clsx(styles.body, { [styles.is_waiting]: !is_ready })} disabled={!is_ready} aria-label={t("vr_panel.window_settings")} aria-busy={!is_ready}>
                    <div className={styles.side}>
                        {CATEGORIES.map(({ id, Icon }) => (
                            <button key={id}
                                className={clsx(styles.button, styles.category, { [styles.is_selected]: id === category })}
                                aria-pressed={id === category}
                                onClick={() => { savedScroll.current = 0; triggerRef.current = null; setCategory(id); setPicker(null); }}
                            >
                                <Icon className={styles.category_icon} aria-hidden="true" />
                                <CategoryName text={category_label(id)} />
                            </button>
                        ))}
                    </div>
                    <div key={category} ref={listRef} className={styles.list} hidden={Boolean(picker)} data-vr-settings-list="settings"
                        onClickCapture={(event) => { triggerRef.current = isElement(event.target) ? event.target.closest("button") : null; }}>
                        <Category id={category} t={t} openPicker={openPicker} />
                    </div>
                    {picker && <div ref={pickerRef} className={styles.list} data-vr-settings-list="picker" onKeyDown={(event) => { if (event.key === "Escape") setPicker(null); }}>
                        <Picker {...picker} options={languageOptions ?? picker.options} scrollRef={pickerRef} title={`${category_label(category)} › ${pickerTitle}`} back_label={t("common.go_back_button_label")}
                            onPick={(id) => { picker.onPick(id); setPicker(null); }} onBack={() => setPicker(null)} />
                    </div>}
                </fieldset>
            </div>
        </VrWindow>
    );
};

interface CategoryProps {
    t: Translate;
    openPicker: OpenPicker;
}

const Category = ({ id, t, openPicker }: CategoryProps & { id: string }) => {
    switch (id) {
        case "device": return <DeviceSettings t={t} openPicker={openPicker} />;
        case "appearance": return <AppearanceSettings t={t} openPicker={openPicker} />;
        case "translation": return <TranslationSettings t={t} openPicker={openPicker} />;
        case "transcription": return <TranscriptionSettings t={t} openPicker={openPicker} />;
        case "vrchat": return <VrchatSettings t={t} openPicker={openPicker} />;
        case "vr": return <VrSettings t={t} />;
        default: return null;
    }
};

const DeviceSettings = ({ t, openPicker }: CategoryProps) => {
    const d = useDevice();
    const v = useVolume();
    const { currentMicVolume } = useStore_MicVolume();
    const { currentSpeakerVolume } = useStore_SpeakerVolume();
    // 機器の選択はデスクトップと同じく、自動選択がONの間 (と切り替え中) は押せない
    const deviceRow = (label: string, list: RowValue, selected: { state?: string; data?: string }, setSelected: (id: string) => unknown, auto_select: RowValue) => {
        const options = toOptions(list.data);
        return (
            <SelectRow label={label} value={labelIn(list.data, selected.data) ?? selected.data}
                is_pending={selected.state === "pending" || auto_select.state === "pending" || list.state === "pending"}
                is_disabled={auto_select.data === true || options.length === 0}
                disabled_reason={t(auto_select.data === true ? "vr_panel.settings.auto_device" : "vr_panel.settings.unavailable")}
                onOpen={() => openPicker(label, options, selected.data, setSelected)} />
        );
    };
    return (
        <>
            <SectionLabel label={t("config_page.device.mic_host_device.label")} />
            <ToggleRow label={t("config_page.device.label_auto_select")}
                variable={d.currentEnableAutoMicSelect} onToggle={d.toggleEnableAutoMicSelect} />
            {deviceRow(t("config_page.device.label_host"), d.currentMicHostList, d.currentSelectedMicHost, d.setSelectedMicHost, d.currentEnableAutoMicSelect)}
            {deviceRow(t("config_page.device.label_device"), d.currentMicDeviceOptions, d.currentSelectedMicDeviceId, d.setSelectedMicDeviceId, d.currentEnableAutoMicSelect)}
            <ThresholdRow
                label={t("vr_panel.mic_threshold")} automatic_label={t("vr_panel.automatic")} CheckIcon={MicSvg}
                threshold={d.currentMicThreshold} setThreshold={d.setMicThreshold}
                automatic={d.currentEnableAutomaticMicThreshold} toggleAutomatic={d.toggleEnableAutomaticMicThreshold}
                check_status={v.currentMicThresholdCheckStatus} startCheck={v.volumeCheckStart_Mic} stopCheck={v.volumeCheckStop_Mic}
                volume={currentMicVolume.data}
                min={ui_configs.mic_threshold_min} max={ui_configs.mic_threshold_max} step={THRESHOLD_STEP}
            />
            <VrcMicMuteSyncRow t={t} />
            <SectionLabel label={t("config_page.device.speaker_device.label")} />
            <ToggleRow label={t("config_page.device.label_auto_select")}
                variable={d.currentEnableAutoSpeakerSelect} onToggle={d.toggleEnableAutoSpeakerSelect} />
            {deviceRow(t("config_page.device.label_device"), d.currentSpeakerDeviceOptions, d.currentSelectedSpeakerDeviceId, d.setSelectedSpeakerDeviceId, d.currentEnableAutoSpeakerSelect)}
            <ThresholdRow
                label={t("vr_panel.speaker_threshold")} automatic_label={t("vr_panel.automatic")} CheckIcon={HeadphonesSvg}
                threshold={d.currentSpeakerThreshold} setThreshold={d.setSpeakerThreshold}
                automatic={d.currentEnableAutomaticSpeakerThreshold} toggleAutomatic={d.toggleEnableAutomaticSpeakerThreshold}
                check_status={v.currentSpeakerThresholdCheckStatus} startCheck={v.volumeCheckStart_Speaker} stopCheck={v.volumeCheckStop_Speaker}
                volume={currentSpeakerVolume.data}
                min={ui_configs.speaker_threshold_min} max={ui_configs.speaker_threshold_max} step={THRESHOLD_STEP}
            />
        </>
    );
};

// UIの言語・フォントはデスクトップと共通 (VR UIの表示にも使う)
const AppearanceSettings = ({ t, openPicker }: CategoryProps) => {
    const { i18n } = useI18n();
    const names = createLanguageNames(i18n.language);
    const { currentUiLanguage, setUiLanguage, currentSelectedFontFamily, setSelectedFontFamily } = useAppearance();
    const { currentSelectableFontFamilyList } = useStore_SelectableFontFamilyList();
    const o = useOthers();
    const languages = names.uiOptions(ui_configs.selectable_ui_languages);
    const label = t("config_page.appearance.ui_language.label");
    const font_label = t("config_page.appearance.font_family.label");
    const fonts = toOptions(currentSelectableFontFamilyList.data);
    return (
        <>
            <SectionLabel label={t("config_page.appearance.section_label_display")} />
            <SelectRow label={label} value={languages.find(l => l.id === currentUiLanguage.data)?.label ?? currentUiLanguage.data}
                is_pending={currentUiLanguage.state === "pending"}
                onOpen={() => openPicker(label, ui_configs.selectable_ui_languages, currentUiLanguage.data, setUiLanguage, "ui")} />
            <SelectRow label={font_label} value={currentSelectedFontFamily.data}
                is_pending={currentSelectedFontFamily.state === "pending" || currentSelectableFontFamilyList.state === "pending"}
                is_disabled={fonts.length === 0} disabled_reason={t("vr_panel.settings.fonts_unavailable")}
                onOpen={() => openPicker(font_label, fonts, currentSelectedFontFamily.data, setSelectedFontFamily)} />
            <SectionLabel label={t("config_page.others.section_label_reading_aids")} />
            <ToggleRow label={t("config_page.others.convert_message_to_hiragana.label")}
                variable={o.currentConvertMessageToHiragana} onToggle={o.toggleConvertMessageToHiragana} />
            <ToggleRow label={t("config_page.others.convert_message_to_romaji.label")}
                variable={o.currentConvertMessageToRomaji} onToggle={o.toggleConvertMessageToRomaji} />
        </>
    );
};

interface ComputeSettingsProps extends CategoryProps {
    device_list: { state?: string; data?: ComputeDeviceList };
    device: { state?: string; data?: ComputeDeviceChoice };
    setDevice: (device: unknown) => unknown;
    compute_type: { state?: string; data?: string };
    setComputeType: (id: string) => unknown;
    is_pending?: boolean;
}

// デバイス/精度のどちらかが切替中なら両方ロックする。デバイス変更後の精度はバックエンドが更新する。
const ComputeSettings = ({ t, openPicker, device_list, device, setDevice, compute_type, setComputeType, is_pending: is_parent_pending = false }: ComputeSettingsProps) => {
    const { device_labels, selected_device_id, compute_type_labels } = buildComputeDeviceOptions(device_list.data, device.data, t);
    const devices = toOptions(device_labels);
    const types = toOptions(compute_type_labels);
    const device_label = t("config_page.common.compute_device.label_device");
    const type_label = t("config_page.common.compute_device.label_type");
    const is_pending = is_parent_pending || device.state === "pending" || compute_type.state === "pending" || device_list.state === "pending";
    const device_name = isRecord(device.data) ? device.data.device_name : undefined;
    const selected_device_label = labelIn(device_labels, String(selected_device_id)) ?? (typeof device_name === "string" ? device_name : undefined);
    const selected_type_label = labelIn(compute_type_labels, compute_type.data) ?? compute_type.data;
    return (
        <Disclosure label={t("vr_panel.settings.processing")} summary={[selected_device_label, selected_type_label].filter(Boolean).join(" · ")} is_pending={is_pending}>
            <SelectRow label={device_label} value={selected_device_label}
                is_pending={is_pending} is_disabled={devices.length === 0} disabled_reason={t("vr_panel.settings.devices_unavailable")}
                onOpen={() => openPicker(device_label, devices, String(selected_device_id), (id) => {
                    const selected = isRecord(device_list.data) ? device_list.data[id] : undefined;
                    if (selected) setDevice(selected);
                })} />
            <SelectRow label={type_label} value={selected_type_label}
                is_pending={is_pending} is_disabled={types.length === 0} disabled_reason={t("vr_panel.settings.types_unavailable")}
                onOpen={() => openPicker(type_label, types, compute_type.data, setComputeType)} />
        </Disclosure>
    );
};

// One source's three timeouts, with the setters written out (as AI_PROVIDERS).
interface TimeoutRows {
    record: { variable: RowValue; set: (value: number) => unknown };
    phrase: { variable: RowValue; set: (value: number) => unknown };
    maxWords: { variable: RowValue; set: (value: number) => unknown };
}

const TranscriptionSettings = ({ t, openPicker }: CategoryProps) => {
    const tr = useTranscription();
    // Cloud engines appear once their key is registered in the settings page.
    const available = tr.currentSelectableTranscriptionEngines.data || [];
    // The local engine's models and server are set on the PC (Settings → Speech recognition).
    const engines = [{ id: "SpeechCpp", label: t("config_page.transcription.select_transcription_engine.engines.speechcpp") },
        ...CLOUD_TRANSCRIPTION_ENGINES.filter(engine => available.includes(engine.id))
            .map(engine => ({ id: engine.id, label: t(`config_page.transcription.select_transcription_engine.engines.${engine.key}`) }))];
    const engine_label = t("config_page.transcription.select_transcription_engine.label");
    // 区切りの秒数は「記録の上限 ≦ 無音で区切る秒数」でないとバックエンドが受け付けない
    // 関数の名前は組み立てずに書く (AI_PROVIDERS と同じ理由)
    const timeoutRows = (lower: string, rows: TimeoutRows, max_words: number) => {
        const { record, phrase, maxWords } = rows;
        return (
            <>
                <SectionLabel label={t(`config_page.transcription.section_label_${lower}`)} />
                <StepperRow label={t(`config_page.transcription.${lower}_record_timeout.label`)}
                    variable={record.variable} setValue={record.set} min={0} max={Math.min(30, Number(phrase.variable.data))} step={1} />
                <StepperRow label={t(`config_page.transcription.${lower}_phrase_timeout.label`)}
                    variable={phrase.variable} setValue={phrase.set} min={Number(record.variable.data)} max={30} step={1} />
                <StepperRow label={t(`config_page.transcription.${lower}_max_phrase.label`)}
                    variable={maxWords.variable} setValue={maxWords.set} min={0} max={max_words} step={1} />
            </>
        );
    };
    const micRows: TimeoutRows = {
        record: { variable: tr.currentMicRecordTimeout, set: tr.setMicRecordTimeout },
        phrase: { variable: tr.currentMicPhraseTimeout, set: tr.setMicPhraseTimeout },
        maxWords: { variable: tr.currentMicMaxWords, set: tr.setMicMaxWords },
    };
    const speakerRows: TimeoutRows = {
        record: { variable: tr.currentSpeakerRecordTimeout, set: tr.setSpeakerRecordTimeout },
        phrase: { variable: tr.currentSpeakerPhraseTimeout, set: tr.setSpeakerPhraseTimeout },
        maxWords: { variable: tr.currentSpeakerMaxWords, set: tr.setSpeakerMaxWords },
    };
    return (
        <>
            <SelectRow label={engine_label}
                value={engines.find(engine => engine.id === tr.currentSelectedTranscriptionEngine.data)?.label ?? tr.currentSelectedTranscriptionEngine.data}
                is_pending={tr.currentSelectedTranscriptionEngine.state === "pending"}
                onOpen={() => openPicker(engine_label, engines, tr.currentSelectedTranscriptionEngine.data, tr.setSelectedTranscriptionEngine)} />
            {timeoutRows("mic", micRows, 30)}
            {/* The fold says the values in use, as the processing settings' fold does (#614). */}
            <Disclosure label={t("config_page.transcription.section_label_speaker")}
                summary={t("vr_panel.settings.speaker_values", { record: speakerRows.record.variable.data,
                    phrase: speakerRows.phrase.variable.data, max: speakerRows.maxWords.variable.data })}
                is_pending={[speakerRows.record, speakerRows.phrase, speakerRows.maxWords].some(row => row.variable.state === "pending")}>
                {timeoutRows("speaker", speakerRows, 60)}
            </Disclosure>
        </>
    );
};

const TranslationSettings = ({ t, openPicker }: CategoryProps) => {
    const tl = useTranslation();
    // CTranslate2 はダウンロード済みのモデルだけ選べる (ダウンロードはデスクトップで行う)。
    // 非商用ライセンス (NLLB) のモデルは確認ダイアログが必要なので、デスクトップの
    // 設定 > 翻訳 でのみ選べる。既に選択中なら表示はする (ライセンス表記付き)。
    const selected_weight = tl.currentSelectedCTranslate2WeightType;
    // A model the user added has no size or license of its own, and is never non-commercial.
    const weights = (tl.currentCTranslate2WeightTypeStatus.data ?? [])
        .filter(w => w.is_downloaded && (!("non_commercial" in w && isNonCommercialWeight(w)) || w.id === selected_weight.data))
        .map(w => {
            const capacity = "capacity" in w ? w.capacity : undefined;
            const license = "license" in w ? w.license : undefined;
            return { id: w.id, label: "non_commercial" in w && isNonCommercialWeight(w) ? `${w.id} (${capacity}, ${license})` : `${w.id} (${capacity})` };
        });
    const ct2_label = t("config_page.translation.ctranslate2_weight_type.label");
    return (
        <>
            <SelectRow label={ct2_label} value={selected_weight.data} is_pending={selected_weight.state === "pending"}
                is_disabled={weights.length === 0} disabled_reason={t("vr_panel.settings.prepare_model")}
                onOpen={() => openPicker(ct2_label, weights, selected_weight.data, tl.setSelectedCTranslate2WeightType)} />
            <ComputeSettings t={t} openPicker={openPicker}
                device_list={tl.currentSelectableTranslationComputeDeviceList}
                device={tl.currentSelectedTranslationComputeDevice} setDevice={tl.setSelectedTranslationComputeDevice}
                compute_type={tl.currentSelectedTranslationComputeType} setComputeType={tl.setSelectedTranslationComputeType} />
            {AI_PROVIDERS.map((provider) => {
                const options = toOptions(provider.list(tl).data);
                if (options.length === 0) return null;
                const selected = provider.selected(tl);
                const label = t(`config_page.translation.select_${provider.i18n}_model.label`);
                const value = typeof selected.data === "string" ? selected.data : undefined;
                return (
                    <SelectRow key={provider.i18n} label={label} value={value} is_pending={selected.state === "pending"}
                        onOpen={() => openPicker(label, options, selected.data, provider.set(tl))} />
                );
            })}
        </>
    );
};

const VrSettings = ({ t }: { t: Translate }) => {
    const vr = useVr();
    const opacity = vr.currentOverlayVrPanelOpacity;
    // VR UI 自体のON/OFFはここに置かない (VRの中で消すと戻せなくなる。デスクトップの設定で行う)
    return (
        <>
            <SectionLabel label={t("vr_panel.settings.ui_log")} />
            <StepperRow label={t("vr_panel.log_opacity")} variable={opacity} setValue={vr.setOverlayVrPanelOpacity}
                min={0.2} max={1.0} step={0.1} format={(v) => `${Math.round(v * 100)}%`} />
            <SectionLabel label={t("vr_panel.settings.subtitle_overlay")} />
            <ToggleRow label={t("vr_panel.overlay_small_log")} variable={vr.currentIsEnabledOverlaySmallLog}
                onToggle={vr.toggleIsEnabledOverlaySmallLog} />
            <ToggleRow label={t("vr_panel.overlay_large_log")} variable={vr.currentIsEnabledOverlayLargeLog}
                onToggle={vr.toggleIsEnabledOverlayLargeLog} />
            <ToggleRow label={t("config_page.vr.overlay_show_only_translated_messages.label")}
                variable={vr.currentOverlayShowOnlyTranslatedMessages} onToggle={vr.toggleOverlayShowOnlyTranslatedMessages} />

            <SectionLabel label={t("vr_panel.launcher")} />
            {/* Each hand is drawn as the toolbar draws it, so the choice needs no line under its name (#614). */}
            <SegmentRow label={t("vr_panel.launcher_hand")}
                variable={vr.currentOverlayVrLauncherHand} onSelect={vr.setOverlayVrLauncherHand}
                options={[
                    { id: "LeftHand", label: t("vr_panel.anchor_left_hand"), icon: <VrHandIcon className={styles.segment_icon} /> },
                    { id: "RightHand", label: t("vr_panel.anchor_right_hand"), icon: <VrHandIcon right className={styles.segment_icon} /> },
                ]} />
            <ToggleRow label={t("vr_panel.launcher_auto_hide")}
                variable={vr.currentOverlayVrLauncherAutoHide} onToggle={vr.toggleOverlayVrLauncherAutoHide} />
            <ToggleRow label={t("vr_panel.tooltip_enabled")} sub={t("vr_panel.tooltip_enabled_desc")}
                variable={vr.currentOverlayVrTooltip} onToggle={vr.toggleOverlayVrTooltip} />
        </>
    );
};

// デスクトップと同じく、デバイスとVRChatの両方から同じ設定を操作する。
const VrcMicMuteSyncRow = ({ t }: { t: Translate }) => {
    const o = useOthers();
    const { currentIsOscAvailable, oscUnavailableLabelKey } = useIsOscAvailable();
    return (
        <ToggleRow label={t("config_page.others.vrc_mic_mute_sync.label")}
            variable={o.currentEnableVrcMicMuteSync} onToggle={o.toggleEnableVrcMicMuteSync}
            is_disabled={currentIsOscAvailable.data === false}
            disabled_reason={t(oscUnavailableLabelKey)} />
    );
};

const VrchatSettings = ({ t, openPicker }: CategoryProps) => {
    const o = useOthers();
    // 関数の名前は組み立てずに書く (AI_PROVIDERS と同じ理由)
    const toggle = (key: string, variable: RowValue, onToggle: () => void) => (
        <ToggleRow label={t(`config_page.others.${key}.label`)} variable={variable} onToggle={onToggle} />
    );
    return (
        <>
            <SectionLabel label={t("config_page.vrchat.section_label_chatbox")} />
            {toggle("send_message_to_vrc", o.currentEnableSendMessageToVrc, o.toggleEnableSendMessageToVrc)}
            {toggle("send_only_translated_messages", o.currentEnableSendOnlyTranslatedMessages, o.toggleEnableSendOnlyTranslatedMessages)}
            {toggle("notification_vrc_sfx", o.currentEnableNotificationVrcSfx, o.toggleEnableNotificationVrcSfx)}
            {toggle("send_received_message_to_vrc", o.currentEnableSendReceivedMessageToVrc, o.toggleEnableSendReceivedMessageToVrc)}
            <VrcMicMuteSyncRow t={t} />
            <SectionLabel label={t("config_page.ocr.section_title")} />
            <OcrSettings t={t} openPicker={openPicker} />
        </>
    );
};

// チャット読み取りのON/OFFは機能の切り替えなので、ここには置かない (ランチャーで行う)
const OcrSettings = ({ t, openPicker }: CategoryProps) => {
    const { i18n } = useI18n();
    const names = createLanguageNames(i18n.language);
    const languageLabel = (id: string) => id === "auto" ? t("config_page.ocr.source_language.auto") : names.language(id);
    const ocr = useOcr();
    const languages = ocr.currentSelectableOcrSourceLanguageList.data ?? {};
    const language = ocr.currentOcrSourceLanguage;
    const language_label = t("config_page.ocr.source_language.label");
    return (
        <>
            <SelectRow label={language_label} value={languageLabel(language.data)}
                is_pending={language.state === "pending"}
                onOpen={() => openPicker(language_label, toOptions(languages), language.data, ocr.setOcrSourceLanguage, "ocr")} />
            <StepperRow label={t("config_page.ocr.poll_interval_ms.label")} variable={ocr.currentOcrPollIntervalMs}
                setValue={ocr.setOcrPollIntervalMs} min={100} max={5000} step={50} format={(v) => `${v} ms`} />
            <StepperRow label={t("config_page.ocr.min_confidence.label")} variable={ocr.currentOcrMinConfidence}
                setValue={ocr.setOcrMinConfidence} min={0.1} max={0.99} step={0.01} format={(v) => v.toFixed(2)} />
            <StepperRow label={t("config_page.ocr.bubble_min_text_length.label")} variable={ocr.currentOcrBubbleMinTextLength}
                setValue={ocr.setOcrBubbleMinTextLength} min={1} max={50} step={1} />
        </>
    );
};

// A long name breaks before its short name in brackets, never inside a word.
const CategoryName = ({ text }: { text: string }) => {
    const { name, abbr } = splitFeatureLabel(text);
    return <span className={styles.category_label}>{name}{abbr && <span className={styles.category_abbr}>{abbr}</span>}</span>;
};
