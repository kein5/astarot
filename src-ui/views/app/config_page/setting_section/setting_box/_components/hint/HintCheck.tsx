import { useId } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { Description } from "../description/Description";
import { Hint, useHintDescriptions } from "./Hint";

// A checkbox with its name beside it, as the voice pages' forms draw one (#473), and what it
// does. On a page that keeps descriptions out of sight (#614) that is the hint after the name,
// opened by the pointer on the name or keyboard focus on the box; elsewhere a paragraph under
// it. Either way it is the box's accessible description. className is the label's, boxClassName
// the box's; the rest goes to the box.
export interface HintCheckProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className"> {
    label: ReactNode;
    description?: string;
    className?: string;
    boxClassName?: string;
}

export const HintCheck = ({ label, description, className, boxClassName, ...input }: HintCheckProps) => {
    const id = useId();
    const hint = useHintDescriptions() && description ? description : undefined;
    const descriptionId = description ? `${id}-description` : undefined;
    return <>
        <label className={className} data-hint-host={hint ? true : undefined}>
            <input type="checkbox" className={boxClassName} aria-describedby={descriptionId} {...input} />
            {/* The name's element holds the name only, as a label's does: the mark is beside it. */}
            <span><span>{label}</span>{hint && <Hint text={hint} id={descriptionId} />}</span>
        </label>
        {description && !hint && <Description id={descriptionId} text={description} />}
    </>;
};
