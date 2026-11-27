import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef,
    type ComponentProps, type HTMLAttributes } from "react";
import clsx from "clsx";
import * as styles from "./Dialog.css.ts";

// shadcn/ui's Dialog, in the parts it is written with (DESIGN.md "Components"), on the native
// <dialog> the app's dialogs use: the browser keeps the focus in it, closes it on Esc and dims
// the window behind it. Whether it moves to Radix Dialog is D-23 of the shadcn/ui inventory
// (docs/design/components/shadcn-alignment.md); the parts stay the same either way.

// The ids the title and the description take, so that the dialog is named and described by them,
// as Radix links DialogTitle and DialogDescription to DialogContent.
type DialogIds = { title: string; description: string };
const DialogIdsContext = createContext<DialogIds | null>(null);

export type DialogProps = Omit<ComponentProps<"dialog">, "open"> & {
    // Shown as a modal while true.
    open: boolean;
    // Called with false when the dialog asks to close (Esc, or a form with method="dialog"); the
    // owner of `open` closes it, as with shadcn/ui's onOpenChange.
    onOpenChange: (open: boolean) => void;
    // Hidden, with its dimming, while a dialog opened from it is open over it (#1266 T-3).
    stepsBack?: boolean;
};

// DialogContent. A dialog without a description passes aria-describedby={undefined}, as with Radix.
// A ref is one of the props, as React 19 passes it; it gets the <dialog> the dialog also keeps.
export function Dialog({ open, onOpenChange, stepsBack = false, className, children, onCancel, onClose, ref, ...rest }: DialogProps) {
    const element = useRef<HTMLDialogElement | null>(null);
    const attach = useCallback((node: HTMLDialogElement | null) => {
        element.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
    }, [ref]);
    const base = useId();
    const ids = useMemo(() => ({ title: `${base}-title`, description: `${base}-description` }), [base]);
    useEffect(() => {
        const dialog = element.current;
        if (!dialog) return;
        if (open && !dialog.open) dialog.showModal();
        else if (!open && dialog.open) dialog.close();
    }, [open]);
    return (
        <DialogIdsContext.Provider value={ids}>
            <dialog
                ref={attach}
                data-slot="dialog-content"
                aria-labelledby={ids.title}
                aria-describedby={ids.description}
                className={clsx(styles.content, stepsBack && styles.stepsBack, className)}
                onCancel={event => {
                    onCancel?.(event);
                    event.preventDefault();
                    onOpenChange(false);
                }}
                onClose={event => {
                    onClose?.(event);
                    // Closed by the dialog itself, not by `open`: tell the owner. The event comes a
                    // task later, so a dialog shown again since then (React's StrictMode closes and
                    // shows it again in one go) stays open.
                    if (open && !event.currentTarget.open) onOpenChange(false);
                }}
                {...rest}
            >
                {children}
            </dialog>
        </DialogIdsContext.Provider>
    );
}

export const DialogHeader = ({ className, ...rest }: HTMLAttributes<HTMLDivElement>) => (
    <div data-slot="dialog-header" className={clsx(styles.header, className)} {...rest} />
);

export const DialogFooter = ({ className, ...rest }: HTMLAttributes<HTMLDivElement>) => (
    <div data-slot="dialog-footer" className={clsx(styles.footer, className)} {...rest} />
);

// A heading of the dialog's own, as Radix's DialogTitle is an <h2>.
export const DialogTitle = ({ className, ...rest }: HTMLAttributes<HTMLHeadingElement>) => {
    const ids = useContext(DialogIdsContext);
    return <h2 id={ids?.title} data-slot="dialog-title" className={clsx(styles.title, className)} {...rest} />;
};

export const DialogDescription = ({ className, ...rest }: HTMLAttributes<HTMLParagraphElement>) => {
    const ids = useContext(DialogIdsContext);
    return <p id={ids?.description} data-slot="dialog-description" className={clsx(styles.description, className)} {...rest} />;
};
