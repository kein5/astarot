// Where a tooltip's bubble goes, and whether it has anything to add. No DOM is touched here:
// the component measures and hands the boxes in.

export type TooltipSide = "top" | "bottom" | "right" | "left";

export interface Box {
    left: number;
    top: number;
    width: number;
    height: number;
}

export interface Size {
    width: number;
    height: number;
}

// The sides tried after the wanted one: the opposite side first, then the other axis.
const FALLBACKS: Record<TooltipSide, readonly TooltipSide[]> = {
    top: ["top", "bottom", "right", "left"],
    bottom: ["bottom", "top", "right", "left"],
    right: ["right", "left", "bottom", "top"],
    left: ["left", "right", "bottom", "top"],
};

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(value, Math.max(low, high)));

// The bubble's corner in the window: on the wanted side of its control when it fits there,
// otherwise on the first side where it does, and never past the window's edges. The window clips
// nothing of it, whatever scrolls or clips the control itself.
// gap: the space between the control and the bubble. margin: the space kept to the window's edge.
export function placeTooltip(anchor: Box, bubble: Size, viewport: Size, wanted: TooltipSide, gap: number, margin: number) {
    const right = anchor.left + anchor.width, bottom = anchor.top + anchor.height;
    const fits: Record<TooltipSide, boolean> = {
        top: anchor.top - gap - bubble.height >= margin,
        bottom: bottom + gap + bubble.height <= viewport.height - margin,
        right: right + gap + bubble.width <= viewport.width - margin,
        left: anchor.left - gap - bubble.width >= margin,
    };
    const side = FALLBACKS[wanted].find(candidate => fits[candidate]) ?? wanted;
    if (side === "top" || side === "bottom") {
        return { side,
            left: clamp(anchor.left + anchor.width / 2 - bubble.width / 2, margin, viewport.width - margin - bubble.width),
            top: side === "top" ? anchor.top - gap - bubble.height : bottom + gap };
    }
    return { side,
        left: side === "right" ? right + gap : anchor.left - gap - bubble.width,
        top: clamp(anchor.top + anchor.height / 2 - bubble.height / 2, margin, viewport.height - margin - bubble.height) };
}

// An element as far as the words in sight are looked for: its text, its place and what holds it.
export interface WordsHolder {
    textContent: string | null;
    childElementCount: number;
    parentElement: WordsHolder | null;
    getBoundingClientRect: () => Size;
    querySelectorAll: (selector: string) => Iterable<WordsHolder>;
}

const collapse = (text: string | null) => (text ?? "").replace(/\s+/g, " ").trim();
// Words kept for screen readers are clipped to a dot (1px or .1rem): anything that small is not seen.
const drawn = (node: WordsHolder) => { const box = node.getBoundingClientRect(); return box.width > 2 && box.height > 2; };

// Whether the control already shows these words: a tooltip does not repeat what is in sight
// (#614). The words count as shown when one element of the control holds exactly them and is
// drawn, with everything between it and the control. A bar that hides its words in a narrow
// window (clipped, or not drawn at all) gets its tooltip back there.
export function wordsInSight(control: WordsHolder, words: string): boolean {
    const wanted = collapse(words);
    if (!wanted) return false;
    for (const node of [control, ...control.querySelectorAll("*")]) {
        if (node.childElementCount !== 0 || collapse(node.textContent) !== wanted) continue;
        let seen = true;
        for (let part: WordsHolder | null = node; part && seen; part = part === control ? null : part.parentElement) seen = drawn(part);
        if (seen) return true;
    }
    return false;
}
