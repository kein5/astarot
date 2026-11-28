import { useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useI18n } from "@useI18n";
import { Button, Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Popover, PopoverContent, PopoverTrigger, Toggle,
    useAppear } from "../kit/index.ts";
import { Example, T } from "./CatalogParts.tsx";
import * as styles from "./Catalog.css.ts";

// How the kit's surfaces come and go (#1378), on Motion: a dialog fades in and rises into its place
// while its dimming fades in, and closes at once; a popover comes from its button and goes back
// toward it; a window's page fades in where it is. With reduced motion (the system's setting, which
// WebView2 and WebKitGTK pass on) nothing moves: the surfaces only fade. Turn the setting on in the
// system, or in the browser's tools (Rendering, prefers-reduced-motion), to see it.

const DialogExample = () => {
    const [open, setOpen] = useState(false);
    return (
        <Example name="dialog: fades in and rises, closes at once">
            <Button onClick={() => setOpen(true)}>Open the dialog</Button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogHeader>
                    <DialogTitle><T k="voice_ui.leave_title" /></DialogTitle>
                    <DialogDescription><T k="voice_ui.leave_hint" /></DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button autoFocus onClick={() => setOpen(false)}><T k="voice_ui.keep_editing" /></Button>
                </DialogFooter>
            </Dialog>
        </Example>
    );
};

const PopoverExample = ({ side }: { side: "top" | "right" | "bottom" | "left" }) => {
    const { t } = useI18n();
    return (
        <Example name={`popover on its button's ${side}: comes from it, goes back toward it`}>
            <Popover>
                <PopoverTrigger asChild><Button>{t("main_page.quick_settings")}</Button></PopoverTrigger>
                <PopoverContent inset="tight" side={side} aria-label={t("main_page.quick_settings")}>
                    <div className={styles.row}>
                        <Toggle size="compact" defaultPressed><T k="main_page.foreground" /></Toggle>
                    </div>
                </PopoverContent>
            </Popover>
        </Example>
    );
};

// A page as the settings window draws it once its settings have come: drawn anew by the button.
const Page = () => {
    const page = useRef<HTMLDivElement>(null);
    useAppear(page, true, "window");
    return (
        <div ref={page} className={styles.cardBox}>
            <p><T k="config_page.appearance.theme.desc" /></p>
        </div>
    );
};

const PageExample = () => {
    const [drawing, setDrawing] = useState(0);
    return (
        <Example name="a window's page: fades in where it is">
            <Button onClick={() => setDrawing(drawing + 1)}>Draw the page again</Button>
            <Page key={drawing} />
        </Example>
    );
};

const meta = {
    title: "Kit/Motion",
    // The examples draw their own surfaces, opened by their own buttons.
    parameters: { controls: { disable: true } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const DialogEntrance: Story = { render: () => <DialogExample /> };

export const PopoverEntranceAndExit: Story = {
    render: () => (
        <div className={styles.row}>
            {(["bottom", "top", "right", "left"] as const).map(side => <PopoverExample key={side} side={side} />)}
        </div>
    ),
};

export const WindowPage: Story = { render: () => <PageExample /> };
