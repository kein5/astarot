import { forwardRef, type InputHTMLAttributes } from "react";
import clsx from "clsx";
import { field } from "./Field.css.ts";

export type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
    // Marks the value as wrong; the words that say why belong in the row's description.
    invalid?: boolean;
    // Addresses, ports, paths and keys.
    mono?: boolean;
};

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
    { invalid = false, mono = false, className, type = "text", ...rest },
    ref,
) {
    return (
        <input
            ref={ref}
            type={type}
            data-slot="input"
            aria-invalid={invalid || undefined}
            className={clsx(field({ kind: "text", mono }), className)}
            {...rest}
        />
    );
});
