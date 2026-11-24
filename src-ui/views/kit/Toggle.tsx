import type { ComponentProps } from "react";
import * as RadixToggle from "@radix-ui/react-toggle";
import * as RadixToggleGroup from "@radix-ui/react-toggle-group";
import clsx from "clsx";
import { group, groupItem, toggle, type ToggleVariants } from "./Toggle.css.ts";

export type ToggleProps = ComponentProps<typeof RadixToggle.Root> & ToggleVariants;

// shadcn/ui's Toggle: Radix gives the <button>, aria-pressed and data-state ("on" or "off"),
// pressed and onPressedChange; the kit gives the look. Name it by its words or an aria-label. A ref
// is one of the props and goes on to Radix's root with the rest.
export function Toggle({ tone, size, className, ...rest }: ToggleProps) {
    return <RadixToggle.Root data-slot="toggle" className={clsx(toggle({ tone, size }), className)} {...rest} />;
}

export type ToggleGroupProps = ComponentProps<typeof RadixToggleGroup.Root>;
export type ToggleGroupItemProps = ComponentProps<typeof RadixToggleGroup.Item>;

// shadcn/ui's ToggleGroup: Radix's root with type "single" (value, onValueChange) or "multiple"
// (values). With type "single" Radix names the items radios (role="radio", aria-checked) and moves
// between them with the arrow keys (rovingFocus); pressing the one that is on turns it off, so a
// group that must always have one on ignores an empty value.
export function ToggleGroup({ className, ...rest }: ToggleGroupProps) {
    return <RadixToggleGroup.Root data-slot="toggle-group" className={clsx(group, className)} {...rest} />;
}

export function ToggleGroupItem({ className, ...rest }: ToggleGroupItemProps) {
    return <RadixToggleGroup.Item data-slot="toggle-group-item" className={clsx(groupItem, className)} {...rest} />;
}
