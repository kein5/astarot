import type { ComponentProps } from "react";
import clsx from "clsx";
import { button, type ButtonVariants } from "./Button.css.ts";

export type ButtonProps = ComponentProps<"button"> & ButtonVariants;

// A button is type="button" unless it says otherwise, so a button inside a settings form never
// submits it by accident. data-slot names the part as shadcn/ui's Button does (DESIGN.md). A ref is
// one of the props, as React 19 passes it, and goes on to the <button> with the rest.
export function Button({ tone, size, className, type = "button", ...rest }: ButtonProps) {
    return <button type={type} data-slot="button" className={clsx(button({ tone, size }), className)} {...rest} />;
}
