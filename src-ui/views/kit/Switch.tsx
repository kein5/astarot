import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import * as RadixSwitch from "@radix-ui/react-switch";
import clsx from "clsx";
import { root, thumb } from "./Switch.css.ts";

export type SwitchProps = ComponentPropsWithoutRef<typeof RadixSwitch.Root>;

// Radix gives the role, aria-checked, Space and Enter, and the hidden input inside a form;
// the kit gives the look. Name it with a <label htmlFor> (SettingRow does) or aria-label.
export const Switch = forwardRef<ElementRef<typeof RadixSwitch.Root>, SwitchProps>(function Switch(
    { className, ...rest },
    ref,
) {
    return (
        <RadixSwitch.Root ref={ref} className={clsx(root, className)} {...rest}>
            <RadixSwitch.Thumb className={thumb} />
        </RadixSwitch.Root>
    );
});
