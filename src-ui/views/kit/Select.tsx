import { forwardRef, type SelectHTMLAttributes } from "react";
import clsx from "clsx";
import { chevron, field, selectWrap } from "./Field.css.ts";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean };

// A native <select> in the field's clothes. The system draws the open list, so keyboard use,
// screen readers and the VR panel's pointer behave as they do everywhere else; Radix Select was
// left out of this experiment because it writes a <style> element at run time (see
// docs/design/components/README.md).
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
    { invalid = false, className, children, ...rest },
    ref,
) {
    return (
        <span className={selectWrap}>
            <select
                ref={ref}
                aria-invalid={invalid || undefined}
                className={clsx(field({ kind: "select" }), className)}
                {...rest}
            >
                {children}
            </select>
            <svg className={chevron} viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                <path d="M2 4.25 6 8l4-3.75" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        </span>
    );
});
