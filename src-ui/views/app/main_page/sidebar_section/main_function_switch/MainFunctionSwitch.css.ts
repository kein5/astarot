import { keyframes, style } from "@vanilla-extract/css";
import { vars } from "../../../../theme/vars.css.ts";
import { loader as loaderRule } from "../../../../common_css/mixins.ts";
import { focusRing } from "../../../../kit/shared.css.ts";

// The states the switch's parts share (MainFunctionSwitch.tsx gives them to each part).
export const is_active = style({});
export const is_compact_mode = style({});
export const is_pending = style({});
export const cancellable = style({});
export const is_unavailable = style({});
export const in_row = style({});
export const is_open = style({});

const PENDING_LABEL_COLOR = vars.dark_500_color;

// The first-run setup leads to a switch by the part to press (#955): a ring of a Lilac gradient
// round its toggle, which blinks three times in 4.8 seconds, so it stops by itself within five
// (WCAG 2.2.2), then stays until the switch is turned on. Under reduced motion it stays without
// blinking. Only the ring is painted (a mask): the kit's switch inside keeps its own look, so it
// still reads as off.
const leadBlink = keyframes({ "50%": { opacity: .3 } });
const LEAD_FRAME = "linear-gradient(#000 0 0) content-box";
const leadRing = {
    content: '""',
    position: "absolute",
    background: `linear-gradient(90deg, ${vars.primary_200_color}, ${vars.primary_600_color})`,
    WebkitMask: `${LEAD_FRAME}, linear-gradient(#000 0 0)`,
    WebkitMaskComposite: "xor",
    mask: `${LEAD_FRAME} exclude, linear-gradient(#000 0 0)`,
    pointerEvents: "none",
    animation: `${leadBlink} 1.6s ease-in-out 3`,
} as const;
const stillUnderReducedMotion = (selector: string) => ({
    "(prefers-reduced-motion: reduce)": { selectors: { [selector]: { animation: "none" } } },
});

export const container = style({
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    gap: ".3rem",
    padding: ".6rem 1rem",
});

// The row: the label of the kit's switch at its end (D-19), so a press anywhere on it presses the switch.
export const switch_container = style([
    {
        position: "relative",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: ".8rem",
        minHeight: "4.4rem",
        // .7rem above and below: six two-line names leave room for the languages under them.
        padding: ".7rem 1.2rem",
        borderRadius: vars.vox_radius,
        backgroundColor: vars.dark_925_color,
        cursor: "pointer",
        selectors: {
            "&:hover": { backgroundColor: vars.dark_800_color },
            "&:active": { backgroundColor: vars.dark_875_color },
            // The kit's switch draws its own focus ring; in the icon rail, where it is hidden, the row draws it.
            [`&.${is_compact_mode}:has([data-slot="switch"]:focus-visible)`]: { outline: `.2rem solid ${vars.primary_200_color}`, outlineOffset: "-.3rem" },
            // On is seen at a glance, also in the icon rail: a blue tint on the row and
            // a blue icon. The switch, and in the rail the bar on the right, still say it.
            [`&.${is_active}`]: { backgroundColor: vars.vox_highlight_tint },
            [`&.${is_active}:hover`]: {
                backgroundColor: `color-mix(in srgb, ${vars.primary_400_color} 26%, transparent)`,
            },
            [`&.${is_active}:active`]: {
                backgroundColor: `color-mix(in srgb, ${vars.primary_400_color} 12%, transparent)`,
            },
            [`&.${is_compact_mode}`]: { padding: "1.2rem", justifyContent: "center" },
            [`&.${is_pending}`]: { pointerEvents: "none" },
            [`&.${is_pending}.${cancellable}`]: { pointerEvents: "auto" },
            [`&.${is_unavailable}`]: {
                cursor: "not-allowed",
                backgroundColor: vars.dark_925_color,
                color: vars.dark_350_color,
            },
            // Beside the icon button in the wide rail: the row draws the background and the tint,
            // the switch only its hover. The icon button takes the row's left padding; the label
            // keeps a small gap from the button's frame.
            // The rail's scrollbar always takes .8rem of its 24rem (overflow-y: scroll), so a row has
            // 22rem. The tight sides and gap leave the name 12.8rem, room for nine full-width
            // characters at 1.4rem: 「ボイスチェンジャー」 stays on one line also in a font whose kana
            // are full width (Noto Sans CJK on Linux, Meiryo). It broke before 「ー」 with 11.6rem.
            [`&.${in_row}`]: {
                flex: "1 1 0",
                minWidth: 0,
                gap: ".6rem",
                paddingLeft: ".4rem",
                paddingRight: ".6rem",
            },
            [`&.${in_row}:not(:hover):not(:active)`]: { backgroundColor: "transparent" },
            // The icon rail has no toggle in sight: the icon, which is pressed there, carries the
            // ring (#955), a circle round it in the middle of the row.
            "&[data-lead]::before": { ...leadRing, inset: 0, margin: "auto", width: "3.4rem", height: "3.4rem", padding: ".25rem", borderRadius: "50%" },
        },
        "@media": stillUnderReducedMotion("&[data-lead]::before"),
    },
]);

// A row of the wide rail: the icon button, then the switch.
export const switch_row = style({
    display: "flex",
    alignItems: "center",
    borderRadius: vars.vox_radius,
    backgroundColor: vars.dark_925_color,
    selectors: {
        [`&.${is_active}`]: { backgroundColor: vars.vox_highlight_tint },
        [`&.${is_unavailable}`]: { backgroundColor: vars.dark_925_color },
    },
});

// Opens the feature's settings: the kit's plain Button in its smallest square (icon-xs, 2.8rem,
// decided on 2026-11-25), so the row keeps room for the switch's name. The same size whatever the
// state, so nothing moves when the engine's state arrives. The row only places it.
export const settings_button = style({ flex: "none", marginLeft: ".4rem" });

// Read by screen readers as the description of a disabled switch; shown as its tooltip. The icon
// rail's switch too: focused and read, its row drawn in its place.
export const visually_hidden = style({
    position: "absolute",
    width: ".1rem",
    height: ".1rem",
    margin: "-.1rem",
    padding: 0,
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
});

// The state's line (switch_status) is the only part that wraps; it sits right under the name, as
// the short name in brackets does, so a row that keeps it is as tall as a two-line name's row.
export const label_wrapper = style({
    display: "flex",
    justifyContent: "left",
    alignItems: "center",
    columnGap: "0.8rem",
    rowGap: 0,
    minWidth: 0,
    flexWrap: "wrap",
});

export const switch_label = style({
    // Grows from nothing, so a long name shrinks beside the icon instead of dropping below it.
    flex: "1 1 0",
    minWidth: 0,
    fontSize: "1.4rem",
    lineHeight: 1.3,
    selectors: {
        [`&.${is_compact_mode}`]: { display: "none" },
        [`&.${is_pending}`]: { color: PENDING_LABEL_COLOR },
    },
});

// The short name in brackets, on its own line under the name: 「テキスト読み上げ」 then 「（TTS）」.
export const switch_label_abbr = style({
    display: "block",
    fontSize: "1.2rem",
    color: vars.vox_description_text,
    // A full-width bracket carries half an em of space on its left, so 「（OCR）」 started half
    // a character right of the name above (#437, #475). Trimming by font features depended on the
    // font (the default UI font has no proportional widths), so the bracket is drawn at its full
    // width everywhere and the line is pulled back by that half em. Only a line that starts with
    // a full-width bracket is moved (data-bracket); "(OCR)" in English is not.
    fontFeatureSettings: "normal",
    "@supports": { "(text-spacing-trim: space-all)": { textSpacingTrim: "space-all" } },
    selectors: {
        "&[data-bracket]": { textIndent: "-.5em" },
        [`&.${is_pending}, &.${is_unavailable}`]: { color: "inherit" },
    },
});

// A state of the switch's own, such as the TTS server starting. Why no switch can be used (the
// engine is gone) is not a line here: the rail says it once at its head (EngineReadout).
// The switch's state in words, on a line of its own under its name (#1314, M-5): beside the name it
// squeezed a short name onto two lines. A row that keeps the line keeps it one line tall while it
// is empty (keepsStatusLine, #1364); a longer state still takes the lines it needs.
export const switch_status = style({
    flexBasis: "100%",
    fontSize: "1.2rem",
    lineHeight: 1.3,
    minHeight: "1.3em",
    color: PENDING_LABEL_COLOR,
    selectors: {
        [`&.${is_compact_mode}`]: { display: "none" },
    },
});

export const switch_svg = style({
    width: "1.8rem",
    selectors: {
        [`&.${is_pending}`]: { color: PENDING_LABEL_COLOR },
        [`&:not(.${is_compact_mode})`]: {
            width: "1.6rem",
            color: vars.dark_350_color,
        },
        [`&.${is_active}:not(.${is_pending})`]: { color: vars.vox_state_active },
    },
});

export const switch_indicator = style({
    position: "absolute",
    top: "50%",
    right: "0.4rem",
    transform: "translate(-50%, -50%)",
    width: "0.2rem",
    height: "2.6rem",
    borderRadius: "0.1rem",
    backgroundColor: vars.primary_300_color,
    display: "none",
    selectors: {
        [`&.${is_compact_mode}.${is_active}`]: { display: "block" },
    },
});

export const loader = style(loaderRule({ size: "2rem", lineWidth: "0.2rem", position: "left", positionAmount: "50%" }));

// Where the kit's switch sits, at the row's end. Off and cannot be turned on, it is drawn as the kit
// draws a switch that cannot be used (half as strong), its focus ring too; it still takes focus so
// that its reason is heard, so the slot draws the kit's ring again around it at full strength. In
// the icon rail the slot is visually hidden and the row shows the focus.
export const switch_slot = style({
    position: "relative",
    display: "flex",
    flex: "none",
    alignItems: "center",
    borderRadius: "999rem",
    selectors: {
        '&:has(> [data-slot="switch"][data-disabled]:focus-visible)': focusRing,
        // The toggle the first-run setup leads to (#955): the ring is .25rem outside the switch, inside
        // the row's padding, and reaches under the switch's .1rem edge, so no seam shows between them.
        "&[data-lead]::before": { ...leadRing, inset: "-.25rem", padding: ".35rem", borderRadius: "999rem" },
        // Under keyboard focus the focus ring is drawn alone, so the two rings do not merge into one.
        '&[data-lead]:has(> [data-slot="switch"]:focus-visible)::before': { display: "none" },
    },
    "@media": stillUnderReducedMotion("&[data-lead]::before"),
});

// Under the switches: shows the ones the uses picked in settings leave out (#554, Q-10). The button
// is the kit's compact Button; its chevron turns when the list is open.
export const more_features_svg = style({
    width: "1rem",
    flex: "none",
    color: vars.dark_400_color,
    transition: "transform .12s ease-out",
    selectors: {
        [`&.${is_open}`]: { transform: "rotate(180deg)" },
    },
});

export const more_features_label = style({
    minWidth: 0,
    overflowWrap: "anywhere",
});
