import type { ComponentProps } from "react";
import clsx from "clsx";
import { field } from "./Field.css.ts";

export type TextareaProps = ComponentProps<"textarea"> & {
    // Marks the value as wrong; the words that say why belong beside the field (aria-describedby).
    invalid?: boolean;
    // Addresses, paths and keys.
    mono?: boolean;
    // Fills the room its screen gives it (Quick Chat's window) and grows with that room, instead of
    // starting at 8rem with an edge to drag, as a form's field does.
    fill?: boolean;
};

// A field of several lines, in the look of the kit's text field (Field.css.ts). It does not grow
// with its text by itself: a form's field has an edge to drag, and a field that fills its screen
// grows with the screen (D-13). A ref is one of the props and goes on to the <textarea> with the rest.
export function Textarea({ invalid = false, mono = false, fill = false, className, ...rest }: TextareaProps) {
    return (
        <textarea
            data-slot="textarea"
            aria-invalid={invalid || undefined}
            className={clsx(field({ kind: "textarea", mono, fill }), className)}
            {...rest}
        />
    );
}
