import { globalStyle, keyframes, style } from "@vanilla-extract/css";
import { vars } from "../theme/vars.css.ts";
import { LAUNCHER_BUTTON, LAUNCHER_DIVIDER, LAUNCHER_GAP, LAUNCHER_PADDING } from "./launcherSizes.ts";

const px = (value: number) => `${value}px`;

// The launcher's rules rely on their order across classes (the intro's delays, the marks), so the
// classes are declared first and the rules follow in the order the SCSS module had them (#957).
export const root = style({});
export const container = style({});
export const group = style({});
export const divider = style({});
export const button = style({});
export const icon = style({});
export const window_button = style({});
export const is_attention = style({});
export const is_holding = style({});
export const state_mark = style({});
export const is_pending = style({});
export const is_disabled = style({});
export const is_blocked = style({});
export const is_intro_pending = style({});
export const is_intro_playing = style({});
export const intro_icon = style({});
export const intro_logo = style({});

globalStyle(root, { position: "relative", width: "100%", height: "100%" });
// The buttons sit in the middle of the band, which is a few px wider than they need (launcherSizes.ts).
globalStyle(container, { position: "relative", isolation: "isolate", width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: px(LAUNCHER_GAP), padding: px(LAUNCHER_PADDING) });
// 枠 (背景と枠線) は別の要素にして、起動演出で幅だけを動かせるようにする (箱を切り落とすと、左右の枠線も切れる)
globalStyle(`${container}::before`, { content: '""', position: "absolute", zIndex: -1, top: 0, bottom: 0, left: 0, right: 0, borderRadius: "24px", background: vars.dark_888_color, boxShadow: `inset 0 0 0 4px ${vars.dark_750_color}` });
globalStyle(group, { display: "flex", gap: px(LAUNCHER_GAP) });
globalStyle(divider, { flexShrink: 0, width: px(LAUNCHER_DIVIDER.width), height: px(LAUNCHER_DIVIDER.height), margin: `0 ${px(LAUNCHER_DIVIDER.margin)}`, borderRadius: "2px", background: vars.dark_650_color });
// 文字は出さない (名前は指したときの吹き出しで出す)。8つとも同じ大きさで、帯の幅に収める (launcherSizes.ts、#1248)
globalStyle(button, { position: "relative", flexShrink: 0, width: px(LAUNCHER_BUTTON.width), height: px(LAUNCHER_BUTTON.height), padding: "6px" });
globalStyle(`${button}:not([aria-pressed="true"])`, { background: vars.dark_850_color, color: vars.dark_400_color });
globalStyle(`${button}:focus-visible`, { outline: `3px solid ${vars.primary_100_color}`, outlineOffset: "-3px" });
globalStyle(`${button}.${is_pending}`, { cursor: "wait", boxShadow: `inset 0 0 0 3px ${vars.primary_200_color}` });
globalStyle(`${button}.${is_disabled}`, { background: vars.dark_900_color, color: vars.dark_450_color, cursor: "default" });
globalStyle(icon, { width: "52px", height: "52px", flexShrink: 0, color: "currentColor", fill: "currentColor" });
globalStyle(`${window_button}.${is_attention}`, { background: vars.dark_950_color, color: vars.warning_color });
globalStyle(`${window_button}.${is_holding}`, { boxShadow: `inset 0 0 0 3px ${vars.warning_color}` });
globalStyle(state_mark, { position: "absolute", top: "7px", right: "7px", width: "24px", height: "24px", padding: "2px", borderRadius: "6px", background: vars.dark_950_color, color: vars.dark_350_color, display: "flex" });
globalStyle(`${state_mark} svg`, { width: "100%", height: "100%", fill: "none", stroke: "currentColor", strokeWidth: "2.5", strokeLinecap: "round", strokeLinejoin: "round" });
globalStyle(`${is_pending} ${state_mark}`, { color: vars.primary_100_color });
// 前提が足りないスイッチ: 押せない灰色 (is_disabled) に、注意の印を付ける
globalStyle(`${is_blocked} ${state_mark}`, { color: vars.warning_color });

// ---- 起動演出: VR UI をONにして最初に出したとき ----
// 1. 頭の正面に VRCT のアイコンが大きく現れる  2. 手首へ吸い寄せられて小さくなる
// 3. 着いたらロゴ入りのカプセルが現れ、ロゴが消えながら、カプセルが横に開いてボタンが並ぶ
// 1〜2 は Python (overlay.py の _INTRO_FRONT_SEC / _INTRO_FLY_SEC) がオーバーレイごと動かす。ここは同じ時間だけアイコンを出して待つ。
// 領域の外側は VR画面の背景色 (--dark_1000_color) のまま残す。Python (overlay.py introKeyAlpha) がこの色を透明にする。
// 最初に出すまでは中身を出さず ("pending")、Python が "playing" にしたら始まり、約4.0秒で通常の表示になる。
const INTRO_LAND = 2.1; // アイコンが手首に着く時刻 (_INTRO_FRONT_SEC + _INTRO_FLY_SEC)
const seconds = (value: number) => `${+value.toFixed(3)}s`;
// 最終のランチャーの形 (角の丸みも枠線も同じ) を短くした枠が現れ、幅だけが広がる
const introFrame = keyframes({
    "0%, 50%": { opacity: 0, left: "31%", right: "31%" },
    "54.7%": { opacity: 1, left: "31%", right: "31%" },
    "65.6%": { opacity: 1, left: "31%", right: "31%", animationTimingFunction: "cubic-bezier(0.7, 0, 0.2, 1)" },
    "82.8%, 100%": { opacity: 1, left: 0, right: 0 },
}, "intro_frame");
const introIcon = keyframes({
    // ロゴ (文字・マーク) と同じ、ぼやけて少し大きい状態からピントが合う
    "0%": { opacity: 0, filter: "blur(14px)", transform: "scale(1.1)" },
    "18%, 80%": { opacity: 1, filter: "blur(0)", transform: "scale(1)" },
    "100%": { opacity: 0, filter: "blur(0)", transform: "scale(0.8)" },
}, "intro_icon");
// ロゴは、ぼやけて少し大きい状態からピントが合い (25%)、完全に止まる (33% まで)。そのあと、動かずにぼやけながら薄れる
const introLogo = keyframes({
    "0%": { opacity: 0, filter: "blur(14px)", transform: "scale(1.1)" },
    "25%, 33%": { opacity: 1, filter: "blur(0)", transform: "none" },
    "62%, 100%": { opacity: 0, filter: "blur(8px)", transform: "none" },
}, "intro_logo");
const introRise = keyframes({ from: { opacity: 0, transform: "translateY(16px)" }, to: { opacity: 1, transform: "none" } }, "intro_rise");

globalStyle(is_intro_pending, { opacity: 0 });
globalStyle(`${is_intro_playing}::before`, { animation: `${introFrame} 4.2s both` });
globalStyle(`${is_intro_playing} ${button}, ${is_intro_playing} ${divider}`, { opacity: 0, animation: `${introRise} 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) both` });
globalStyle(`${is_intro_playing} ${divider}`, { animationDelay: "3.3s" });
// 機能4つ → 画面4つの順に 65ms ずつずらす
for (let i = 1; i <= 4; i++) {
    globalStyle(`${is_intro_playing} ${group}:first-of-type > :nth-child(${i})`, { animationDelay: seconds(3.05 + (i - 1) * 0.065) });
}
for (let i = 1; i <= 4; i++) {
    globalStyle(`${is_intro_playing} ${group}:last-of-type > :nth-child(${i})`, { animationDelay: seconds(3.05 + (i + 3) * 0.065) });
}
globalStyle(intro_icon, { position: "absolute", zIndex: 1, left: "50%", top: "50%", translate: "-50% -50%", pointerEvents: "none", opacity: 0, height: "112px", animation: `${introIcon} 2.2s 0.13s both` });
globalStyle(intro_logo, { position: "absolute", zIndex: 1, left: "50%", top: "50%", width: "264px", aspectRatio: "1474 / 300", translate: "-50% -50%", pointerEvents: "none", background: "var(--intro-logo) center / contain no-repeat", opacity: 0, animation: `${introLogo} 1.6s ${seconds(INTRO_LAND + 0.13)} both` });
