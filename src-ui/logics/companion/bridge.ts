import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { CompanionStatus } from "./status.ts";

// The companion panel and the handle beside the captions. Events carry no data: both read the
// state back through a command that checks their window label.
export type CompanionBridge = {
    status: () => Promise<CompanionStatus>;
    request: (action: "toggle_mic" | "toggle_translation" | "open_main") => Promise<unknown>;
    hide: () => Promise<unknown>;
    togglePanel: () => Promise<unknown>;
    onChanged: (callback: () => void) => Promise<UnlistenFn>;
    onOpened: (callback: () => void) => Promise<UnlistenFn>;
};

export const companionBridge: CompanionBridge = {
    status: () => invoke<CompanionStatus>("companion_status"),
    request: action => invoke("companion_request", { action }),
    hide: () => invoke("companion_panel_hide"),
    togglePanel: () => invoke("companion_panel_toggle"),
    onChanged: callback => listen("companion-changed", () => callback()),
    onOpened: callback => listen("companion-opened", () => callback()),
};
