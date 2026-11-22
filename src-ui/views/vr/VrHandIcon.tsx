// The hand the VR panel draws wherever a hand is named: the toolbar's anchors and the hand the
// launcher is on. One drawing; the right hand is its mirror image.
export const HAND_PATH = "M8 21v-5l-3-4V7M8 12V4.5a1.5 1.5 0 0 1 3 0V11M11 10V3.5a1.5 1.5 0 0 1 3 0V11M14 10.5V5a1.5 1.5 0 0 1 3 0v8c0 4-2 8-6 8H8";

export const VrHandIcon = ({ right = false, className }: { right?: boolean; className?: string }) => (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true"
        style={right ? { transform: "scaleX(-1)" } : undefined}><path d={HAND_PATH} /></svg>
);
