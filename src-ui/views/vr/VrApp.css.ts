import { globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../theme/vars.css.ts";

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
