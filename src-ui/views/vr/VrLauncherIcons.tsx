import type { SVGProps } from "react";

// Marks the launcher draws itself, as the app's image set has none for them (#1314, V-4).

// More windows: four tiles.
export const WindowsSvg = (props: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" {...props}>
        <rect x="3" y="3" width="8" height="8" rx="1.5" />
        <rect x="13" y="3" width="8" height="8" rx="1.5" />
        <rect x="3" y="13" width="8" height="8" rx="1.5" />
        <rect x="13" y="13" width="8" height="8" rx="1.5" />
    </svg>
);

// Stop: a square, as a player's stop.
export const StopSvg = (props: SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" {...props}>
        <rect x="5" y="5" width="14" height="14" rx="2.5" />
    </svg>
);
