// The experimental companion form (Issue #355). The main window reports only the
// switches and the words the tray menu needs; never what was said or typed.

const LANGUAGES = ["en", "ja", "ko", "zh-Hans", "zh-Hant"];

const toSwitch = value => ({ on: value?.data === true, pending: value?.state === "pending" });

export const companionStatus = ({ ready, mic, translation, language, t }) => ({
    ready: ready === true,
    mic: toSwitch(mic),
    translation: toSwitch(translation),
    language: LANGUAGES.includes(language) ? language : "en",
    menu: {
        start: t("companion.menu_start"),
        stop: t("companion.menu_stop"),
        panel: t("companion.menu_panel"),
        main: t("companion.menu_main"),
        quit: t("companion.menu_quit"),
    },
});

// What the panel says about the app as a whole.
export const panelState = status => {
    if (!status?.ready) return "starting";
    return status.mic.on ? "listening" : "idle";
};

// Requests the panel and the tray may queue; anything else is ignored.
export const runAction = (action, { toggleTranscriptionSend, toggleTranslation }) => {
    if (action === "toggle_mic") toggleTranscriptionSend();
    else if (action === "toggle_translation") toggleTranslation();
    else return false;
    return true;
};
