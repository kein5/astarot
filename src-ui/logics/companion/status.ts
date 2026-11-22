import { isEdge, type Edge } from "./hexagram.ts";

// The tray companion (experimental feature "tray_companion", Issue #355). The main window
// reports only the switches and the words the tray menu needs; never what was said or typed.
// The shapes match `Status` in src-tauri/src/companion.rs.

const LANGUAGES = ["en", "ja", "ko", "zh-Hans", "zh-Hant"] as const;
export type Language = (typeof LANGUAGES)[number];

// blocked: its main switch is greyed out with a reason (logics/main/switchBlocks.ts), so turning it
// on is refused; pressing it still asks, and the main window says why (#562).
export type Switch = { on: boolean; pending: boolean; blocked: boolean };

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
    // Whether the hexagram has told that the wheel turns it (TRAY_COMPANION_WHEEL_HINT_SHOWN);
    // null until the main window has the setting (#536).
    hinted: boolean | null;
} & Record<Feature, Switch>;

// A store value as the main window's hooks hand it over: { state: "ok" | "pending", data }.
type StoreValue = { state?: string; data?: unknown } | null | undefined;

// What the panel, the hexagram and the tray may ask the main window to do: one toggle per switch,
// and (from the hexagram's common settings) the edge the hexagram hides at.
export type ToggleAction = `toggle_${Feature}`;
export type EdgeAction = `edge_${Edge}`;
// A monitor chosen in the tray menu: `monitor:<name>`, empty for the primary monitor.
export type MonitorAction = `monitor:${string}`;
// The hexagram has told, the first time it came out, that the wheel turns it (#536).
export const WHEEL_HINT_SEEN = "wheel_hint_seen";
export type CompanionAction = ToggleAction | EdgeAction | MonitorAction | typeof WHEEL_HINT_SEEN;
export const actionFor = (feature: Feature): ToggleAction => `toggle_${feature}`;
// Each feature's main switch (switch_id in MainFunctionSwitch and logics/main/switchBlocks.ts).
export const SWITCH_IDS: Record<Feature, string> = {
    mic: "transcription_send", translation: "translation", listening: "transcription_receive",
    ocr: "ocr", tts: "tts", rvc: "rvc",
};
export const edgeAction = (edge: Edge): EdgeAction => `edge_${edge}`;

// What the panel shows as the state of the app as a whole.
export type PanelState = "starting" | "listening" | "idle";

const toSwitch = (value: StoreValue, blocked = false): Switch => ({ on: value?.data === true, pending: value?.state === "pending", blocked });

const isLanguage = (value: unknown): value is Language => (LANGUAGES as readonly unknown[]).includes(value);

export const companionStatus = ({ ready, mic, translation, listening, ocr, tts, rvc, blocked = {}, edge, monitor, hinted, language, t }: {
    ready: unknown;
    mic: StoreValue;
    translation: StoreValue;
    listening?: StoreValue;
    ocr?: StoreValue;
    // Already worked out by the main page's switches (logics/voice/voiceActions.ts).
    tts?: Partial<Switch>;
    rvc?: Partial<Switch>;
    // The switches whose main switch is greyed out now (activeSwitchBlock).
    blocked?: Partial<Record<Feature, boolean>>;
    edge?: unknown;
    monitor?: unknown;
    hinted?: unknown;
    language: unknown;
    t: (key: string) => string;
}): CompanionStatus => ({
    ready: ready === true,
    mic: toSwitch(mic, blocked.mic === true),
    translation: toSwitch(translation, blocked.translation === true),
    listening: toSwitch(listening, blocked.listening === true),
    ocr: toSwitch(ocr, blocked.ocr === true),
    tts: { on: tts?.on === true, pending: tts?.pending === true, blocked: blocked.tts === true },
    rvc: { on: rvc?.on === true, pending: rvc?.pending === true, blocked: blocked.rvc === true },
    language: isLanguage(language) ? language : "en",
    edge: isEdge(edge) ? edge : "right",
    monitor: typeof monitor === "string" ? monitor : "",
    hinted: typeof hinted === "boolean" ? hinted : null,
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
    // Save TRAY_COMPANION_WHEEL_HINT_SHOWN as true: the hexagram has told of the wheel (#536).
    setHinted?: () => unknown;
    // True when the feature's switch cannot be turned on now (its main switch is greyed out
    // with a reason); the caller tells the user why, and the toggle is not run.
    refuse?: (feature: Feature) => boolean;
};

// Requests the panel, the handle and the tray may queue; anything else is ignored. Each one
// runs the same toggle as the main window's switch, so its consents and checks still apply.
export const runAction = (action: unknown, toggles: Toggles): boolean => {
    if (action === WHEEL_HINT_SEEN) {
        if (!toggles.setHinted) return false;
        toggles.setHinted();
        return true;
    }
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
    if (toggles.refuse?.((action as ToggleAction).slice("toggle_".length) as Feature)) return false;
    toggle();
    return true;
};
