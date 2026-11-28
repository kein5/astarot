import { style } from "@vanilla-extract/css";
import { vars } from "../../../../../../theme/vars.css.ts";
import { loader as spinner } from "../../../../../../common_css/mixins.ts";
import { focusRing } from "../../../../../../kit/shared.css.ts";

export const dense = style({});

export const container = style({
    height: "100%",
    display: "flex",
    justifyContent: "end",
    alignItems: "center",
});

// The switch's label, the target a press lands on: the switch and the space around it, as large as
// the checkbox's target was, so a row keeps its height (6.4rem with the 2.4rem switch). The switch
// ends where the row's fields end, so the target has no space after it (#474).
export const target = style({
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    gap: ".8rem",
    padding: "2rem 0 2rem 1.8rem",
    cursor: "pointer",
    selectors: {
        [`&.${dense}`]: { padding: ".8rem 0 .8rem .8rem" },
        "&[data-pending]": { cursor: "wait" },
        "&[data-unavailable]": { cursor: "not-allowed" },
    },
});

// Around the kit's switch. A switch that cannot be used is drawn half as strong, its focus ring too;
// it still takes focus here, so the ring is drawn again around it at full strength, the kit's ring.
export const slot = style({
    display: "inline-flex",
    borderRadius: "999rem",
    selectors: {
        '&:has(> [data-slot="switch"][data-disabled]:focus-visible)': focusRing,
    },
});

export const text = style({
    fontSize: "1.4rem",
    color: vars.dark_500_color,
    whiteSpace: "nowrap",
});

// While the change waits for the core: a spinner before the switch, in the target's space, so
// nothing moves when it appears.
const spinning = spinner({ size: "2rem", lineWidth: "0.2rem", position: "left", positionAmount: ".4rem" });
export const loader = style({ ...spinning, selectors: { ...spinning.selectors, [`${dense} > &`]: { left: "-.6rem" } } });
