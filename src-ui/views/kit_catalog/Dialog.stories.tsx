import { useState, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useI18n } from "@useI18n";
import { Button, Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../kit/index.ts";
import { T } from "./CatalogParts.tsx";

// shadcn/ui's Dialog parts on the native <dialog>: shown with showModal(), so the focus stays in it,
// Esc closes it and ::backdrop dims the page. Each story opens with its dialog open; "Open the
// dialog" brings it back after it is closed.

type FrameProps = { described?: boolean; children: (close: () => void) => ReactNode };

const DialogFrame = ({ described = true, children }: FrameProps) => {
    const [open, setOpen] = useState(true);
    return (
        <>
            <Button onClick={() => setOpen(true)}>Open the dialog</Button>
            {/* A dialog without a description says so, as with Radix. */}
            <Dialog open={open} onOpenChange={setOpen} {...(described ? {} : { "aria-describedby": undefined })}>
                {children(() => setOpen(false))}
            </Dialog>
        </>
    );
};

// The settings page's leave confirmation: the safe choice first and focused, the one that removes
// something in the danger look.
const Leave = ({ described = true }: { described?: boolean }) => (
    <DialogFrame described={described}>
        {close => (
            <>
                <DialogHeader>
                    <DialogTitle><T k="voice_ui.leave_title" /></DialogTitle>
                    {described ? <DialogDescription><T k="voice_ui.leave_hint" /></DialogDescription> : null}
                </DialogHeader>
                <DialogFooter>
                    <Button autoFocus onClick={close}><T k="voice_ui.keep_editing" /></Button>
                    <Button tone="danger" onClick={close}><T k="voice_ui.discard_leave" /></Button>
                </DialogFooter>
            </>
        )}
    </DialogFrame>
);

// A dialog that exists for one step: that step in the primary look, the way out beside it as quiet.
const Save = () => (
    <DialogFrame>
        {close => (
            <>
                <DialogHeader>
                    <DialogTitle><T k="voice_ui.leave_title" /></DialogTitle>
                    <DialogDescription><T k="voice_ui.leave_hint" /></DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button tone="primary" autoFocus onClick={close}><T k="voice_ui.save_changes" /></Button>
                    <Button tone="quiet" onClick={close}><T k="voice_ui.discard" /></Button>
                </DialogFooter>
            </>
        )}
    </DialogFrame>
);

// More words than the window holds: the dialog scrolls inside, its corners and room kept.
const Long = () => {
    const { t } = useI18n();
    return (
        <DialogFrame>
            {close => (
                <>
                    <DialogHeader>
                        <DialogTitle>{t("config_page.appearance.theme.label")}</DialogTitle>
                        <DialogDescription>{t("config_page.appearance.theme.desc")}</DialogDescription>
                    </DialogHeader>
                    <p>{t("config_page.appearance.theme.base.desc")}</p>
                    <p>{t("config_page.appearance.theme.accent.desc")}</p>
                    <p>{t("config_page.transcription.api_entries.add_help")}</p>
                    <DialogFooter>
                        <Button autoFocus onClick={close}><T k="voice_ui.keep_editing" /></Button>
                    </DialogFooter>
                </>
            )}
        </DialogFrame>
    );
};

const meta = {
    title: "Kit/Dialog",
    component: Dialog,
    // Each story draws its own dialog, opened and closed by its own buttons; the controls of Dialog's
    // props would not reach it.
    args: { open: true, onOpenChange: () => {} },
    parameters: { controls: { disable: true } },
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Confirm: Story = { render: () => <Leave /> };

export const WithoutDescription: Story = { render: () => <Leave described={false} /> };

export const PrimaryAction: Story = { render: () => <Save /> };

export const LongContent: Story = { render: () => <Long /> };
