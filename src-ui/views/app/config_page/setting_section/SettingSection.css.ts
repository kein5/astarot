import { globalStyle, style } from "@vanilla-extract/css";

export const scroll_container = style({ width: "100%", overflowY: "auto", overflowX: "hidden", overscrollBehavior: "contain" });

const NARROW_PADDING = { padding: ".4rem 1.6rem 3.2rem" } as const;
export const container = style({
    containerType: "inline-size",
    minWidth: 0,
    maxWidth: "112rem",
    margin: "0 auto 4rem",
    padding: ".8rem 3.2rem 4rem",
    "@media": { "(max-width: 800px)": NARROW_PADDING },
    // The UI-size-aware breakpoint (useWindow.ts) also selects the narrow layout.
    selectors: { "html[data-narrow] &": NARROW_PADDING },
});

// The first category heading sits right under the top bar; the 40px above a
// heading only separates it from the section before it.
globalStyle([
    `${container} > :first-child > [data-section-label]:first-child`,
    `${container} > :first-child > :first-child > [data-section-label]:first-child`,
    `${container} > :first-child > :first-child > :first-child > [data-section-label]:first-child`,
].join(", "), { paddingTop: 0 });

