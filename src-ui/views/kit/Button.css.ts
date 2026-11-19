import { recipe, type RecipeVariants } from "@vanilla-extract/recipes";
import { vars } from "../theme/vars.css.ts";
import { colourTransition, disabledLook, focusRing } from "./shared.css.ts";

// The button looks of DESIGN.md (#474), as one recipe (#452):
// - primary: the Lilac fill with Dark Plum text, for the step a form or dialog exists for;
// - plain: the raised surface with a hairline border, the everyday action;
// - quiet: an outline, the secondary action paired with a filled one, never alone;
// - danger: removes something; its words are red, its body stays quiet.
export const button = recipe({
    base: {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: ".8rem",
        minHeight: "4rem",
        maxWidth: "100%",
        padding: ".8rem 1.6rem",
        border: ".1rem solid transparent",
        borderRadius: vars.vox_radius,
        font: "inherit",
        fontSize: "1.4rem",
        // shadcn/ui's Button: text-sm, font-medium.
        fontWeight: 500,
        lineHeight: 1.3,
        textAlign: "center",
        // Long Japanese labels wrap inside the button instead of pushing the row wider.
        whiteSpace: "normal",
        overflowWrap: "anywhere",
        cursor: "pointer",
        transition: colourTransition,
        selectors: {
            "&:focus-visible": focusRing,
            "&:disabled, &[aria-disabled='true']": disabledLook,
        },
    },
    variants: {
        tone: {
            primary: {
                background: vars.primary_600_color,
                color: vars.vox_on_primary,
                selectors: {
                    "&:hover:not(:disabled):not([aria-disabled='true'])": { background: vars.primary_550_color },
                    "&:active:not(:disabled):not([aria-disabled='true'])": { background: vars.primary_700_color },
                },
            },
            plain: {
                background: vars.vox_surface,
                borderColor: vars.vox_border,
                color: vars.dark_200_color,
                selectors: {
                    "&:hover:not(:disabled):not([aria-disabled='true'])": { background: vars.vox_secondary_hover },
                    "&:active:not(:disabled):not([aria-disabled='true'])": { background: vars.dark_925_color },
                },
            },
            quiet: {
                background: "transparent",
                borderColor: vars.vox_field_border,
                color: vars.dark_200_color,
                selectors: {
                    "&:hover:not(:disabled):not([aria-disabled='true'])": { background: vars.dark_850_color },
                    "&:active:not(:disabled):not([aria-disabled='true'])": { background: vars.dark_925_color },
                },
            },
            danger: {
                background: "transparent",
                borderColor: vars.vox_field_border,
                color: vars.vox_state_failed,
                selectors: {
                    "&:hover:not(:disabled):not([aria-disabled='true'])": { background: vars.dark_825_color },
                    "&:active:not(:disabled):not([aria-disabled='true'])": { background: vars.dark_850_color },
                },
            },
        },
        size: {
            regular: {},
            // Inside a row beside a field: the field's 4rem stays the tallest thing in the row.
            compact: { minHeight: "3.2rem", padding: ".4rem 1.2rem", fontSize: "1.3rem" },
        },
    },
    defaultVariants: { tone: "plain", size: "regular" },
});

export type ButtonVariants = NonNullable<RecipeVariants<typeof button>>;
