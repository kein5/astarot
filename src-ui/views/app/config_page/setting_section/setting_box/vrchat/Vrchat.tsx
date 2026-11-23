import { useI18n } from "@useI18n";
import * as styles from "./Vrchat.css.ts";

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
import { VoiceRouteSummary } from "../device/VoiceRouteSettings";
import { AdvancedSection } from "../_components/advanced_section/AdvancedSection";
import { useOthers } from "@logics_configs";
import type { AtomState } from "@store";
import { VrchatPresence } from "../../../../others/vrchat_presence/VrchatPresence";
import { PagePointer, PageLinkButton } from "../_components/page_pointer/PagePointer";
import { HintDescriptions } from "../_components/hint/Hint";

// What goes to VRChat: the chatbox first, as a first conversation needs it. What is set once
// (the notification sound, mute sync, the message formats) is in 「詳細設定」, with the rows that
// lead to the settings VRChat also uses but that live on their own pages: where messages go
// (Advanced, Q-06), the voice route (Device) and the speech output (TTS) (#554, IA-03).
// Reading VRChat's chatbox has a page of its own, named like its switch on the main page;
// this page ends with the way there.
export const Vrchat = () => {
    const { t } = useI18n();
    const { currentEnableNotificationVrcSfx, currentEnableVrcMicMuteSync } = useOthers();
    const onOff = (current: AtomState<boolean>) => t(current.data === true ? "config_page.advanced_status.on" : "config_page.advanced_status.off");
    // Reviewed against #614: the rows' descriptions are their labels' hints.
    return (
        <HintDescriptions>
        <div className={styles.container}>
            <div>
                <SectionLabelComponent label={t("config_page.vrchat.section_label_chatbox")} />
                {/* Whether a message sent now can arrive, with the step that turns OSC on: the first thing to check on this page. */}
                <VrchatPresence />
                <SendMessageToVrcContainer />
                <SendOnlyTranslatedMessagesContainer />
            </div>
            <AdvancedSection status={t("config_page.advanced_status.vrchat", {
                sfx: onOff(currentEnableNotificationVrcSfx), sync: onOff(currentEnableVrcMicMuteSync) })}>
                <div>
                    <SectionLabelComponent sub label={t("config_page.vrchat.section_label_more")} />
                    <EnableNotificationVrcSfxContainer />
                    <SendReceivedMessageToVrcContainer />
                    <VrcMicMuteSyncContainer />
                </div>
                <div>
                    <SectionLabelComponent sub label={t("config_page.others.section_label_message_formats")} />
                    <SendMessageFormatPartsContainer />
                    <ReceivedMessageFormatPartsContainer />
                </div>
                <div>
                    <SectionLabelComponent sub label={t("config_page.vrchat.section_label_elsewhere")} />
                    <PagePointer label={t("config_page.vrchat.osc_pointer.label")} description={t("config_page.vrchat.osc_pointer.desc")}
                        tab="advanced_settings" action={t("config_page.vrchat.osc_pointer.action")} />
                    <VoiceRouteSummary />
                    <PagePointer label={t("config_page.vrchat.section_label_tts_output")} description={t("config_page.vrchat.tts_output_pointer")}
                        tab="tts" action={t("config_page.vrchat.tts_output_action")} />
                </div>
            </AdvancedSection>
            <ChatReadingPointer />
        </div>
        </HintDescriptions>
    );
};

// The heading and a button that names the page say it all (#614): no sentence repeats where
// the settings are.
const ChatReadingPointer = () => {
    const { t } = useI18n();
    return (
        <div>
            <SectionLabelComponent label={t("config_page.side_menu_labels.ocr")} />
            <PageLinkButton tab="ocr" className={styles.chat_reading_link} />
        </div>
    );
};
