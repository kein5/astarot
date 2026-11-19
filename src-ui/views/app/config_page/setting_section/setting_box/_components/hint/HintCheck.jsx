import { useId } from "react";
import { Description } from "../description/Description";
import { Hint, useHintDescriptions } from "./Hint";

// A checkbox with its name beside it, as the voice pages' forms draw one (#473), and what it
// does. On a page that keeps descriptions out of sight (#614) that is the hint after the name,
// opened by the pointer on the name or keyboard focus on the box; elsewhere a paragraph under
// it. Either way it is the box's accessible description.
export const HintCheck = ({ label, description, className, ...input }) => {
    const id = useId();
    const hint = useHintDescriptions() && typeof description === "string";
    const descriptionId = description ? `${id}-description` : undefined;
    return <>
        <label className={className} data-hint-host={hint || undefined}>
            <input type="checkbox" aria-describedby={descriptionId} {...input} />
            <span>{label}{hint && <Hint text={description} id={descriptionId} />}</span>
        </label>
        {description && !hint && <Description id={descriptionId} text={description} />}
    </>;
};
