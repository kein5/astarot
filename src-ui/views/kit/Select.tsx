import { forwardRef, type OptgroupHTMLAttributes, type OptionHTMLAttributes, type SelectHTMLAttributes } from "react";
import clsx from "clsx";
import { chevron, field, selectWrap } from "./Field.css.ts";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean };
export type SelectOptionProps = OptionHTMLAttributes<HTMLOptionElement>;
export type SelectOptGroupProps = OptgroupHTMLAttributes<HTMLOptGroupElement>;

// A native <select> in the field's clothes. The system draws the open list, so keyboard use,
// screen readers and the VR panel's pointer behave as they do everywhere else; Radix Select was
// left out of this experiment because it writes a <style> element at run time (see
// docs/design/components/README.md). It is shadcn/ui's NativeSelect (DESIGN.md): the same
// parts, named by the same data-slot.
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
    { invalid = false, className, children, ...rest },
    ref,
) {
    return (
        <span className={selectWrap} data-slot="native-select-wrapper">
            <select
                ref={ref}
                data-slot="native-select"
                aria-invalid={invalid || undefined}
                className={clsx(field({ kind: "select" }), className)}
                {...rest}
            >
                {children}
            </select>
            <svg className={chevron} data-slot="native-select-icon" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                <path d="M2 4.25 6 8l4-3.75" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        </span>
    );
});

// NativeSelectOption and NativeSelectOptGroup: a plain <option> and <optgroup> that name
// themselves. The rows' colours come from the wrapper (Field.css.ts), so these add no class.
export const SelectOption = forwardRef<HTMLOptionElement, SelectOptionProps>(function SelectOption(props, ref) {
    return <option ref={ref} data-slot="native-select-option" {...props} />;
});

export const SelectOptGroup = forwardRef<HTMLOptGroupElement, SelectOptGroupProps>(function SelectOptGroup(props, ref) {
    return <optgroup ref={ref} data-slot="native-select-optgroup" {...props} />;
});
