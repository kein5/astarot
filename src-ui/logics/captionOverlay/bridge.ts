import { invoke } from "@tauri-apps/api/core";
import { listen, type EventCallback, type UnlistenFn } from "@tauri-apps/api/event";

export interface CaptionOverlayBridge {
    // The captions and their style, as the native command returns them; not checked here.
    snapshot: () => Promise<unknown>;
    onChanged: (callback: EventCallback<unknown>) => Promise<UnlistenFn>;
}

// The overlay page's side. The notice carries no data: the captions are read
// through a native command that checks this window's label.
export const captionOverlayBridge: CaptionOverlayBridge = {
    snapshot: () => invoke("caption_overlay_snapshot"),
    onChanged: callback => listen("caption-overlay-changed", callback),
};
