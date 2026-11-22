import { style } from "@vanilla-extract/css";
import { loader as spinner, toggleControl } from "../../common_css/mixins.ts";

// The states the component sets on both the switch and its track.
export const is_active = style({});
export const is_pending = style({});
// The track's hovered and pressed looks, which a parent may set (toggleControl).
export const is_hovered = style({});
export const is_mouse_down = style({});

export const toggle_switch_container = style({
    position: "relative",
    display: "inline-flex",
    // Long labels or status text wrap instead of narrowing the switch.
    flexShrink: 0,
    alignItems: "center",
    selectors: {
        [`&.${is_pending}`]: { pointerEvents: "none" },
    },
});

// The track, as the SCSS mixin's nested .control: a descendant of the container.
export const control = style(toggleControl({ parent: toggle_switch_container, isPending: is_pending, isHovered: is_hovered, isMouseDown: is_mouse_down, isActive: is_active }));

export const loader = style(spinner({ size: "2rem", lineWidth: "0.2rem", position: "right", positionAmount: "-4rem" }));
