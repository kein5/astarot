import type { ComponentProps } from "react";
import * as RadixSwitch from "@radix-ui/react-switch";
import clsx from "clsx";
import { root, thumb } from "./Switch.css.ts";

export type SwitchProps = ComponentProps<typeof RadixSwitch.Root>;

// Radix gives the role, aria-checked, Space and Enter, and the hidden input inside a form;
// the kit gives the look. Name it with a <label htmlFor> (SettingRow does) or aria-label. A ref is
// one of the props and goes on to Radix's root with the rest.
export function Switch({ className, ...rest }: SwitchProps) {
    return (
        <RadixSwitch.Root data-slot="switch" className={clsx(root, className)} {...rest}>
            <RadixSwitch.Thumb data-slot="switch-thumb" className={thumb} />
        </RadixSwitch.Root>
    );
}
