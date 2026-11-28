import { useId, useState } from "react";
import { useI18n } from "@useI18n";
import { Button, Popover, PopoverContent, PopoverTrigger } from "../../../../../kit/index.ts";
import type { CaptionSource } from "../../../../../../logics/transcription/realtimeCaptionState";
import * as css from "./InputChoice.css.ts";

// The two inputs a recognition model of the bundled server is chosen for (#1308 ★1).
const INPUTS: readonly CaptionSource[] = ["mic", "speaker"];

export interface InputChoiceProps {
    // The model's name, which the button's and the menu's names carry (WCAG 2.5.3, #1254).
    name: string;
    // The catalog id, as the other catalogs' "Use this model" carries it.
    id: string;
    // The inputs that use the model already: their items say so and are not pressed.
    used: readonly CaptionSource[];
    // Why no input can take a model now (a recognition server runs, the paths have unsaved edits):
    // said in the menu, whose items wait.
    waiting: string | null;
    disabled: boolean;
    // The card's hit area (catalogLayout.css.ts press), when the card is pressed anywhere for it.
    className?: string;
    onChoose: (input: CaptionSource) => void;
}

// "Use this model" on a recognition model's card (reported on 0.7.0-beta.4): a
// recognition model is used by Mic input or Listening, each with its own model, so the button opens
// a small menu of the two (the kit's Popover, D-25) instead of applying at once. An item is the same
// choice as Mic input's or Listening's field above the catalog, which stay. The menu is a group of
// buttons, as the quick settings panel is: Radix's trigger says aria-haspopup="dialog", which it is
// not, so the trigger names the group it opens instead. An item closes the menu before the check it
// starts changes anything the menu shows, so the menu fades out (motion.ts) as it was.
export const InputChoice = ({ name, id, used, waiting, disabled, className, onChoose }: InputChoiceProps) => {
    const { t } = useI18n();
    const [open, setOpen] = useState(false);
    const panel = useId();
    return <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild aria-haspopup="false" aria-expanded={open} aria-controls={open ? panel : undefined}>
            <button type="button" className={className ? `primary ${className}` : "primary"} data-use-model={id}
                aria-label={t("model_catalog.use_named", { name })} disabled={disabled}>{t("model_catalog.use")}</button>
        </PopoverTrigger>
        <PopoverContent id={panel} role="group" aria-label={t("model_catalog.use_for.label", { name })} align="start" inset="tight"
            collisionPadding={8} data-input-choice={id}>
            <div className={css.menu}>
                {waiting && <p className={css.waiting}>{waiting}</p>}
                {INPUTS.map(input => {
                    const inUse = used.includes(input);
                    return <Button key={input} className={css.item} data-input={input} disabled={inUse || !!waiting}
                        onClick={() => { setOpen(false); onChoose(input); }}>
                        {t(inUse ? `model_catalog.status.in_use_${input}` : `model_catalog.use_for.${input}`)}</Button>;
                })}
            </div>
        </PopoverContent>
    </Popover>;
};
