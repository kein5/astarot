import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { CompanionAction, CompanionStatus } from "./status.ts";

// Where the hexagram's centre is inside the handle window, in CSS px.
export type HandleCentre = { x: number; y: number };

// The companion panel and the handle beside the captions. Events carry no data: both read the
// state back through a command that checks their window label.
export type CompanionBridge = {
    status: () => Promise<CompanionStatus>;
    request: (action: CompanionAction | "open_main") => Promise<unknown>;
    hide: () => Promise<unknown>;
    togglePanel: () => Promise<unknown>;
    // The handle grows around the pointer, or goes back to rest.
    openHandle: (open: boolean) => Promise<HandleCentre>;
    onChanged: (callback: () => void) => Promise<UnlistenFn>;
    onOpened: (callback: () => void) => Promise<UnlistenFn>;
};

export const companionBridge: CompanionBridge = {
    status: () => invoke<CompanionStatus>("companion_status"),
    request: action => invoke("companion_request", { action }),
    hide: () => invoke("companion_panel_hide"),
    togglePanel: () => invoke("companion_panel_toggle"),
    openHandle: open => invoke<HandleCentre>("companion_handle_open", { open }),
    onChanged: callback => listen("companion-changed", () => callback()),
    onOpened: callback => listen("companion-opened", () => callback()),
};
