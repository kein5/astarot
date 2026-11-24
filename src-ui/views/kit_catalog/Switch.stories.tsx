import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useArgs } from "storybook/preview-api";
import { useI18n } from "@useI18n";
import { Switch, type SwitchProps } from "../kit/index.ts";
import { Example } from "./CatalogParts.tsx";
import * as styles from "./Catalog.css.ts";

// On and off (Radix's Switch in the kit's look). The state shows three ways: the thumb's side, the
// track's fill and, in the app, the row's label (Kit/Setting); colour is never the only sign.

// Named as the setting it turns on in the app; alone here, by an aria-label.
const SendToVrchat = (props: SwitchProps) => {
    const { t } = useI18n();
    return <Switch aria-label={t("config_page.others.send_message_to_vrc.label")} {...props} />;
};

const Toggle = ({ start }: { start: boolean }) => {
    const [checked, setChecked] = useState(start);
    return <SendToVrchat checked={checked} onCheckedChange={setChecked} />;
};

const meta = {
    title: "Kit/Switch",
    component: Switch,
    argTypes: {
        checked: { control: "boolean" },
        disabled: { control: "boolean" },
    },
    args: { checked: true, disabled: false },
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

// Space or a click turns it, and the control follows.
export const Playground: Story = {
    render: function Render(args) {
        const [, updateArgs] = useArgs();
        return <SendToVrchat {...args} onCheckedChange={checked => updateArgs({ checked })} />;
    },
};

export const States: Story = {
    render: () => (
        <div className={styles.row}>
            <Example name="off"><Toggle start={false} /></Example>
            <Example name="on"><Toggle start /></Example>
            <Example name="disabled, off"><SendToVrchat checked={false} disabled /></Example>
            <Example name="disabled, on"><SendToVrchat checked disabled /></Example>
        </div>
    ),
};
