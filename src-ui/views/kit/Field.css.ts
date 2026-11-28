import { globalStyle, style } from "@vanilla-extract/css";
import type { CSSProperties } from "@vanilla-extract/css";
import { recipe } from "@vanilla-extract/recipes";
import { vars } from "../theme/vars.css.ts";
import { colourTransition, disabledLook, focusRing } from "./shared.css.ts";

// One field for typing and choosing (#436 "選択欄が2種類ある"): the surface, the field border
// (3.5:1 against it), and 4rem of height even when it holds nothing.
export const field = recipe({
    base: {
        boxSizing: "border-box",
        width: "100%",
        minWidth: 0,
        minHeight: "4rem",
        padding: ".8rem 1.2rem",
        background: vars.vox_surface,
        border: `.1rem solid ${vars.vox_field_border}`,
        borderRadius: vars.vox_radius,
        color: vars.dark_basic_text_color,
        font: "inherit",
        fontSize: "1.4rem",
        lineHeight: 1.5,
        transition: colourTransition,
        selectors: {
            "&::placeholder": { color: vars.vox_description_text, opacity: 1 },
            "&:hover:not(:disabled)": { borderColor: vars.dark_550_color },
            "&:focus-visible": { ...focusRing, borderColor: vars.primary_600_color },
            // The words beside the field say what is wrong; the red border only repeats them.
            "&[aria-invalid='true']": { borderColor: vars.vox_state_failed },
            "&:disabled": disabledLook,
        },
    },
    variants: {
        kind: {
            text: {},
            // Room on the right for the chevron the Select draws over the field (shadcn/ui's
            // NativeSelect: pr-9). A disabled select is dimmed by its wrapper, chevron and all,
            // so it is not dimmed twice.
            select: {
                appearance: "none",
                paddingRight: "3.6rem",
                cursor: "pointer",
                selectors: { "&:disabled": { opacity: 1 } },
            },
            // Several lines (shadcn/ui's Textarea, U-06). How tall it is depends on where it is
            // (fill, below); it never grows with its text by itself (no field-sizing: content, D-13).
            textarea: {},
        },
        mono: {
            // Addresses, ports, paths and keys (#476).
            true: { fontFamily: "var(--vox_font_mono)" },
            false: {},
        },
        // Only for several lines: the field fills the room its screen gives it (Quick Chat's
        // window) and grows and shrinks with that room, instead of having an edge to drag.
        fill: { true: {}, false: {} },
        // Only for several lines: a field inside a frame its screen draws (the main window's
        // composer), as shadcn/ui's InputGroupTextarea sits in an InputGroup. The frame draws the
        // border, the fill, the focus (:focus-within), the room around the words and their size;
        // the field keeps its words and the placeholder's color (decided on 2026-11-25).
        inFrame: {
            true: {
                minHeight: 0,
                padding: 0,
                background: "transparent",
                border: 0,
                borderRadius: 0,
                color: "inherit",
                fontSize: "inherit",
                lineHeight: "inherit",
                selectors: { "&:focus-visible": { outline: "none" } },
            },
            false: {},
        },
    },
    compoundVariants: [
        // In a form: 8rem to start, and its lower edge can be dragged down to give the text room.
        { variants: { kind: "textarea", fill: false }, style: { minHeight: "8rem", resize: "vertical" } },
        // Filling its screen's room: nothing to drag, and the field's floor of 4rem (one line).
        { variants: { kind: "textarea", fill: true }, style: { resize: "none" } },
    ],
    defaultVariants: { kind: "text", mono: false, fill: false, inFrame: false },
});

export const selectWrap = style({
    position: "relative",
    display: "block",
    width: "100%",
    minWidth: 0,
    selectors: { "&:has(select:disabled)": { opacity: disabledLook.opacity } },
});

// shadcn/ui's NativeSelect icon: size-4, 1.4rem (right-3.5) from the right edge.
export const chevron = style({
    position: "absolute",
    top: "50%",
    right: "1.4rem",
    width: "1.6rem",
    height: "1.6rem",
    marginTop: "-.8rem",
    color: vars.vox_secondary_text,
    pointerEvents: "none",
});

// The open list of a native select is drawn by the system; give its rows and group labels the
// field's colours where the engine lets us (WebView2 does, WebKitGTK partly).
globalStyle(`${selectWrap} option, ${selectWrap} optgroup`, { background: vars.vox_surface, color: vars.dark_basic_text_color });

// Where the engine can style a select's list (`appearance: base-select`, which WebView2 has), the
// kit's select opens it in the app's look, as the settings forms' own selects did (decided on
// 2026-11-25): the list drops from the field and settles, its rows are the shared dropdown's, the
// chosen row is lilac and bold with no check mark, and a value longer than the field wraps onto
// another line instead of being cut. The field and its chevron stay as above. Elsewhere
// (WebKitGTK) the system's list and its one-line value stay. The values are the forms' rules for
// their selects (advanced_settings/VoiceSettings.css.ts), which leave the kit's select alone.
const BASE_SELECT = "(appearance: base-select)";
// csstype does not list the value yet, so the word is read as a string and given the property's type.
const baseSelect: string = "base-select";
const BASE_SELECT_APPEARANCE = baseSelect as CSSProperties["appearance"];
const select = `${selectWrap} > select`;
globalStyle(`${select}, ${select}::picker(select)`, { "@supports": { [BASE_SELECT]: { appearance: BASE_SELECT_APPEARANCE } } });
globalStyle(select, { "@supports": { [BASE_SELECT]: { display: "flex", alignItems: "center" } } });
// The field keeps the kit's chevron.
globalStyle(`${select}::picker-icon`, { "@supports": { [BASE_SELECT]: { display: "none" } } });
globalStyle(`${select}::picker(select)`, {
    "@supports": {
        [BASE_SELECT]: {
            marginBlock: ".4rem",
            padding: ".4rem",
            border: `.1rem solid ${vars.dark_600_color}`,
            borderRadius: vars.vox_radius,
            background: vars.vox_surface,
            color: vars.dark_200_color,
            boxShadow: vars.vox_shadow_overlay,
            transformOrigin: "top",
            // Below the field when it fits, as the system list opens (Chromium's default picks the roomier side).
            positionTryOrder: "normal",
        },
    },
});
// The list drops from the field and settles: its first frame, then the motion to its place.
globalStyle(`${select}:open::picker(select)`, {
    "@supports": {
        [BASE_SELECT]: {
            transition: `opacity ${vars.vox_motion_fast} ${vars.vox_ease}, transform ${vars.vox_motion} ${vars.vox_ease_settle}`,
            "@starting-style": { opacity: 0, transform: "translateY(-.6rem) scaleY(.94)" },
        },
    },
});
globalStyle(`${select} option`, { "@supports": { [BASE_SELECT]: { minHeight: 0, padding: ".8rem 1.2rem", borderRadius: ".4rem" } } });
globalStyle(`${select} option:hover, ${select} option:focus-visible`, { "@supports": { [BASE_SELECT]: { background: vars.dark_800_color, outline: "none" } } });
globalStyle(`${select} option:checked`, { "@supports": { [BASE_SELECT]: { color: vars.primary_200_color, fontWeight: 600 } } });
globalStyle(`${select} option::checkmark`, { "@supports": { [BASE_SELECT]: { display: "none" } } });
