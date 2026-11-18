import { forwardRef, type ButtonHTMLAttributes } from "react";
import clsx from "clsx";
import { button, type ButtonVariants } from "./Button.css.ts";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & ButtonVariants;

// A button is type="button" unless it says otherwise, so a button inside a settings form never
// submits it by accident.
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    { tone, size, className, type = "button", ...rest },
    ref,
) {
    return <button ref={ref} type={type} className={clsx(button({ tone, size }), className)} {...rest} />;
});
