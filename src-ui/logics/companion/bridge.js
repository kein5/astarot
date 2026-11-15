import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// The companion panel and the handle beside the captions. Events carry no data:
// both read the state back through a command that checks their window label.
export const companionBridge = {
    status: () => invoke("companion_status"),
    request: action => invoke("companion_request", { action }),
    hide: () => invoke("companion_panel_hide"),
    togglePanel: () => invoke("companion_panel_toggle"),
    onChanged: callback => listen("companion-changed", callback),
    onOpened: callback => listen("companion-opened", callback),
};
