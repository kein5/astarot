import { recipe, type RecipeVariants } from "@vanilla-extract/recipes";
import { style } from "@vanilla-extract/css";
import { vars } from "../theme/vars.css.ts";
import { colourTransition, disabledLook, focusRing } from "./shared.css.ts";

// A button that stays pressed (shadcn/ui's Toggle, on Radix Toggle; D-27, decided on 2026-11-25).
// Off it is the plain button (Button.css.ts); on it carries the active colour on its edge and the
// lilac tint, as a card in use does. The warning tone is mute's: amber while pressed, as the stop
// actions have always drawn it (D-27 keeps it). Its words say the state too; colour only repeats them.
const on = "&[data-state='on']";
// A toggle that cannot be used now but keeps its place in the Tab order (aria-disabled, while
// something waits) is drawn as a disabled one, as the kit's Button does.
const usable = ":not(:disabled):not([aria-disabled='true'])";
const unusable = "&:disabled, &[aria-disabled='true']";
export const toggle = recipe({
    base: {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: ".8rem",
        minHeight: "4rem",
        maxWidth: "100%",
        padding: ".8rem 1.6rem",
        border: `.1rem solid ${vars.vox_border}`,
        borderRadius: vars.vox_radius,
        background: vars.vox_surface,
        color: vars.dark_200_color,
        font: "inherit",
        fontSize: "1.4rem",
        fontWeight: 500,
        lineHeight: 1.3,
        textAlign: "center",
        whiteSpace: "normal",
        overflowWrap: "anywhere",
        cursor: "pointer",
        transition: colourTransition,
        selectors: {
            [`&:hover${usable}`]: { background: vars.vox_secondary_hover },
            "&:focus-visible": focusRing,
            [unusable]: disabledLook,
        },
    },
    variants: {
        tone: {
            accent: {
                selectors: {
                    [on]: { borderColor: vars.vox_state_active, background: vars.vox_highlight_tint },
                    [`${on}:hover${usable}`]: { background: vars.vox_highlight_tint },
                },
            },
            warning: {
                selectors: {
                    [on]: { borderColor: vars.vox_state_warning, color: vars.vox_state_warning, background: vars.dark_900_color },
                    [`${on}:hover${usable}`]: { background: vars.dark_850_color },
                },
            },
        },
        // The button's sizes (Button.css.ts): a toggle beside a field or in a dense row is compact.
        size: {
            regular: { selectors: { "&:has(> svg)": { paddingInline: "1.2rem" } } },
            compact: {
                minHeight: "3.2rem",
                padding: ".4rem 1.2rem",
                fontSize: "1.3rem",
                selectors: { "&:has(> svg)": { paddingInline: "1rem" } },
            },
            icon: { width: "4rem", height: "4rem", padding: 0 },
        },
    },
    defaultVariants: { tone: "accent", size: "regular" },
});

export type ToggleVariants = NonNullable<RecipeVariants<typeof toggle>>;

// A group of toggles of which one (or several) is on (shadcn/ui's ToggleGroup, on Radix): one
// hairline round the group, the one on raised as the bars of the app's fold are, the others quiet.
// It is the catalogs' layout switch as it has looked since #831.
export const group = style({
    display: "inline-flex",
    flex: "none",
    gap: ".2rem",
    maxWidth: "100%",
    padding: ".2rem",
    border: `.1rem solid ${vars.vox_border}`,
    borderRadius: vars.vox_radius,
});

export const groupItem = style({
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: ".6rem",
    minHeight: "3.2rem",
    padding: ".4rem 1rem",
    border: 0,
    borderRadius: `calc(${vars.vox_radius} - .2rem)`,
    background: "transparent",
    color: vars.vox_secondary_text,
    font: "inherit",
    fontSize: "1.3rem",
    fontWeight: 500,
    lineHeight: 1.3,
    cursor: "pointer",
    transition: colourTransition,
    selectors: {
        [`&:hover${usable}`]: { background: vars.vox_secondary_hover },
        [on]: { background: vars.dark_850_color, color: vars.dark_200_color, fontWeight: 600 },
        [`${on}:hover${usable}`]: { background: vars.dark_850_color },
        "&:focus-visible": { ...focusRing, outlineOffset: ".1rem" },
        [unusable]: disabledLook,
    },
});
