import { useHotkeys } from "@logics_configs";
import * as styles from "./Hotkeys.css.ts";
import { HotkeysEntryContainer } from "../_templates/Templates";
import { useI18n } from "@useI18n";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useIsOpenedConfigPage } from "@logics_common";
import { EnvReadout } from "../_components/env_readout/EnvReadout";
import { SectionLabelComponent } from "../_components";
import { AdvancedSection } from "../_components/advanced_section/AdvancedSection";
import { HintDescriptions } from "../_components/hint/Hint";
import { Button } from "../../../../../kit/index.ts";
import { handOverQuickChat, isSettingsWindow, showingHotkeysPage } from "../../../../../../logics/common/settingsWindow.ts";
// The hotkeys a conversation cannot wait for, stop and mute, are in sight; the others are set
// once, in 「詳細設定」, whose line says how many of them have a key (#554).
// The platforms whose quick chat key gets a note under it: quick_chat_shortcut_platform answers
// "wayland", "xwayland" or "native", and the page takes "unknown" when it could not ask.
type PlatformNote = "wayland" | "xwayland" | "unknown";
const isPlatformNote = (platform: string | null): platform is PlatformNote =>
    platform === "wayland" || platform === "xwayland" || platform === "unknown";

const ADVANCED_HOTKEYS = ["open_quick_chat", "toggle_vrct_visibility", "toggle_translation",
    "toggle_transcription_send", "toggle_transcription_receive", "toggle_tts", "toggle_rvc"];

export const Hotkeys = () => {
    const { t } = useI18n();
    const { currentHotkeys } = useHotkeys();
    const assigned = ADVANCED_HOTKEYS.filter(id => !!currentHotkeys.data?.[id]?.length).length;
    // The hotkeys wait while this page is shown, so a key pressed to record it does not act. In a
    // page of the main window they wait while the settings are open; in the settings window
    // (#1236) the main window, which runs them, pauses them until this page goes.
    useEffect(() => {
        if (!isSettingsWindow()) return undefined;
        showingHotkeysPage(true).catch(error => console.error("The hotkeys could not be paused", error));
        return () => { showingHotkeysPage(false).catch(error => console.error("The hotkeys could not be resumed", error)); };
    }, []);
    // Reviewed against #614: what the hotkeys do while this page is open is a state, said by a
    // readout; the quick chat row's notes are its label's hint.
    return (
        <HintDescriptions>
        <div className={styles.container}>
            <EnvReadout className={styles.disabled_notice} live={false}><p>{t("config_page.hotkeys.disabled_notice")}</p></EnvReadout>
            <StopHotkeysContainer />
            <AdvancedSection status={t("config_page.advanced_status.hotkeys", { count: assigned })}>
                <QuickChatHotkeyContainer />
                <ToggleHotkeysContainer />
            </AdvancedSection>
        </div>
        </HintDescriptions>
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
    const [platform, setPlatform] = useState<string | null>(null);
    useEffect(() => {
        invoke<string>("quick_chat_shortcut_platform").then(setPlatform).catch(() => setPlatform("unknown"));
    }, []);

    return (
        <div className={styles.container}>
            <SectionLabelComponent sub label={t("config_page.hotkeys.section_label_quick_chat")} />
            <HotkeysEntryContainer
                label={t("quick_chat.label")}
                desc={t("quick_chat.shortcut_hint")}
                hotkey_id="open_quick_chat"
                value={currentHotkeys.data}
                state={currentHotkeys.state}
                setHotkeys={setHotkeys}
            />
            {isPlatformNote(platform) && <EnvReadout className={styles.platform_readout}>
                <p>{t({ wayland: "quick_chat.wayland_portal", xwayland: "quick_chat.xwayland_hint", unknown: "quick_chat.platform_unknown" }[platform])}</p>
            </EnvReadout>}
            {/* In a page of the main window, Quick Chat opens once the settings have closed. The
                settings window stays open and leaves the opening to the main window, which runs
                Quick Chat (#1236). */}
            <Button className={styles.open_quick_chat} onClick={() => {
                if (isSettingsWindow()) {
                    handOverQuickChat().catch(error => console.error("Quick Chat could not be handed over", error));
                    return;
                }
                setIsOpenedConfigPage(false);
                openQuickChat();
            }}>
                {t("quick_chat.open")}
            </Button>
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
