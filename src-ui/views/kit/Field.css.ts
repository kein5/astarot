import { globalStyle, style } from "@vanilla-extract/css";
import { recipe } from "@vanilla-extract/recipes";
import { vars } from "../theme/vars.css.ts";
import { colourTransition, disabledLook, focusRing } from "./shared.css.ts";

// One field for typing and choosing (#436 "選択欄が2種類ある"): the surface, a border that
// reaches 3:1 against it, and 4rem of height even when it holds nothing.
export const field = recipe({
    base: {
        boxSizing: "border-box",
        width: "100%",
        minWidth: 0,
        minHeight: "4rem",
        padding: ".8rem 1.2rem",
        background: vars.vox_surface,
        border: `.1rem solid ${vars.dark_650_color}`,
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
            // Room on the right for the chevron the Select draws over the field.
            select: { appearance: "none", paddingRight: "3.6rem", cursor: "pointer" },
        },
        mono: {
            // Addresses, ports, paths and keys (#476).
            true: { fontFamily: "var(--vox_font_mono)" },
            false: {},
        },
    },
    defaultVariants: { kind: "text", mono: false },
});

export const selectWrap = style({ position: "relative", display: "block", width: "100%", minWidth: 0 });

export const chevron = style({
    position: "absolute",
    top: "50%",
    right: "1.2rem",
    width: "1.2rem",
    height: "1.2rem",
    marginTop: "-.6rem",
    color: vars.vox_secondary_text,
    pointerEvents: "none",
});

// The open list of a native select is drawn by the system; give its rows the field's colours
// where the engine lets us (WebView2 does, WebKitGTK partly).
globalStyle(`${selectWrap} option`, { background: vars.vox_surface, color: vars.dark_basic_text_color });
