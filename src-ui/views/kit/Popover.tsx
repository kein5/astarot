import type { ComponentProps } from "react";
import * as RadixPopover from "@radix-ui/react-popover";
import clsx from "clsx";
import { content, type PopoverContentVariants } from "./Popover.css.ts";

// shadcn/ui's Popover on Radix: the root holds open and onOpenChange; the trigger is the button
// that opens it (aria-expanded, aria-controls); Esc, a press outside and the trigger close it, and
// focus goes back to the trigger. It is not modal (Radix's default): a modal popover would hide the
// rest of the page from screen readers and add a <style> element at run time, which the CSP does
// not allow (docs/development.md).
export const Popover = (props: ComponentProps<typeof RadixPopover.Root>) => <RadixPopover.Root data-slot="popover" {...props} />;

export const PopoverTrigger = (props: ComponentProps<typeof RadixPopover.Trigger>) =>
    <RadixPopover.Trigger data-slot="popover-trigger" {...props} />;

export const PopoverAnchor = (props: ComponentProps<typeof RadixPopover.Anchor>) =>
    <RadixPopover.Anchor data-slot="popover-anchor" {...props} />;

export type PopoverContentProps = ComponentProps<typeof RadixPopover.Content> & PopoverContentVariants & {
    // In a portal at the end of the page (shadcn/ui's way) unless the panel is sized by its place,
    // as a panel sized by its column's container query is.
    portal?: boolean;
};

// PopoverContent: 4px from its trigger, centred under it unless told otherwise, as shadcn/ui's.
// A ref is one of the props and goes on to Radix's content with the rest.
export function PopoverContent({ className, inset, portal = true, align = "center", sideOffset = 4, ...rest }: PopoverContentProps) {
    const panel = <RadixPopover.Content data-slot="popover-content" align={align} sideOffset={sideOffset}
        className={clsx(content({ inset }), className)} {...rest} />;
    return portal ? <RadixPopover.Portal>{panel}</RadixPopover.Portal> : panel;
}
