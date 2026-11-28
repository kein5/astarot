import { recipe, type RecipeVariants } from "@vanilla-extract/recipes";
import { vars } from "../theme/vars.css.ts";

// A small panel that opens from a button (shadcn/ui's Popover, on Radix; D-25, decided on
// 2026-11-25): the raised surface with a hairline border, the control radius and the overlay's
// shadow, as the quick settings panel has looked. Content made of rows that carry their own room
// (a menu of toggles) takes the tight inset.
export const content = recipe({
    base: {
        // In a portal at the end of the page, over every layer the screens draw (the rail opened
        // over the conversation is 40, a slider's value 100) and under the tooltips (1500), so a
        // panel opened from a part of a layer stays above it. Radix's wrapper takes this level.
        zIndex: 1000,
        maxWidth: "calc(100vw - 2.4rem)",
        border: `.1rem solid ${vars.vox_border}`,
        borderRadius: vars.vox_radius,
        background: vars.vox_surface,
        color: vars.dark_basic_text_color,
        boxShadow: vars.vox_shadow_overlay,
        outline: "none",
        selectors: {
            // While its exit plays (Popover.tsx), presses go to what is under it, as once it is gone.
            "&[data-leaving]": { pointerEvents: "none" },
        },
    },
    variants: {
        inset: {
            regular: { padding: "1.2rem 1.6rem" },
            tight: { padding: ".4rem" },
        },
    },
    defaultVariants: { inset: "regular" },
});

export type PopoverContentVariants = NonNullable<RecipeVariants<typeof content>>;
