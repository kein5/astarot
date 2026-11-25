import type { Meta, StoryObj } from "@storybook/react-vite";
import { useI18n } from "@useI18n";
import { Button, Popover, PopoverContent, PopoverTrigger, Toggle } from "../kit/index.ts";
import { Example, T } from "./CatalogParts.tsx";
import * as styles from "./Catalog.css.ts";

// A small panel that opens from a button (Radix's Popover in the kit's look; D-25): the raised
// surface, a hairline border and the overlay's shadow. Esc, a press outside or the button closes it,
// and the focus goes back to the button. The tight inset is for a panel of rows, such as the main
// window's quick settings.

const QuickSettings = ({ open }: { open?: boolean }) => {
    const { t } = useI18n();
    return (
        <Popover defaultOpen={open}>
            <PopoverTrigger asChild><Button>{t("main_page.quick_settings")}</Button></PopoverTrigger>
            <PopoverContent inset="tight" align="end" aria-label={t("main_page.quick_settings")}>
                <div className={styles.row}>
                    <Toggle size="compact" defaultPressed><T k="main_page.foreground" /></Toggle>
                </div>
            </PopoverContent>
        </Popover>
    );
};

const meta = {
    title: "Kit/Popover",
    component: PopoverContent,
} satisfies Meta<typeof PopoverContent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Panel: Story = {
    render: () => <Example name="tight, opened from its button"><QuickSettings /></Example>,
};

export const Open: Story = {
    render: () => <Example name="open"><QuickSettings open /></Example>,
};
