import { isEdge, type Edge } from "./hexagram.ts";

// The tray companion (experimental feature "tray_companion", Issue #355). The main window
// reports only the switches and the words the tray menu needs; never what was said or typed.
// The shapes match `Status` in src-tauri/src/companion.rs.

const LANGUAGES = ["en", "ja", "ko", "zh-Hans", "zh-Hant"] as const;
export type Language = (typeof LANGUAGES)[number];

export type Switch = { on: boolean; pending: boolean };

export type MenuLabels = {
    start: string; stop: string; panel: string; main: string; quit: string;
    // The monitor submenu: its title, the primary monitor, the word before a monitor's number,
    // and a chosen monitor that is not connected now.
    monitor: string; primary: string; display: string; missing: string;
};

// The six main switches, in the order the handle's hexagram shows them clockwise from the top.
export const FEATURES = ["mic", "translation", "tts", "rvc", "listening", "ocr"] as const;
export type Feature = (typeof FEATURES)[number];

export type CompanionStatus = {
    ready: boolean;
    language: Language;
    menu: MenuLabels;
    // The screen edge the hexagram hides at (TRAY_COMPANION_EDGE).
    edge: Edge;
    // The monitor it shows on, by the system's name for it; empty for the primary one
    // (TRAY_COMPANION_MONITOR).
    monitor: string;
} & Record<Feature, Switch>;

// A store value as the main window's hooks hand it over: { state: "ok" | "pending", data }.
type StoreValue = { state?: string; data?: unknown } | null | undefined;

// What the panel, the hexagram and the tray may ask the main window to do: one toggle per switch,
// and (from the hexagram's common settings) the edge the hexagram hides at.
export type ToggleAction = `toggle_${Feature}`;
export type EdgeAction = `edge_${Edge}`;
// A monitor chosen in the tray menu: `monitor:<name>`, empty for the primary monitor.
export type MonitorAction = `monitor:${string}`;
export type CompanionAction = ToggleAction | EdgeAction | MonitorAction;
export const actionFor = (feature: Feature): ToggleAction => `toggle_${feature}`;
export const edgeAction = (edge: Edge): EdgeAction => `edge_${edge}`;

// What the panel shows as the state of the app as a whole.
export type PanelState = "starting" | "listening" | "idle";

const toSwitch = (value: StoreValue): Switch => ({ on: value?.data === true, pending: value?.state === "pending" });

const isLanguage = (value: unknown): value is Language => (LANGUAGES as readonly unknown[]).includes(value);

export const companionStatus = ({ ready, mic, translation, listening, ocr, tts, rvc, edge, monitor, language, t }: {
    ready: unknown;
    mic: StoreValue;
    translation: StoreValue;
    listening?: StoreValue;
    ocr?: StoreValue;
    // Already worked out by the main page's switches (logics/voice/voiceActions.ts).
    tts?: Switch;
    rvc?: Switch;
    edge?: unknown;
    monitor?: unknown;
    language: unknown;
    t: (key: string) => string;
}): CompanionStatus => ({
    ready: ready === true,
    mic: toSwitch(mic),
    translation: toSwitch(translation),
    listening: toSwitch(listening),
    ocr: toSwitch(ocr),
    tts: { on: tts?.on === true, pending: tts?.pending === true },
    rvc: { on: rvc?.on === true, pending: rvc?.pending === true },
    language: isLanguage(language) ? language : "en",
    edge: isEdge(edge) ? edge : "right",
    monitor: typeof monitor === "string" ? monitor : "",
    menu: {
        start: t("companion.menu_start"),
        stop: t("companion.menu_stop"),
        panel: t("companion.menu_panel"),
        main: t("companion.menu_main"),
        quit: t("companion.menu_quit"),
        monitor: t("companion.menu_monitor"),
        primary: t("companion.menu_monitor_primary"),
        display: t("companion.menu_monitor_display"),
        missing: t("companion.menu_monitor_missing"),
    },
});

export const panelState = (status: CompanionStatus | null): PanelState => {
    if (!status?.ready) return "starting";
    return status.mic.on ? "listening" : "idle";
};

export type Toggles = {
    toggleTranscriptionSend: () => void;
    toggleTranslation: () => void;
    toggleTranscriptionReceive?: () => void;
    toggleOcrCapture?: () => void;
    // The main page's own handlers, with their checks and notices; null before it has rendered.
    toggleTts?: (() => unknown) | null;
    toggleRvc?: (() => unknown) | null;
    // Save TRAY_COMPANION_EDGE and TRAY_COMPANION_MONITOR, as the experimental features page does.
    setEdge?: (edge: Edge) => unknown;
    setMonitor?: (monitor: string) => unknown;
};

// Requests the panel, the handle and the tray may queue; anything else is ignored. Each one
// runs the same toggle as the main window's switch, so its consents and checks still apply.
export const runAction = (action: unknown, toggles: Toggles): boolean => {
    // The app checked the monitor against those connected before queuing it.
    if (typeof action === "string" && action.startsWith("monitor:")) {
        if (!toggles.setMonitor) return false;
        toggles.setMonitor(action.slice("monitor:".length));
        return true;
    }
    if (typeof action === "string" && action.startsWith("edge_")) {
        const edge = action.slice("edge_".length);
        if (!isEdge(edge) || !toggles.setEdge) return false;
        toggles.setEdge(edge);
        return true;
    }
    const run: Record<ToggleAction, (() => unknown) | null | undefined> = {
        toggle_mic: toggles.toggleTranscriptionSend,
        toggle_translation: toggles.toggleTranslation,
        toggle_listening: toggles.toggleTranscriptionReceive,
        toggle_ocr: toggles.toggleOcrCapture,
        toggle_tts: toggles.toggleTts,
        toggle_rvc: toggles.toggleRvc,
    };
    const toggle = typeof action === "string" && Object.hasOwn(run, action) ? run[action as ToggleAction] : undefined;
    if (!toggle) return false;
    toggle();
    return true;
};
