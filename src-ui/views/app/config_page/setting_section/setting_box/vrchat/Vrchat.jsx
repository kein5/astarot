import { useI18n } from "@useI18n";
import styles from "./Vrchat.module.scss";

import { SectionLabelComponent } from "../_components";
import {
    SendMessageToVrcContainer,
    SendOnlyTranslatedMessagesContainer,
    EnableNotificationVrcSfxContainer,
    SendReceivedMessageToVrcContainer,
    VrcMicMuteSyncContainer,
    SendMessageFormatPartsContainer,
    ReceivedMessageFormatPartsContainer,
} from "../shared_items/SharedItems";
import { VoiceRouteSettings } from "../device/VoiceRouteSettings";
import { TtsOutputDeviceSettings } from "../advanced_settings/VoiceSettings";
import { useStore_SelectedConfigTabId } from "@store";
import { Description } from "../_components/description/Description";
import { VrchatPresence } from "../../../../others/vrchat_presence/VrchatPresence";
import { PagePointer } from "../_components/page_pointer/PagePointer";

// What goes to VRChat: the chatbox and the voice that reaches VRChat's
// microphone. The OSC address and port are under Advanced. The voice route, the TTS output device and mic mute sync also
// stay on their own pages. Reading VRChat's chatbox has a page of its own,
// named like its switch on the main page; this page ends with the way there.
export const Vrchat = () => {
    const { t } = useI18n();
    return (
        <div className={styles.container}>
            <div>
                <SectionLabelComponent label={t("config_page.vrchat.section_label_chatbox")} />
                {/* Whether a message sent now can arrive: the first thing to check on this page. */}
                <VrchatPresence />
                <SendMessageToVrcContainer />
                <SendOnlyTranslatedMessagesContainer />
                <EnableNotificationVrcSfxContainer />
                <SendReceivedMessageToVrcContainer />
                <VrcMicMuteSyncContainer />
            </div>
            <div>
                <SectionLabelComponent label={t("config_page.others.section_label_message_formats")} />
                <SendMessageFormatPartsContainer />
                <ReceivedMessageFormatPartsContainer />
            </div>
            {/* Whether VRChat is found, and the step that turns its OSC on, open the page (above).
                Where the messages go is set once, if ever: under Advanced, with the other
                connections to other software (#554, Q-06). */}
            <PagePointer label={t("config_page.vrchat.osc_pointer.label")} description={t("config_page.vrchat.osc_pointer.desc")}
                tab="advanced_settings" button={t("config_page.vrchat.open_advanced_settings")} />
            <VoiceRouteSettings />
            <TtsOutputDeviceSettings title={t("config_page.vrchat.section_label_tts_output")} />
            <ChatReadingPointer />
        </div>
    );
};

const ChatReadingPointer = () => {
    const { t } = useI18n();
    const { updateSelectedConfigTabId } = useStore_SelectedConfigTabId();
    return (
        <div>
            <SectionLabelComponent label={t("config_page.side_menu_labels.ocr")} />
            <Description text={t("config_page.vrchat.chat_reading_moved")} />
            <button type="button" className={styles.open_page} onClick={() => updateSelectedConfigTabId("ocr")}>
                {t("config_page.vrchat.open_chat_reading")}
            </button>
        </div>
    );
};
