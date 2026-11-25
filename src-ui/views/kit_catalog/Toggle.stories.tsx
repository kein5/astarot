import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useArgs } from "storybook/preview-api";
import { useI18n } from "@useI18n";
import { Toggle, ToggleGroup, ToggleGroupItem, type ToggleProps } from "../kit/index.ts";
import { Example, T } from "./CatalogParts.tsx";
import * as styles from "./Catalog.css.ts";

// A button that stays pressed (Radix's Toggle in the kit's look), and a group of them of which one
// is on (Radix's ToggleGroup). Off a toggle is the plain button; on it carries the active edge and
// the lilac tint; the warning tone is mute's amber (D-27). Its words name what it turns on.

const STARTS = [false, true] as const;

// Named by the words it carries in the app: the main window's "Always on top".
const OnTop = (props: ToggleProps) => <Toggle {...props}><T k="main_page.foreground" /></Toggle>;

const Pressable = ({ start, ...props }: ToggleProps & { start: boolean }) => {
    const [pressed, setPressed] = useState(start);
    return <OnTop {...props} pressed={pressed} onPressedChange={setPressed} />;
};

const meta = {
    title: "Kit/Toggle",
    component: Toggle,
    argTypes: {
        tone: { control: "inline-radio", options: ["accent", "warning"] },
        size: { control: "inline-radio", options: ["regular", "compact"] },
        pressed: { control: "boolean" },
        disabled: { control: "boolean" },
    },
    args: { tone: "accent", size: "regular", pressed: true, disabled: false },
} satisfies Meta<typeof Toggle>;

export default meta;
type Story = StoryObj<typeof meta>;

// Space, Enter or a click turns it, and the control follows.
export const Playground: Story = {
    render: function Render(args) {
        const [, updateArgs] = useArgs();
        return <OnTop {...args} onPressedChange={pressed => updateArgs({ pressed })} />;
    },
};

export const States: Story = {
    render: () => (
        <div className={styles.row}>
            {STARTS.map(start => <Example key={String(start)} name={start ? "on" : "off"}><Pressable start={start} /></Example>)}
            <Example name="warning, on"><Toggle tone="warning" defaultPressed><T k="voice_ui.mute_row" /></Toggle></Example>
            <Example name="compact, on"><Pressable start size="compact" /></Example>
            <Example name="disabled, on"><OnTop pressed disabled /></Example>
        </div>
    ),
};

// The catalogs' layout switch: one of grid and list is on; pressing the one that is on keeps it.
const Layouts = () => {
    const { t } = useI18n();
    const [layout, setLayout] = useState("grid");
    return (
        <ToggleGroup type="single" value={layout} aria-label={t("model_catalog.layout.label")}
            onValueChange={value => { if (value) setLayout(value); }}>
            <ToggleGroupItem value="grid">{t("model_catalog.layout.grid")}</ToggleGroupItem>
            <ToggleGroupItem value="list">{t("model_catalog.layout.list")}</ToggleGroupItem>
        </ToggleGroup>
    );
};

export const Group: Story = {
    render: () => <Example name="single"><Layouts /></Example>,
};
