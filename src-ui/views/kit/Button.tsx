import { forwardRef, type ButtonHTMLAttributes } from "react";
import clsx from "clsx";
import { button, type ButtonVariants } from "./Button.css.ts";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & ButtonVariants;

// A button is type="button" unless it says otherwise, so a button inside a settings form never
// submits it by accident. data-slot names the part as shadcn/ui's Button does (DESIGN.md).
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    { tone, size, className, type = "button", ...rest },
    ref,
) {
    return <button ref={ref} type={type} data-slot="button" className={clsx(button({ tone, size }), className)} {...rest} />;
});
