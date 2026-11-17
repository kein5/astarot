import { globalStyle, keyframes, style } from "@vanilla-extract/css";
import { vars } from "../../theme/vars.css.ts";
import { MAIN_PAGE_CONTAINER, SHORT_TOPBAR_HEIGHT, shorterThan } from "./layout.ts";

export const page = style({
    position: "absolute",
    width: "100%",
    height: "100%",
    top: 0,
    left: 0,
    overflow: "hidden",
    transition: "transform 0.12s ease-out",
});

export const showConfig = style({ transform: "translateY(-100%)" });
export const showMain = style({ transform: "translateY(0%)" });

// The rail and the conversation column. A size container: a short page gives its height
// to the conversation (layout.ts).
export const container = style({
    containerName: MAIN_PAGE_CONTAINER,
    containerType: "size",
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: vars.vox_canvas,
    position: "relative",
});

// A short window (the 200px minimum is 166px under the title bar): the rows that line up
// with the top bar (the rail's logo, the top bar, the language selector's bar) get lower together.
globalStyle(`${container} > *`, {
    "@container": { [shorterThan(MAIN_PAGE_CONTAINER)]: { vars: { [vars.main_page_topbar_height]: SHORT_TOPBAR_HEIGHT } } },
});

// While the engine starts, values it has not sent yet ([data-skeleton] in the sidebar)
// become flat blocks of exactly their own size: the text and icons are hidden, not
// removed, so nothing moves when the real values arrive. The pulse is slow and faint,
// and stops under reduced motion.
const skeletonPulse = keyframes({
    from: { opacity: 0.6 },
    to: { opacity: 1 },
});

const skeleton = `${page}[data-starting] [data-skeleton]`;
globalStyle(skeleton, {
    color: "transparent !important",
    background: `${vars.vox_skeleton} !important`,
    borderColor: "transparent !important",
    boxShadow: "none !important",
    borderRadius: ".4rem",
    animation: `${skeletonPulse} 1.8s ease-in-out infinite alternate`,
    "@media": { "(prefers-reduced-motion: reduce)": { animation: "none" } },
});
globalStyle(`${skeleton} *`, { visibility: "hidden" });
