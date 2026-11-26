import { globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../theme/vars.css.ts";
import { WINDOW_FILL } from "./VrWindow.css.ts";
import { LOG_BACKGROUND } from "../app/main_page/main_section/message_container/log_box/LogBox.css.ts";

// root.css の角丸 (html/body) は透過ウィンドウのメイン画面向け。VR UIは不透明な
// ウィンドウを撮影するため、角の外側がWebViewの白い背景として映ってしまう
globalStyle("html, body", {
    borderRadius: 0,
    backgroundColor: vars.dark_1000_color,
});

// 各領域の外は Python 側で透明にするので、ここの背景は映らない
export const atlas = style({
    position: "relative",
    overflow: "hidden",
    backgroundColor: vars.dark_1000_color,
});

export const region = style({
    position: "absolute",
    overflow: "hidden",
});

// The log's two background colours, one square each, in the gap right of the log, which no
// overlay shows: the overlay reads them to turn the log's background see-through by its
// opacity while the text stays whole (native/vr-overlay engine.rs panel_background_alpha, #1247).
export const background_swatch = style({ position: "absolute", display: "flex", flexDirection: "column", pointerEvents: "none" });
export const swatch_fill = style({ flex: 1, backgroundColor: WINDOW_FILL });
export const swatch_log = style({ flex: 1, backgroundColor: LOG_BACKGROUND });
