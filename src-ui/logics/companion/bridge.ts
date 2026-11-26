import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { CompanionAction, CompanionStatus } from "./status.ts";

// Whether the hexagram is out at its edge, and where its centre is inside its window (CSS px).
export type HandleLayout = { out: boolean; edge: string; x: number; y: number };

// The companion panel and the hexagram at the screen's edge. Events carry no data: both read the
// state back through a command that checks their window label.
export type CompanionBridge = {
    status: () => Promise<CompanionStatus>;
    // open_main and open_settings bring the main window or the settings window (#1236) forward.
    request: (action: CompanionAction | "open_main" | "open_settings") => Promise<unknown>;
    hide: () => Promise<unknown>;
    togglePanel: () => Promise<unknown>;
    // The hexagram's window shows only while it is out; the app tells it when that changes.
    layout: () => Promise<HandleLayout>;
    onLayout: (callback: () => void) => Promise<UnlistenFn>;
    onChanged: (callback: () => void) => Promise<UnlistenFn>;
    onOpened: (callback: () => void) => Promise<UnlistenFn>;
};

export const companionBridge: CompanionBridge = {
    status: () => invoke<CompanionStatus>("companion_status"),
    request: action => invoke("companion_request", { action }),
    hide: () => invoke("companion_panel_hide"),
    togglePanel: () => invoke("companion_panel_toggle"),
    layout: () => invoke<HandleLayout>("companion_handle_layout"),
    onLayout: callback => listen("companion-handle-changed", () => callback()),
    onChanged: callback => listen("companion-changed", () => callback()),
    onOpened: callback => listen("companion-opened", () => callback()),
};
