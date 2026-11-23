import { globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../theme/vars.css.ts";

// VR UIのウィンドウ共通の様式 (ログ・言語・VR設定)。
// タイトルバー56px、角丸24px (撮影後に Python 側で切り抜く)、外枠4px。

export const top_left = style({});
export const bottom_left = style({});
export const bottom_right = style({});

export const window = style({
    position: "relative",
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    borderRadius: "24px",
    overflow: "hidden",
    backgroundColor: vars.dark_888_color,
    boxShadow: `inset 0 0 0 4px ${vars.dark_750_color}`,
});

// 角を掴んで大きさを変える取っ手 (L字)。撮影後に角が丸く切り抜かれるので、枠の内側に描く。
// ウィンドウを指している間だけ出し、取っ手そのものを指したら明るく太くする
export const resize_handle = style({
    position: "absolute",
    width: "56px",
    height: "56px",
    border: `0 solid ${vars.primary_300_color}`,
    opacity: 0,
    pointerEvents: "auto",
    selectors: {
        [`&.${top_left}`]: {
            left: "6px",
            top: "6px",
            borderLeftWidth: "8px",
            borderTopWidth: "8px",
            borderTopLeftRadius: "20px",
        },
        [`&.${bottom_left}`]: {
            left: "6px",
            bottom: "6px",
            borderLeftWidth: "8px",
            borderBottomWidth: "8px",
            borderBottomLeftRadius: "20px",
        },
        [`&.${bottom_right}`]: {
            right: "6px",
            bottom: "6px",
            borderRightWidth: "8px",
            borderBottomWidth: "8px",
            borderBottomRightRadius: "20px",
        },
        "&[data-vr-hover]": {
            opacity: 1,
            borderColor: vars.primary_100_color,
            borderWidth: 0,
        },
        [`&[data-vr-hover].${top_left}`]: { borderLeftWidth: "10px", borderTopWidth: "10px" },
        [`&[data-vr-hover].${bottom_left}`]: { borderLeftWidth: "10px", borderBottomWidth: "10px" },
        [`&[data-vr-hover].${bottom_right}`]: { borderRightWidth: "10px", borderBottomWidth: "10px" },
    },
});

// ウィンドウの中のボタンを指しているときも出す
globalStyle(`${window}[data-vr-hover] > ${resize_handle}, ${window}:has([data-vr-hover]) > ${resize_handle}`, {
    opacity: 1,
});

export const title_bar = style({
    flexShrink: 0,
    height: "56px",
    display: "flex",
    alignItems: "center",
    gap: "12px",
    paddingLeft: "16px",
    backgroundColor: vars.dark_950_color,
});

export const title_icon = style({
    width: "28px",
    height: "28px",
    color: vars.dark_350_color,
    fill: vars.dark_350_color,
});

export const title = style({
    flex: 1,
    fontSize: "22px",
    fontWeight: 600,
    color: vars.dark_basic_text_color,
});

// 操作バーでロック中 (掴めない)
export const grab_locked = style({
    display: "flex",
    alignItems: "center",
    gap: "6px",
    marginRight: "8px",
    fontSize: "16px",
    fontWeight: 600,
    color: vars.dark_400_color,
    whiteSpace: "nowrap",
});

export const grab_locked_icon = style({
    width: "28px",
    height: "28px",
    fill: "none",
    stroke: vars.dark_350_color,
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
});

export const close_button = style({
    width: "56px",
    height: "56px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    selectors: {
        "&:focus-visible": {
            outline: `3px solid ${vars.primary_100_color}`,
            outlineOffset: "-3px",
        },
        // VRのポインタが当たっている (VrApp の VrPointerHover が付ける)。赤はエラー用に残す
        "&[data-vr-hover]": {
            backgroundColor: vars.dark_750_color,
        },
        '&:active:not(:disabled):not([aria-disabled="true"])': {
            backgroundColor: vars.primary_600_color,
            color: vars.vox_on_primary,
            transition: "none",
        },
    },
});

export const close_icon = style({
    width: "24px",
    height: "24px",
    color: vars.dark_400_color,
    fill: vars.dark_400_color,
});

export const body = style({
    position: "relative",
    flex: 1,
    minHeight: 0,
    display: "flex",
});

export const log_box_wrapper = style({
    flex: 1,
    display: "flex",
    minWidth: 0,
    minHeight: 0,
    padding: "12px 16px 16px",
});
// VRではスクロール位置が分かるよう、スクロールバーを太く明るくする
globalStyle(`${log_box_wrapper} #log_container::-webkit-scrollbar`, {
    width: "16px",
});
globalStyle(`${log_box_wrapper} #log_container::-webkit-scrollbar-thumb`, {
    backgroundColor: vars.dark_600_color,
    borderRadius: "8px",
});
// ログの文字の基準 (既定17pxで訳文が約24px = 1.4em)。操作バーの A−／A＋ で変える。
// デスクトップのログ文字サイズ設定 (#log_container に直接書かれる) はVRでは使わない
globalStyle(`${log_box_wrapper} #log_container`, {
    // 保存値を手で書き換えられても 14〜28px に収める (バックエンドの検証と同じ範囲)
    fontSize: "clamp(14px, var(--vr_log_font_size, 17px), 28px) !important",
});

// 設定画面を開いている間: 本文だけを覆う (タイトルバーの閉じる・掴むは使える)
export const locked = style({
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "16px",
    padding: "32px",
    textAlign: "center",
    fontSize: "22px",
    color: vars.dark_basic_text_color,
    backgroundColor: vars.dark_1000_color_dd,
});

export const locked_icon = style({
    width: "48px",
    height: "48px",
    color: vars.warning_color,
    fill: vars.warning_color,
});
