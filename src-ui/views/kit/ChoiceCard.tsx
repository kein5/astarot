import type { ComponentProps, ReactNode } from "react";
import clsx from "clsx";
import CheckSvg from "@images/check_mark.svg?react";
import { card, check, radio, title as titleStyle } from "./ChoiceCard.css.ts";

export type ChoiceCardProps = Omit<ComponentProps<"input">, "type" | "title" | "children"> & {
    // The choice's name, under what the card shows of it. It names the radio too.
    title: ReactNode;
    // What the card shows of the choice above its name, such as a small picture of a theme.
    children?: ReactNode;
};

// One choice of a group, drawn as a card. shadcn/ui has no component for it; one of its Field
// examples builds it by wrapping a RadioGroupItem in a FieldLabel, and the parts here take those
// names. The control is the native radio (D-16 of docs/design/components/shadcn-alignment.md):
// the cards that share a `name` are one group, so the arrow keys move the choice within it, Tab
// enters and leaves it at the choice in use, and the label makes the whole card pressable and
// names the radio. The input's props (name, value, checked, onChange, disabled) and a ref go on
// to the radio; className goes on the card, for its place in the screen's layout.
export function ChoiceCard({ title, children, className, ...input }: ChoiceCardProps) {
    return (
        <label data-slot="field-label" className={clsx(card, className)}>
            <input data-slot="radio-group-item" className={radio} {...input} type="radio" />
            {children}
            <span data-slot="field-title" className={titleStyle}>
                {title}
                {/* Shown only while the radio is checked (ChoiceCard.css.ts). */}
                <CheckSvg data-slot="radio-group-indicator" className={check} aria-hidden="true" />
            </span>
        </label>
    );
}
