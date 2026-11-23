import { globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../theme/vars.css.ts";

// VR設定ウィンドウ (vr_layout.json の popup: 720x640、本文 720x584)。
// 左にカテゴリ (168px)、右に項目の一覧 (約500px、スティックでスクロール)。数値操作は64px。
// One element carries several of these classes (a row that is a button and a select), and rules
// of one weight compete, so the classes are declared first and the rules follow in the order the
// SCSS module had them (#957).
export const window_body = style({});
export const banner = style({});
export const banner_icon = style({});
export const body = style({});
export const is_waiting = style({});
export const side = style({});
export const list = style({});
export const button = style({});
export const clickable = style({});
export const is_on = style({});
export const category = style({});
export const is_selected = style({});
export const category_icon = style({});
export const category_label = style({});
export const category_abbr = style({});
export const section_label = style({});
export const row = style({});
export const label = style({});
export const sub = style({});
// The class is named switch; the name is a word of the language, so it is exported as switch_.
export const switch_ = style({}, "switch");
export const select = style({});
export const select_long = style({});
export const select_value = style({});
export const chevron = style({});
export const segment = style({});
export const segment_button = style({});
export const segment_icon = style({});
export const stepper = style({});
export const step = style({});
export const value = style({});
export const is_disabled = style({});
export const threshold_row = style({});
export const row_line = style({});
export const automatic = style({});
export const check = style({});
export const check_icon = style({});
export const meter = style({});
export const meter_level = style({});
export const is_over = style({});
export const meter_threshold = style({});
export const picker_head = style({});
export const back = style({});
export const picker_title = style({});
export const option = style({});
export const reason = style({});
export const step_status = style({});
export const disclosure = style({});
export const disclosure_toggle = style({});
export const summary = style({});
export const expand_label = style({});
export const disclosure_content = style({});

globalStyle(window_body, {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    color: vars.dark_basic_text_color,
});
globalStyle(`${window_body} button`, { touchAction: "manipulation" });
globalStyle(`${window_body} button:focus-visible`, {
    outline: `3px solid ${vars.primary_100_color}`,
    outlineOffset: "-3px",
});
globalStyle(`${window_body} [hidden]`, { display: "none !important" });

// 設定中はメイン機能を止めていることを常に見せる
globalStyle(banner, {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "10px 20px",
    fontSize: "16px",
    color: vars.primary_200_color,
    backgroundColor: vars.dark_950_color,
});

globalStyle(banner_icon, {
    width: "22px",
    height: "22px",
    flexShrink: 0,
    fill: vars.primary_200_color,
    color: vars.primary_200_color,
});

globalStyle(body, {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    margin: 0,
    border: 0,
    display: "flex",
    gap: "12px",
    padding: "14px 16px 16px",
});
// メインが設定画面を開くまで (メイン機能を止めるまで) は押せない
globalStyle(`${body}.${is_waiting}`, {
    opacity: 0.55,
    pointerEvents: "none",
});

globalStyle(side, {
    width: "168px",
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    gap: "6px",
});

globalStyle(list, {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    overflowY: "auto",
    overscrollBehavior: "contain",
    scrollPaddingTop: "100px",
    paddingRight: "8px",
});
globalStyle(`${list}::-webkit-scrollbar`, { width: "14px" });
globalStyle(`${list}::-webkit-scrollbar-thumb`, {
    backgroundColor: vars.dark_600_color,
    borderRadius: "7px",
});

// ---- 押せるもの共通 ----
// The buttons and the rows that are buttons (SCSS: a placeholder both extended).
const pressable = (...selectors: string[]) => selectors.flatMap(selector => [clickable, button].map(cls => selector.replace("&", cls))).join(", ");
globalStyle(pressable("&"), { cursor: "pointer" });
// VRのポインタが当たっている (VrApp の VrPointerHover が付ける)
globalStyle(pressable("[data-vr-hover]&"), { boxShadow: `inset 0 0 0 3px ${vars.primary_300_color}` });
globalStyle(pressable('&:active:not(:disabled):not([aria-disabled="true"])'), {
    backgroundColor: vars.primary_600_color,
    color: vars.vox_on_primary,
    transition: "none",
});
globalStyle(pressable("&:disabled", '[aria-disabled="true"]&'), { cursor: "default" });
globalStyle(pressable("&:disabled[data-vr-hover]", '[aria-disabled="true"][data-vr-hover]&'), { boxShadow: "none" });

globalStyle(button, {
    // reset.css が button の text-align を継承 (左寄せ) にするので中央へ寄せ直す
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    height: "56px",
    borderRadius: "12px",
    backgroundColor: vars.dark_750_color,
    color: vars.dark_basic_text_color,
    fontWeight: 700,
});
globalStyle(`${button}.${is_on}`, { backgroundColor: vars.primary_800_color });

// ---- 左のカテゴリ ----

globalStyle(category, {
    position: "relative",
    minHeight: "64px",
    height: "auto",
    justifyContent: "flex-start",
    gap: "10px",
    padding: "0 12px",
    backgroundColor: vars.dark_825_color,
});
globalStyle(`${category}.${is_selected}`, { backgroundColor: vars.primary_800_color });
globalStyle(`${category}.${is_selected}::before`, {
    content: '""',
    position: "absolute",
    left: 0,
    top: "12px",
    bottom: "12px",
    width: "5px",
    borderRadius: "3px",
    backgroundColor: vars.primary_200_color,
});

globalStyle(category_icon, {
    width: "28px",
    height: "28px",
    flexShrink: 0,
    fill: vars.dark_basic_text_color,
    color: vars.dark_basic_text_color,
});

// 幅は約100px。英語の "Translation" など長い名前は2行まで折り返し、それ以上は切る
globalStyle(category_label, {
    minWidth: 0,
    fontSize: "16px",
    textAlign: "left",
    lineHeight: 1.2,
    wordBreak: "keep-all",
    overflowWrap: "anywhere",
    display: "-webkit-box",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: "3",
    overflow: "hidden",
});
// The short name in brackets, on its own line under the name.
globalStyle(category_abbr, {
    display: "block",
    fontSize: "16px",
});

// ---- 右の一覧の行 ----

globalStyle(section_label, {
    flexShrink: 0,
    marginTop: "8px",
    fontSize: "16px",
    fontWeight: 600,
    color: vars.primary_300_color,
});

globalStyle(row, {
    flexShrink: 0,
    minHeight: "72px",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "8px 14px",
    borderRadius: "12px",
    backgroundColor: vars.dark_850_color,
    color: vars.dark_basic_text_color,
    textAlign: "left",
});

globalStyle(`${clickable}.${is_selected}`, { backgroundColor: vars.primary_800_color });

globalStyle(label, {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    fontSize: "19px",
    fontWeight: 600,
    lineHeight: 1.3,
    overflowWrap: "anywhere",
});

globalStyle(sub, {
    fontSize: "16px",
    fontWeight: 400,
    color: vars.dark_350_color,
});

// ON/OFF のスイッチ (行全体が押せる)
globalStyle(switch_, {
    position: "relative",
    width: "72px",
    height: "40px",
    flexShrink: 0,
    borderRadius: "20px",
    backgroundColor: vars.dark_600_color,
});
globalStyle(`${switch_}::after`, {
    content: '""',
    position: "absolute",
    top: "5px",
    left: "5px",
    width: "30px",
    height: "30px",
    borderRadius: "50%",
    backgroundColor: vars.dark_400_color,
});
globalStyle(`${switch_}.${is_on}`, { backgroundColor: vars.primary_500_color });
globalStyle(`${switch_}.${is_on}::after`, {
    left: "auto",
    right: "5px",
    backgroundColor: vars.dark_basic_text_color,
});

globalStyle(select, {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(90px, 42%) 20px",
});
const long = `${select}.${select_long}`;
globalStyle(long, {
    gridTemplateColumns: "minmax(0, 1fr) 20px",
    rowGap: "6px",
});
globalStyle(`${long} ${label}`, { gridColumn: "1", gridRow: "1" });
globalStyle(`${long} ${select_value}`, { gridColumn: "1", gridRow: "2", textAlign: "left" });
globalStyle(`${long} ${chevron}`, { gridColumn: "2", gridRow: "1 / span 2" });

globalStyle(select_value, {
    fontSize: "19px",
    fontWeight: 500,
    color: vars.dark_basic_text_color,
    whiteSpace: "normal",
    overflowWrap: "anywhere",
    textAlign: "right",
});

globalStyle(chevron, {
    fontSize: "26px",
    color: vars.dark_500_color,
});

globalStyle(segment, {
    display: "flex",
    gap: "4px",
    padding: "4px",
    flexShrink: 0,
    borderRadius: "14px",
    backgroundColor: vars.dark_900_color,
});

globalStyle(segment_button, {
    height: "64px",
    minWidth: "88px",
    gap: "8px",
    padding: "0 14px",
    fontSize: "19px",
});

// A mark before a segment's name, drawn in lines like the toolbar's icons.
globalStyle(segment_icon, {
    width: "28px",
    height: "28px",
    flexShrink: 0,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
});

globalStyle(stepper, {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexShrink: 0,
});

globalStyle(step, {
    width: "64px",
    height: "64px",
    fontSize: "26px",
});
globalStyle(`${step}[aria-disabled="true"]`, {
    color: vars.dark_450_color,
    backgroundColor: vars.dark_900_color,
});

globalStyle(value, {
    width: "84px",
    textAlign: "center",
    fontSize: "22px",
    fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "64px",
});
globalStyle(`${value}.${is_disabled}`, { color: vars.dark_500_color });

// ---- 入力感度 (音量を見ながら合わせる) ----

globalStyle(threshold_row, {
    flexDirection: "column",
    alignItems: "stretch",
    gap: "8px",
    padding: "10px 14px",
});

globalStyle(row_line, {
    display: "flex",
    alignItems: "center",
    gap: "10px",
});

globalStyle(automatic, {
    minWidth: "88px",
    padding: "0 14px",
    fontSize: "19px",
});

globalStyle(check, { width: "56px" });

globalStyle(check_icon, {
    width: "30px",
    height: "30px",
    fill: vars.dark_basic_text_color,
    color: vars.dark_basic_text_color,
});

// 音量 (0〜max) と、しきい値の位置の線。しきい値を超えた音量は明るい緑
globalStyle(meter, {
    position: "relative",
    flex: 1,
    minWidth: 0,
    height: "26px",
    borderRadius: "8px",
    overflow: "hidden",
    backgroundColor: vars.dark_900_color,
});

globalStyle(meter_level, {
    height: "100%",
    backgroundColor: vars.primary_750_color,
});
globalStyle(`${meter_level}.${is_over}`, { backgroundColor: vars.primary_400_color });

globalStyle(meter_threshold, {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: "4px",
    marginLeft: "-2px",
    backgroundColor: vars.dark_basic_text_color,
});

// ---- 選択肢の一覧 ----

globalStyle(picker_head, {
    position: "sticky",
    top: 0,
    zIndex: 2,
    backgroundColor: vars.dark_888_color,
    padding: "8px 0",
    borderBottom: `1px solid ${vars.dark_650_color}`,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: "12px",
});

globalStyle(back, {
    height: "64px",
    padding: "0 18px",
    fontSize: "19px",
    fontWeight: 600,
});

globalStyle(picker_title, {
    minWidth: 0,
    fontSize: "16px",
    // No such colour is defined, so the title takes its parent's; kept as it was (#957).
    color: "var(--dark_250_color)",
    whiteSpace: "normal",
    overflowWrap: "anywhere",
});

globalStyle(option, {
    minHeight: "72px",
    scrollMarginTop: "100px",
});

globalStyle(reason, {
    color: vars.primary_200_color,
    fontSize: "16px",
    fontWeight: 400,
    lineHeight: 1.4,
    marginTop: "5px",
});

globalStyle(step_status, {
    fontSize: "16px",
    fontWeight: 400,
    lineHeight: 1.2,
    color: vars.primary_200_color,
});

globalStyle(disclosure, { flexShrink: 0 });

globalStyle(disclosure_toggle, {
    width: "100%",
    minHeight: "80px",
    border: `1px solid ${vars.dark_650_color}`,
});

globalStyle(summary, {
    color: vars.dark_350_color,
    fontSize: "16px",
    fontWeight: 400,
    lineHeight: 1.4,
    overflowWrap: "anywhere",
});

globalStyle(expand_label, {
    color: vars.primary_200_color,
    fontSize: "16px",
    whiteSpace: "nowrap",
});

globalStyle(disclosure_content, {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    marginTop: "8px",
    paddingLeft: "8px",
    borderLeft: `3px solid ${vars.primary_700_color}`,
});
