import type { ComponentProps } from "react";
import clsx from "clsx";
import { field } from "./Field.css.ts";

export type TextFieldProps = ComponentProps<"input"> & {
    // Marks the value as wrong; the words that say why belong in the row's description.
    invalid?: boolean;
    // Addresses, ports, paths and keys.
    mono?: boolean;
};

// A ref is one of the props and goes on to the <input> with the rest.
export function TextField({ invalid = false, mono = false, className, type = "text", ...rest }: TextFieldProps) {
    return (
        <input
            type={type}
            data-slot="input"
            aria-invalid={invalid || undefined}
            className={clsx(field({ kind: "text", mono }), className)}
            {...rest}
        />
    );
}
