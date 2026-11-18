import { useHotkeys } from "@logics_configs";
import styles from "./Hotkeys.module.scss";
import { HotkeysEntryContainer } from "../_templates/Templates";
import { useI18n } from "@useI18n";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useIsOpenedConfigPage } from "@logics_common";
import { EnvReadout } from "../_components/env_readout/EnvReadout";
import { SectionLabelComponent } from "../_components";
import { AdvancedSection } from "../_components/advanced_section/AdvancedSection";
// The hotkeys a conversation cannot wait for, stop and mute, are in sight; the others are set
// once, in 「詳細設定」, whose line says how many of them have a key (#554).
const ADVANCED_HOTKEYS = ["open_quick_chat", "toggle_vrct_visibility", "toggle_translation",
    "toggle_transcription_send", "toggle_transcription_receive", "toggle_tts", "toggle_rvc"];

export const Hotkeys = () => {
    const { t } = useI18n();
    const { currentHotkeys } = useHotkeys();
    const assigned = ADVANCED_HOTKEYS.filter(id => !!currentHotkeys.data?.[id]?.length).length;
    return (
        <div className={styles.container}>
            <p className={styles.disabled_notice}>{t("config_page.hotkeys.disabled_notice")}</p>
            <StopHotkeysContainer />
            <AdvancedSection status={t("config_page.advanced_status.hotkeys", { count: assigned })}>
                <QuickChatHotkeyContainer />
                <ToggleHotkeysContainer />
            </AdvancedSection>
        </div>
    );
};

// Stop and mute first: they are the ones a conversation cannot wait for.
const StopHotkeysContainer = () => {
    const { t } = useI18n();
    const { currentHotkeys, setHotkeys } = useHotkeys();
    const rows = [
        ["stop_voice", t("config_page.hotkeys.stop_voice.label")],
        ["toggle_voice_mute", t("config_page.hotkeys.toggle_voice_mute.label")],
    ];
    return (
        <div className={styles.container}>
            <SectionLabelComponent label={t("config_page.hotkeys.section_label_stop")} />
            {rows.map(([hotkey_id, label]) => <HotkeysEntryContainer key={hotkey_id} label={label} hotkey_id={hotkey_id}
                value={currentHotkeys.data} state={currentHotkeys.state} setHotkeys={setHotkeys} />)}
        </div>
    );
};

const QuickChatHotkeyContainer = () => {
    const { t } = useI18n();
    const { currentHotkeys, setHotkeys, openQuickChat } = useHotkeys();
    const { setIsOpenedConfigPage } = useIsOpenedConfigPage();
    const [platform, setPlatform] = useState(null);
    useEffect(() => {
        invoke("quick_chat_shortcut_platform").then(setPlatform).catch(() => setPlatform("unknown"));
    }, []);

    return (
        <div className={styles.container}>
            <SectionLabelComponent sub label={t("config_page.hotkeys.section_label_quick_chat")} />
            <HotkeysEntryContainer
                label={t("quick_chat.label")}
                hotkey_id="open_quick_chat"
                value={currentHotkeys.data}
                state={currentHotkeys.state}
                setHotkeys={setHotkeys}
            />
            <p className={styles.quick_chat_notice}>{t("quick_chat.shortcut_hint")}</p>
            {["wayland", "xwayland", "unknown"].includes(platform) && <EnvReadout className={styles.platform_readout}>
                <p>{t({ wayland: "quick_chat.wayland_portal", xwayland: "quick_chat.xwayland_hint", unknown: "quick_chat.platform_unknown" }[platform])}</p>
            </EnvReadout>}
            <button type="button" className={styles.open_quick_chat} onClick={() => { setIsOpenedConfigPage(false); openQuickChat(); }}>
                {t("quick_chat.open")}
            </button>
        </div>
    );
};

const ToggleHotkeysContainer = () => {
    const { t } = useI18n();
    const { currentHotkeys, setHotkeys } = useHotkeys();

    return (
        <div className={styles.container}>
            <SectionLabelComponent sub label={t("config_page.hotkeys.section_label_toggles")} />
            <HotkeysEntryContainer
                label={t("config_page.hotkeys.toggle_vrct_visibility.label")}
                hotkey_id="toggle_vrct_visibility"
                value={currentHotkeys.data}
                state={currentHotkeys.state}
                setHotkeys={setHotkeys}
            />
            <HotkeysEntryContainer
                label={t("config_page.hotkeys.toggle_translation.label", {translation: t("main_page.translation")})}
                hotkey_id="toggle_translation"
                value={currentHotkeys.data}
                state={currentHotkeys.state}
                setHotkeys={setHotkeys}
            />
            <HotkeysEntryContainer
                label={t("config_page.hotkeys.toggle_transcription_send.label", {transcription_send: t("main_page.transcription_send")})}
                hotkey_id="toggle_transcription_send"
                value={currentHotkeys.data}
                state={currentHotkeys.state}
                setHotkeys={setHotkeys}
            />
            <HotkeysEntryContainer
                label={t("config_page.hotkeys.toggle_transcription_receive.label", {transcription_receive: t("main_page.transcription_receive")})}
                hotkey_id="toggle_transcription_receive"
                value={currentHotkeys.data}
                state={currentHotkeys.state}
                setHotkeys={setHotkeys}
            />
            {/* The voice switches, named like the main page's. */}
            {[["toggle_tts", "main_page.tts"], ["toggle_rvc", "main_page.rvc"]].map(([hotkey_id, name]) =>
                <HotkeysEntryContainer key={hotkey_id} label={t("config_page.hotkeys.toggle_voice_switch.label", { name: t(name) })}
                    hotkey_id={hotkey_id} value={currentHotkeys.data} state={currentHotkeys.state} setHotkeys={setHotkeys} />)}
        </div>
    );
};
