import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from "react";
import { animate } from "motion/mini";

// How the kit's surfaces come and go (#1378): Motion's animate(), on the Web Animations API, so
// the browser runs the animations and nothing runs a frame loop in JavaScript. The screens take
// these through the kit's parts and useAppear (index.ts); none of them imports Motion itself.
//
// Only the motion changes: an element is shown, takes the focus and joins the accessibility tree
// when it did before, and its entrance plays over that. An exit plays only where the kit itself
// keeps the element drawn while it leaves (a popover of the kit's root).

// The motion tokens of variables.css (DESIGN.md "Motion") in what Motion takes: seconds, and the
// four numbers of the easing curve. kit.test.ts holds them to variables.css.
export const MOTION_FAST = 0.12;
export const MOTION = 0.22;
export const EASE = [0.2, 0, 0, 1] as const;

// What comes and goes: a modal dialog with its dimming, a popover beside its button, and the
// page of a window that has just opened.
export type MotionSurface = "dialog" | "popover" | "window";
// The side of its button a popover opens on, as Radix names it (data-side).
export type MotionSide = "top" | "right" | "bottom" | "left";

// The user's or the system's wish for less motion, read each time something moves, as it can
// change while the app runs. The app has no setting of its own: WebView2 and WebKitGTK pass on the
// system's (prefers-reduced-motion).
export const prefersReducedMotion = (): boolean =>
    globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

// Where a surface is while out of sight, as a CSS translate: a dialog a little below its place, so
// it rises into it; a popover a little toward its button, so it comes from it. A window's page
// stays in place: the window itself is what appears, where the system put it. With reduced motion
// nothing moves, and the surfaces only fade (no motion beyond opacity).
const POPOVER_AWAY: Record<MotionSide, string> = {
    top: "0 .4rem",
    right: "-.4rem 0",
    bottom: "0 -.4rem",
    left: ".4rem 0",
};
const away = (surface: MotionSurface, side: MotionSide): string | null => {
    if (prefersReducedMotion() || surface === "window") return null;
    return surface === "dialog" ? "0 .8rem" : POPOVER_AWAY[side];
};

// The dimming behind a modal dialog (::backdrop) fades with it where the engine can animate a
// pseudo-element; elsewhere it is there at once, as before. Motion's animate() takes elements, not
// their pseudo-elements, so the dimming is animated by the Web Animations API that Motion's runs
// on, with the same tokens, and answers as one of Motion's animations does.
const canAnimateBackdrop = (): boolean =>
    typeof KeyframeEffect !== "undefined" && "pseudoElement" in KeyframeEffect.prototype;

const EASING = `cubic-bezier(${EASE.join(", ")})`;

const backdrop = (element: HTMLElement, opacity: [number, number]): Moving => {
    // Held at its first value until it starts, and at its last after an exit, which the dialog's
    // closing ends; after an entrance the dimming is the dialog's own again.
    const animation = element.animate({ opacity }, { duration: MOTION_FAST * 1000, easing: EASING, pseudoElement: "::backdrop",
        fill: opacity[1] === 0 ? "forwards" : "backwards" });
    return {
        // A stopped animation rejects its promise; it has settled all the same.
        finished: animation.finished.then(() => undefined, () => undefined),
        complete: () => { animation.finish(); },
        stop: () => { animation.cancel(); },
    };
};

// One entrance or exit, which may move more than one thing (a dialog and its dimming).
export interface Playback {
    // Jumps to the end: what a surface that goes away, or is drawn again at once, does.
    finish: () => void;
    // Stops where it is.
    stop: () => void;
    // Settled. An exit also settles after a time limit, so a window the system does not draw
    // (hidden in the tray) does not keep a closed popover on the page.
    finished: Promise<void>;
}

// What a Playback moves: one of Motion's animations, or the dimming's.
type Moving = Pick<ReturnType<typeof animate>, "complete" | "stop"> & { finished: Promise<unknown> };

const playback = (animations: Moving[], limit?: number): Playback => {
    const settled: Promise<void> = Promise.all(animations.map(animation => animation.finished)).then(() => undefined);
    let finished = settled;
    if (limit !== undefined) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const late = new Promise<void>(resolve => { timer = setTimeout(resolve, limit); });
        finished = Promise.race([settled, late]).finally(() => clearTimeout(timer));
    }
    return {
        finish: () => { for (const animation of animations) animation.complete(); },
        stop: () => { for (const animation of animations) animation.stop(); },
        finished,
    };
};

// A surface that has just been shown fades in, and moves into its place unless the user asked for
// less motion. The translate property is used, not transform, so a surface placed by its own
// transform keeps it.
export function appear(element: HTMLElement, surface: MotionSurface, side: MotionSide = "bottom"): Playback {
    const from = away(surface, side);
    const fade = surface === "window" ? MOTION : MOTION_FAST;
    const animations: Moving[] = [animate(element, from ? { opacity: [0, 1], translate: [from, "none"] } : { opacity: [0, 1] },
        { duration: fade, ease: EASE, translate: { duration: surface === "dialog" ? MOTION : MOTION_FAST, ease: EASE } })];
    if (surface === "dialog" && canAnimateBackdrop()) animations.push(backdrop(element, [0, 1]));
    return playback(animations);
}

// A surface that goes away fades out the way it came, quicker: the user has already moved on.
export function disappear(element: HTMLElement, surface: MotionSurface, side: MotionSide = "bottom"): Playback {
    const to = away(surface, side);
    const animations: Moving[] = [animate(element, to ? { opacity: [1, 0], translate: ["none", to] } : { opacity: [1, 0] },
        { duration: MOTION_FAST, ease: EASE })];
    if (surface === "dialog" && canAnimateBackdrop()) animations.push(backdrop(element, [1, 0]));
    return playback(animations, MOTION_FAST * 1000 + 200);
}

// Plays a surface's entrance each time `shown` turns true, for a surface a screen shows itself.
// A dialog is shown by showModal() in an effect (useConsentDialog), so its entrance waits for the
// effects and plays only once it is open; a page is on the screen as soon as it is drawn, so its
// entrance starts before the first paint, or it would be seen once without it. A surface that
// goes away, or is drawn again at once, jumps to the end.
export function useAppear(ref: RefObject<HTMLElement | null>, shown: boolean, surface: MotionSurface): void {
    const play = useCallback(() => {
        const element = ref.current;
        if (!shown || !element) return undefined;
        if (surface === "dialog" && "open" in element && element.open !== true) return undefined;
        const entrance = appear(element, surface);
        return () => entrance.finish();
    }, [ref, shown, surface]);
    useLayoutEffect(() => surface === "dialog" ? undefined : play(), [play, surface]);
    useEffect(() => surface === "dialog" ? play() : undefined, [play, surface]);
}

// Whether a surface the kit shows and hides is drawn: while it is open, and while its exit plays
// after it closed (leaving). Opened again while it leaves, it is drawn anew (a new key), as if it
// had closed first, so its parts start as they do when it opens. `open` null: the kit does not
// know (a Radix root of the caller's own shows and hides it), and it is drawn as Radix decides.
export interface Presence {
    managed: boolean;
    drawn: boolean;
    leaving: boolean;
    key: number;
    // The exit of the drawing with this key has ended.
    left: (key: number) => void;
}

type PresenceState = { open: boolean; leaving: boolean; key: number };

export function usePresence(open: boolean | null): Presence {
    const [state, setState] = useState<PresenceState>({ open: open === true, leaving: false, key: 0 });
    // Kept in step while drawing, as React allows for state that follows a prop: the drawing goes
    // on with the new state, and React draws again with it.
    let current = state;
    if (open !== null && open !== state.open) {
        current = open
            ? { open, leaving: false, key: state.leaving ? state.key + 1 : state.key }
            : { open, leaving: true, key: state.key };
        setState(current);
    }
    const left = useCallback((key: number) => {
        setState(previous => previous.leaving && previous.key === key ? { ...previous, leaving: false } : previous);
    }, []);
    return {
        managed: open !== null,
        drawn: open === null || current.open || current.leaving,
        leaving: current.leaving,
        key: current.key,
        left,
    };
}
