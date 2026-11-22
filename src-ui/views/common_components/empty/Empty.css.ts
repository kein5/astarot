import { style } from "@vanilla-extract/css";
import { vars } from "../../theme/vars.css.ts";

// shadcn/ui's Empty, read by DESIGN.md's rules: a centred column (flex-col items-center
// justify-center gap-6 p-6 text-center text-balance). It has no border or fill of its own, so
// its rounded-lg is left out. Its wider md:p-12 is left out too (D-39 of the shadcn/ui
// inventory, docs/design/components/): it opens inside lists and panels, not on a page.
export const empty = style({
    display: "flex",
    flex: "1 1 auto",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "2.4rem",
    minWidth: 0,
    padding: "2.4rem",
    textAlign: "center",
    textWrap: "balance",
});

// EmptyDescription: text-sm in the muted colour, which stands for the description text.
// Its relaxed line height is DESIGN.md's description line height.
export const description = style({
    fontSize: "1.4rem",
    lineHeight: 1.6,
    color: vars.vox_description_text,
});
