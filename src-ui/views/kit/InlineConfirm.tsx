import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import clsx from "clsx";
import { Button, type ButtonProps } from "./Button.tsx";
import * as styles from "./InlineConfirm.css.ts";

// A confirmation asked inside the row it is about, before something is removed (H-07 of
// docs/design/components/hand-built-inventory.md): the row's actions make way for a sentence, the
// way back and the removal. It stays in the row, so it is not a dialog or a popover. Its parts are
// named after shadcn/ui's AlertDialog (Trigger, Content, Description, Cancel, Action), whose
// structure it follows; the owner of the row says when it is open, as with a controlled dialog.
//
// The focus: the way back takes it when the confirmation opens, so Enter or Space at once removes
// nothing; after the way back it returns to the button that opened the confirmation, as Radix
// returns it to a dialog's trigger. After the removal it is left where it is: the row goes away.

type InlineConfirmContextValue = {
    // The button that opens the confirmation, while it is drawn.
    trigger: (node: HTMLButtonElement | null) => void;
    // The way back was taken: the trigger gets the focus once it is drawn again.
    back: () => void;
};
const InlineConfirmContext = createContext<InlineConfirmContextValue | null>(null);

export type InlineConfirmProps = { children: ReactNode };

// The root around the row's actions and the confirmation that takes their place. It draws nothing
// of its own.
export function InlineConfirm({ children }: InlineConfirmProps) {
    const trigger = useRef<HTMLButtonElement | null>(null);
    const returning = useRef(false);
    // Made once: the parts below keep the same functions for as long as the row is drawn.
    const [value] = useState<InlineConfirmContextValue>(() => ({
        trigger: node => { trigger.current = node; },
        back: () => { returning.current = true; },
    }));
    // After each drawing: once the way back was taken and the trigger is on the page again.
    useLayoutEffect(() => {
        const node = trigger.current;
        if (!returning.current || !node?.isConnected) return;
        returning.current = false;
        node.focus();
    });
    return <InlineConfirmContext.Provider value={value}>{children}</InlineConfirmContext.Provider>;
}

// The row's button that opens the confirmation: the kit's Button in the look the row gives it.
// A ref is one of the props, as React 19 passes it; it gets the <button> the trigger also keeps.
export function InlineConfirmTrigger({ ref, ...rest }: ButtonProps) {
    const context = useContext(InlineConfirmContext);
    const attach = useCallback((node: HTMLButtonElement | null) => {
        context?.trigger(node);
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
    }, [context, ref]);
    return <Button ref={attach} {...rest} />;
}

// The confirmation in the row's place: a group named by what it removes, its sentence first, then
// the way back and the removal, on one line while they fit.
export type InlineConfirmContentProps = ComponentProps<"div"> & { "aria-label": string };

export const InlineConfirmContent = ({ className, ...rest }: InlineConfirmContentProps) => (
    <div role="group" data-slot="inline-confirm-content" className={clsx(styles.content, className)} {...rest} />
);

// What the removal does and what it leaves, in the description's size and colour.
export const InlineConfirmDescription = ({ className, ...rest }: ComponentProps<"p">) => (
    <p data-slot="inline-confirm-description" className={clsx(styles.description, className)} {...rest} />
);

// The way back: plain, and it takes the focus when the confirmation opens.
export function InlineConfirmCancel({ onClick, ...rest }: Omit<ButtonProps, "tone" | "autoFocus">) {
    const context = useContext(InlineConfirmContext);
    return <Button autoFocus onClick={event => { context?.back(); onClick?.(event); }} {...rest} />;
}

// The removal: the danger look (D-10), its words red, its body quiet.
export const InlineConfirmAction = (props: Omit<ButtonProps, "tone">) => <Button tone="danger" {...props} />;
