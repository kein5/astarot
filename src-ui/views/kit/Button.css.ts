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
        // shadcn/ui's Button sizes: a button that starts or ends with an icon has less room at its
        // sides (has-[>svg]:px-3 at the default size, px-2.5 at sm), and a button that is only an
        // icon is square (icon, size-9). Its side is the regular height, which D-03 of the
        // shadcn/ui inventory (docs/design/components/) may still change.
        size: {
            regular: { selectors: { "&:has(> svg)": { paddingInline: "1.2rem" } } },
            // Inside a row beside a field: the field's 4rem stays the tallest thing in the row.
            compact: {
                minHeight: "3.2rem",
                padding: ".4rem 1.2rem",
                fontSize: "1.3rem",
                selectors: { "&:has(> svg)": { paddingInline: "1rem" } },
            },
            // Only an icon: the button's name is its aria-label.
            icon: { width: "4rem", height: "4rem", padding: 0 },
            // Only an icon, inside a dense row (the main rail's feature rows), so the row keeps room
            // for its words: a 2.8rem square, a pointer target over 24 CSS pixels (decided on
            // 2026-11-25, #1219). The kit's smallest square: shadcn/ui's icon-xs is 2.4rem, and its
            // icon-sm is 3.2rem, the kit's compact height.
            "icon-xs": { width: "2.8rem", height: "2.8rem", minHeight: "2.8rem", padding: 0 },
        },
    },
    defaultVariants: { tone: "plain", size: "regular" },
});

export type ButtonVariants = NonNullable<RecipeVariants<typeof button>>;
