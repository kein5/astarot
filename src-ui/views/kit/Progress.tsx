import type { ComponentProps } from "react";
import clsx from "clsx";
import { progress } from "./Progress.css.ts";

export type ProgressProps = ComponentProps<"progress">;

// The system's <progress>, in the kit's look (shadcn/ui's Progress has Radix draw a bar of divs).
// It keeps what the native element gives: value and max, read out as a progress bar by screen
// readers, and no value at all for a bar that does not know how far it is (indeterminate). Name it
// with aria-label or a <label>. A ref is one of the props and goes on to the <progress> with the rest.
export function Progress({ className, ...rest }: ProgressProps) {
    return <progress data-slot="progress" className={clsx(progress, className)} {...rest} />;
}
