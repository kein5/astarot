import { globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../../../../theme/vars.css.ts";
import { MAIN_SECTION_CONTAINER, shorterThan } from "../../layout.ts";

// Above the conversation, at most 60% of the column. It is the part that gives
// way when the column is short: it shrinks (and scrolls) before the log and the
// composer do.
export const panel = style({
    flex: "0 1 auto",
    minHeight: "min(12rem, 30%)",
    maxHeight: "60%",
    overflowY: "auto",
    overscrollBehavior: "contain",
    margin: "0 1.6rem",
    padding: "1.2rem 1.6rem 1.6rem",
    border: `.1rem solid ${vars.vox_border}`,
    borderRadius: vars.vox_radius,
    // When the panel goes on below its edge (the legend at 850px tall, #437), a shade at the
    // edge and a visible thumb say so, as in the rail. The covers scroll with the content and
    // hide each shade at its end; the shades stay put. The plain canvas comes first, as a
    // fallback.
    background: [
        vars.vox_canvas,
        [
            `linear-gradient(${vars.vox_canvas} 30%, transparent) top / 100% 3.2rem no-repeat local`,
            `linear-gradient(transparent, ${vars.vox_canvas} 70%) bottom / 100% 3.2rem no-repeat local`,
            "radial-gradient(farthest-side at 50% 0, #0009, transparent) top / 100% 1.2rem no-repeat scroll",
            "radial-gradient(farthest-side at 50% 100%, #0009, transparent) bottom / 100% 1.2rem no-repeat scroll",
            vars.vox_canvas,
        ].join(", "),
    ],
    selectors: {
        "&::-webkit-scrollbar": { width: ".8rem" },
        "&::-webkit-scrollbar-track": { backgroundColor: "transparent" },
        "&::-webkit-scrollbar-thumb": {
            backgroundColor: vars.dark_750_color,
            border: `.2rem solid ${vars.vox_canvas}`,
            borderRadius: ".4rem",
        },
        "&:hover::-webkit-scrollbar-thumb": { backgroundColor: vars.dark_650_color },
    },
    // A short window has no room for both: the panel lies over the conversation
    // under the top bar until it is closed, and the column itself does not scroll.
    "@container": {
        [shorterThan(MAIN_SECTION_CONTAINER)]: {
            position: "absolute",
            zIndex: 20,
            inset: `${vars.main_page_topbar_height} .8rem .8rem`,
            minHeight: 0,
            maxHeight: "none",
            margin: 0,
            padding: ".8rem 1.2rem 1.2rem",
            background: vars.vox_surface,
            boxShadow: vars.vox_shadow_overlay,
        },
    },
});

export const head = style({
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: ".4rem 1.2rem",
    marginBottom: "1.2rem",
});

// The title and its hint. The bubble opens under the title at every width: the panel clips
// what goes above its first line.
export const title_line = style({ display: "flex", alignItems: "center" });
globalStyle(`${title_line} [data-slot="tooltip-content"]`, { top: "calc(100% + .6rem)", bottom: "auto" });

export const title = style({ fontSize: "1.6rem", fontWeight: 600, margin: 0 });

