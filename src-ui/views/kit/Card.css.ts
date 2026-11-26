import { style } from "@vanilla-extract/css";
import { recipe, type RecipeVariants } from "@vanilla-extract/recipes";
import { vars } from "../theme/vars.css.ts";

// shadcn/ui's Card in the look the catalogs' cards had (D-28, decided on 2026-11-25): a card is a
// real unit (one model, engine or entry), so it keeps a quiet frame with no fill and no shadow, and
// its padding and the space between its parts stay as they were. How cards sit side by side or are
// read across (a catalog's grid and list) is the screen's layout, not the card's.

// Card. The card in use carries the active colour on its frame and the lilac tint, as a switch
// that is on.
export const card = recipe({
    base: {
        display: "grid",
        gap: "1.2rem",
        minWidth: 0,
        padding: "1.6rem",
        // The app's border colour, which the settings pages make quieter (#1233).
        border: `.1rem solid ${vars.vox_border}`,
        borderRadius: vars.vox_radius,
        // A card takes the focus when the page points at it (tabIndex -1): the forms' ring.
        selectors: { "&:focus-visible": { outline: `.2rem solid ${vars.primary_200_color}`, outlineOffset: ".3rem" } },
    },
    variants: {
        active: {
            true: { borderColor: vars.vox_state_active, background: vars.vox_highlight_tint },
            false: {},
        },
    },
    defaultVariants: { active: false },
});

export type CardVariants = NonNullable<RecipeVariants<typeof card>>;

// CardHeader: the name's line and what the thing is, read as one block, tight inside.
export const header = style({ display: "grid", gap: ".4rem", minWidth: 0 });

// CardTitle: the name, in the subheading's size.
export const title = style({ fontSize: "1.5rem", fontWeight: 600, color: vars.dark_200_color });

// CardDescription: what the thing is, in the general description's role (1.2rem, the description
// colour), breaking between phrases where the engine can.
export const description = style({
    fontSize: "1.2rem",
    lineHeight: 1.6,
    color: vars.vox_description_text,
    overflowWrap: "anywhere",
    wordBreak: "auto-phrase",
    textWrap: "pretty",
});

// CardContent and CardFooter: blocks a little apart from each other inside.
export const content = style({ display: "grid", gap: ".8rem", minWidth: 0 });
export const footer = style({ display: "grid", gap: ".8rem", minWidth: 0 });
