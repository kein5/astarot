import type { ReactNode } from "react";
import { useStore_SelectedConfigTabId } from "@store";
import { useSettingValue } from "@logics_configs";
import { isExperimentalFeatureEnabled } from "../../../../../logics/configs/experimentalFeatures.ts";

import {
    Device, Tts, Rvc,
    Appearance,
    Translation,
    Transcription,
    Vrchat,
    Ocr,
    AdvancedSettings,
    Vr,
    Hotkeys,
    AboutVrct,
    Updater,
    ExperimentalFeatures,
    TalkAi,
} from "@setting_box";

export const SettingBox = () => {
    const { currentSelectedConfigTabId } = useStore_SelectedConfigTabId();
    switch (currentSelectedConfigTabId.data) {
        case "tts": return <Tts />;
        case "rvc": return <Rvc />;
        case "device":
            return <Device />;
        case "appearance":
            return <Appearance />;
        case "translation":
            return <Translation />;
        case "transcription":
            return <Transcription />;
        case "vr":
            return <Vr />;
        case "hotkeys":
            return <Hotkeys />;
        case "advanced_settings":
            return <AdvancedSettings />;
        case "experimental_features":
            return <ExperimentalFeatures />;
        case "updater":
            return <Updater />;
        // The main page has a chat reading switch, so settings have a page of that
        // name. The VRChat page points to it, and holds the old "others" page.
        case "ocr":
            return <Ocr />;
        case "vrchat":
        case "others":
            return <Vrchat />;
        case "about_vrct":
            return <AboutVrct />;
        case "talk_ai":
            return <FeaturePage feature="talk_ai"><TalkAi /></FeaturePage>;

        default:
            return null;
    }
};

// A page that exists only while its experimental feature is on (settingsMenu.ts, FEATURE_TABS).
// Turned off, nothing of it is drawn; the menu then opens the experimental features page, where
// its switch is (SidebarSection.tsx).
const FeaturePage = ({ feature, children }: { feature: string; children: ReactNode }) => {
    const { data } = useSettingValue("ExperimentalFeatures");
    return isExperimentalFeatureEnabled(data, feature) ? children : null;
};
