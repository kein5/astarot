import { style } from "@vanilla-extract/css";
import { recipe, type RecipeVariants } from "@vanilla-extract/recipes";
import { vars } from "../theme/vars.css.ts";

// shadcn/ui's Badge in the look the catalogs' badges had (D-29, decided on 2026-11-25): a short
// word with square corners (4px) that says a state. Its words say the state; the colour, the fill
// and the mark only repeat them. The words wrap inside the badge rather than push the line wider.
// - tone: the colour of the words and the edge: neutral, muted (a state not reached yet), strong,
//   accent (Lilac, something speaks for it), active, warning, failed.
// - variant: outline (the default), solid (filled, dark words), tint (the active outline over the
//   lilac tint), dashed (the edge of what the user added).
// - mark: a check (it is there and can be used), an empty ring (not yet), or the "!" of a warning,
//   drawn before the words and never read out with them.

const mask = (svg: string) => `url("data:image/svg+xml,${svg}") center / contain no-repeat`;
const CHECK = mask("%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm3.4 5.3-4.1 4.2a.8.8 0 0 1-1.1 0L4.6 8.9a.8.8 0 1 1 1.1-1.1l1 1 3.6-3.6a.8.8 0 0 1 1.1 1.1z'/%3E%3C/svg%3E");
const RING = mask("%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ccircle cx='8' cy='8' r='5.6' fill='none' stroke='black' stroke-width='1.6'/%3E%3C/svg%3E");

// A badge with a mark lines the mark up with its words.
const withMark = { display: "inline-flex", alignItems: "center", gap: ".5rem" } as const;
// The check and the ring are drawn in the words' colour through their shape, so they follow the tone.
const drawn = (shape: string) => ({
    ...withMark,
    selectors: {
        "&::before": {
            content: '""',
            flex: "none",
            width: "1.2rem",
            height: "1.2rem",
            backgroundColor: "currentColor",
            WebkitMask: shape,
            mask: shape,
        },
    },
});

export const badge = recipe({
    base: {
        display: "inline-block",
        padding: ".1rem .8rem",
        border: `.1rem solid ${vars.dark_700_color}`,
        borderRadius: ".4rem",
        fontSize: "1.2rem",
        fontWeight: 500,
        lineHeight: 1.6,
        color: vars.vox_secondary_text,
        whiteSpace: "normal",
        overflowWrap: "anywhere",
    },
    variants: {
        tone: {
            neutral: {},
            muted: { color: vars.vox_description_text },
            strong: { color: vars.dark_200_color },
            accent: { borderColor: vars.primary_500_color, color: vars.primary_200_color },
            active: { borderColor: vars.vox_state_active, color: vars.vox_state_active },
            warning: { borderColor: vars.vox_state_warning, color: vars.vox_state_warning },
            failed: { borderColor: vars.vox_state_failed, color: vars.vox_state_failed },
        },
        variant: {
            outline: {},
            // A light fill with dark words; the active tone fills with its own colour (below).
            solid: { background: vars.dark_300_color, borderColor: vars.dark_300_color, color: vars.dark_950_color },
            tint: { background: vars.vox_highlight_tint },
            dashed: { borderStyle: "dashed" },
        },
        mark: {
            check: drawn(CHECK),
            ring: drawn(RING),
            alert: withMark,
        },
    },
    compoundVariants: [
        { variants: { tone: "active", variant: "solid" }, style: { background: vars.vox_state_active, borderColor: vars.vox_state_active } },
    ],
    defaultVariants: { tone: "neutral", variant: "outline" },
});

export type BadgeVariants = NonNullable<RecipeVariants<typeof badge>>;

// The "!" of a warning: a small amber disc before the words. The "!" is drawn here, so it is never
// part of the words that are read out or searched.
export const alertMark = style({
    display: "inline-flex",
    flex: "none",
    alignItems: "center",
    justifyContent: "center",
    width: "1.6rem",
    height: "1.6rem",
    borderRadius: "50%",
    background: vars.vox_state_warning,
    color: vars.dark_950_color,
    fontSize: "1.2rem",
    fontWeight: 700,
    lineHeight: 1,
    selectors: { "&::before": { content: '"!"' } },
});
