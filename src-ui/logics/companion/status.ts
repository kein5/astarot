// The tray companion (experimental feature "tray_companion", Issue #355). The main window
// reports only the switches and the words the tray menu needs; never what was said or typed.
// The shapes match `Status` in src-tauri/src/companion.rs.

const LANGUAGES = ["en", "ja", "ko", "zh-Hans", "zh-Hant"] as const;
export type Language = (typeof LANGUAGES)[number];

export type Switch = { on: boolean; pending: boolean };

export type MenuLabels = { start: string; stop: string; panel: string; main: string; quit: string };

export type CompanionStatus = {
    ready: boolean;
    mic: Switch;
    translation: Switch;
    language: Language;
    menu: MenuLabels;
};

// A store value as the main window's hooks hand it over: { state: "ok" | "pending", data }.
type StoreValue = { state?: string; data?: unknown } | null | undefined;

// What the panel and the tray may ask the main window to do.
export type CompanionAction = "toggle_mic" | "toggle_translation";

// What the panel shows as the state of the app as a whole.
export type PanelState = "starting" | "listening" | "idle";

const toSwitch = (value: StoreValue): Switch => ({ on: value?.data === true, pending: value?.state === "pending" });

const isLanguage = (value: unknown): value is Language => (LANGUAGES as readonly unknown[]).includes(value);

export const companionStatus = ({ ready, mic, translation, language, t }: {
    ready: unknown;
    mic: StoreValue;
    translation: StoreValue;
    language: unknown;
    t: (key: string) => string;
}): CompanionStatus => ({
    ready: ready === true,
    mic: toSwitch(mic),
    translation: toSwitch(translation),
    language: isLanguage(language) ? language : "en",
    menu: {
        start: t("companion.menu_start"),
        stop: t("companion.menu_stop"),
        panel: t("companion.menu_panel"),
        main: t("companion.menu_main"),
        quit: t("companion.menu_quit"),
    },
});

export const panelState = (status: CompanionStatus | null): PanelState => {
    if (!status?.ready) return "starting";
    return status.mic.on ? "listening" : "idle";
};

// Requests the panel and the tray may queue; anything else is ignored.
export const runAction = (action: unknown, { toggleTranscriptionSend, toggleTranslation }: {
    toggleTranscriptionSend: () => void;
    toggleTranslation: () => void;
}): boolean => {
    if (action === "toggle_mic") toggleTranscriptionSend();
    else if (action === "toggle_translation") toggleTranslation();
    else return false;
    return true;
};
