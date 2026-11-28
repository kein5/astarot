import type { ComponentProps } from "react";
import clsx from "clsx";
import { chevron, field, selectWrap } from "./Field.css.ts";

export type SelectProps = ComponentProps<"select"> & { invalid?: boolean };
export type SelectOptionProps = ComponentProps<"option">;
export type SelectOptGroupProps = ComponentProps<"optgroup">;

// A native <select> in the field's clothes. It stays the engine's own control, so screen readers
// and the VR panel's pointer behave as they do everywhere else; where the engine can style the open
// list (`appearance: base-select`, WebView2) the list is in the app's look and a long value wraps,
// elsewhere the system draws it (Field.css.ts). Radix Select was left out of this experiment
// because it writes a <style> element at run time (see docs/design/components/README.md). It is
// shadcn/ui's NativeSelect (DESIGN.md): the same parts, named by the same data-slot. A ref is
// one of the props and goes on to the <select>.
export function Select({ invalid = false, className, children, ...rest }: SelectProps) {
    return (
        <span className={selectWrap} data-slot="native-select-wrapper">
            <select
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
}

// NativeSelectOption and NativeSelectOptGroup: a plain <option> and <optgroup> that name
// themselves. The rows' colours come from the wrapper (Field.css.ts), so these add no class.
export function SelectOption(props: SelectOptionProps) {
    return <option data-slot="native-select-option" {...props} />;
}

export function SelectOptGroup(props: SelectOptGroupProps) {
    return <optgroup data-slot="native-select-optgroup" {...props} />;
}
