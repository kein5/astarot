import { globalStyle, style } from "@vanilla-extract/css";
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
        },
        mono: {
            // Addresses, ports, paths and keys (#476).
            true: { fontFamily: "var(--vox_font_mono)" },
            false: {},
        },
    },
    defaultVariants: { kind: "text", mono: false },
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

// The open list of a native select is drawn by the system; give its rows the field's colours
// where the engine lets us (WebView2 does, WebKitGTK partly).
globalStyle(`${selectWrap} option`, { background: vars.vox_surface, color: vars.dark_basic_text_color });
