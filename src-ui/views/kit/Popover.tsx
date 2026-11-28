import { createContext, useCallback, useContext, useEffect, useRef, useState, type ComponentProps } from "react";
import * as RadixPopover from "@radix-ui/react-popover";
import clsx from "clsx";
import { content, type PopoverContentVariants } from "./Popover.css.ts";
import { appear, disappear, usePresence, type MotionSide } from "./motion.ts";

// shadcn/ui's Popover on Radix: the root holds open and onOpenChange; the trigger is the button
// that opens it (aria-expanded, aria-controls); Esc, a press outside and the trigger close it, and
// focus goes back to the trigger. It is not modal (Radix's default): a modal popover would hide the
// rest of the page from screen readers and add a <style> element at run time, which the CSP does
// not allow (docs/development.md).
//
// Its content fades in from its button and fades out toward it (motion.ts, #1378). The root says
// whether it is open, so the content stays drawn while it leaves; Radix closes it, as before, and
// gives the focus back to the trigger once it has left.

// Whether the kit's root holds the popover open. Null under a Radix root of the caller's own.
const PopoverOpenContext = createContext<boolean | null>(null);

// The root, open as its owner says (open and onOpenChange) or as it was last asked (defaultOpen).
export function Popover({ open: given, defaultOpen = false, onOpenChange, ...rest }: ComponentProps<typeof RadixPopover.Root>) {
    const [own, setOwn] = useState(defaultOpen);
    const open = given ?? own;
    // The last request is kept either way; it is what the root shows only while no owner says.
    const change = useCallback((next: boolean) => {
        setOwn(next);
        onOpenChange?.(next);
    }, [onOpenChange]);
    return (
        <PopoverOpenContext.Provider value={open}>
            <RadixPopover.Root data-slot="popover" open={open} onOpenChange={change} {...rest} />
        </PopoverOpenContext.Provider>
    );
}

export const PopoverTrigger = (props: ComponentProps<typeof RadixPopover.Trigger>) =>
    <RadixPopover.Trigger data-slot="popover-trigger" {...props} />;

export const PopoverAnchor = (props: ComponentProps<typeof RadixPopover.Anchor>) =>
    <RadixPopover.Anchor data-slot="popover-anchor" {...props} />;

export type PopoverContentProps = ComponentProps<typeof RadixPopover.Content> & PopoverContentVariants & {
    // In a portal at the end of the page (shadcn/ui's way) unless the panel is sized by its place,
    // as a panel sized by its column's container query is.
    portal?: boolean;
};

// The side Radix placed the panel on, after it moved it away from the window's edges.
const placedSide = (element: Element, asked: MotionSide): MotionSide => {
    const side = element.getAttribute("data-side");
    return side === "top" || side === "right" || side === "bottom" || side === "left" ? side : asked;
};

// PopoverContent: 4px from its trigger, centred under it unless told otherwise, as shadcn/ui's.
// A ref is one of the props and goes on to Radix's content with the rest.
export function PopoverContent({ className, inset, portal = true, align = "center", sideOffset = 4, ref, ...rest }: PopoverContentProps) {
    const presence = usePresence(useContext(PopoverOpenContext));
    const node = useRef<HTMLDivElement | null>(null);
    // The panel whose entrance has played: Radix gives the ref again when its own changes, and
    // the same panel does not fade in twice.
    const entered = useRef<HTMLDivElement | null>(null);
    const asked = rest.side ?? "bottom";
    const attach = useCallback((element: HTMLDivElement | null) => {
        node.current = element;
        if (element && element !== entered.current) {
            entered.current = element;
            appear(element, "popover", placedSide(element, asked));
        }
        if (typeof ref === "function") ref(element);
        else if (ref) ref.current = element;
    }, [ref, asked]);
    const { leaving, key, left } = presence;
    useEffect(() => {
        if (!leaving) return undefined;
        const element = node.current;
        if (!element) {
            left(key);
            return undefined;
        }
        // Cut short (opened again, or the popover taken away) it stops where it is; the drawing
        // that replaces it starts on its own.
        let current = true, ended = false;
        const exit = disappear(element, "popover", placedSide(element, asked));
        void exit.finished.then(() => {
            ended = true;
            if (current) left(key);
        });
        return () => {
            current = false;
            if (!ended) exit.stop();
        };
    }, [leaving, key, left, asked]);
    if (!presence.drawn) return null;
    // Drawn by the kit while it leaves, so Radix is told to keep it (forceMount); without the kit's
    // root, Radix shows and hides it.
    const kept = presence.managed ? true : undefined;
    // While it leaves it takes no presses: they reach what is under it, as they did once it was gone.
    const panel = <RadixPopover.Content key={key} ref={attach} data-slot="popover-content" data-leaving={leaving ? "" : undefined}
        forceMount={kept} align={align} sideOffset={sideOffset} className={clsx(content({ inset }), className)} {...rest} />;
    return portal ? <RadixPopover.Portal forceMount={kept}>{panel}</RadixPopover.Portal> : panel;
}
