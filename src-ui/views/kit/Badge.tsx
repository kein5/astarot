import type { ComponentProps } from "react";
import clsx from "clsx";
import { alertMark, badge, type BadgeVariants } from "./Badge.css.ts";

export type BadgeProps = ComponentProps<"span"> & BadgeVariants;

// shadcn/ui's Badge (data-slot="badge") in the look the catalogs' badges had (D-29): its words
// say the state, and tone, variant and mark repeat them (Badge.css.ts). The check and the ring are
// drawn by the badge itself; the "!" of a warning is a glyph, so it has an element of its own,
// hidden from assistive technology. A ref is one of the props, as React 19 passes it.
export function Badge({ tone, variant, mark, className, children, ...rest }: BadgeProps) {
    return (
        <span data-slot="badge" className={clsx(badge({ tone, variant, mark }), className)} {...rest}>
            {mark === "alert" ? <span className={alertMark} aria-hidden="true" /> : null}
            {children}
        </span>
    );
}
