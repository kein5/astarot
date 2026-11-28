import type { Meta, StoryObj } from "@storybook/react-vite";
import { useI18n } from "@useI18n";
import { TextField, type TextFieldProps } from "../kit/index.ts";
import { Example } from "./CatalogParts.tsx";
import * as styles from "./Catalog.css.ts";

// The text field of Field.css.ts: the surface, the field border and 4rem of height. In the app a
// settings row names it (SettingRow); alone here, an aria-label does, with the app's words.

const Search = (props: TextFieldProps) => {
    const { t } = useI18n();
    return <TextField aria-label={t("config_page.search.label")} placeholder={t("config_page.search.placeholder")} {...props} />;
};

const OscAddress = (props: TextFieldProps) => {
    const { t } = useI18n();
    return <TextField aria-label={t("config_page.advanced_settings.osc_ip_address.label")} mono {...props} />;
};

const OscPort = (props: TextFieldProps) => {
    const { t } = useI18n();
    return <TextField aria-label={t("config_page.advanced_settings.osc_port.label")} mono inputMode="numeric" {...props} />;
};

const ApiKey = (props: TextFieldProps) => {
    const { t } = useI18n();
    return <TextField aria-label={t("config_page.translation.deepl_auth_key.label")} type="password" mono {...props} />;
};

const meta = {
    title: "Kit/TextField",
    component: TextField,
    argTypes: {
        invalid: { control: "boolean" },
        mono: { control: "boolean" },
        disabled: { control: "boolean" },
        type: { control: "inline-radio", options: ["text", "password"] },
        placeholder: { control: "text" },
        defaultValue: { control: "text" },
    },
    args: { invalid: false, mono: false, disabled: false, type: "text" },
    decorators: [Story => <div className={styles.fieldBox}><Story /></div>],
} satisfies Meta<typeof TextField>;

export default meta;
type Story = StoryObj<typeof meta>;

// The key starts the field again when its default value changes: an uncontrolled input does not follow it.
export const Playground: Story = { render: args => <Search key={String(args.defaultValue)} {...args} /> };

export const Empty: Story = { render: () => <Search /> };

export const Filled: Story = { render: () => <Search defaultValue="OSC" /> };

// Addresses, ports, paths and keys (#476).
export const Mono: Story = { render: () => <OscAddress defaultValue="127.0.0.1" /> };

// The red border only repeats what the words under the label say (Kit/Setting, Invalid).
export const Invalid: Story = { render: () => <OscPort invalid defaultValue="99999" /> };

export const Disabled: Story = {
    render: () => (
        <div className={styles.stack}>
            <Example name="disabled, empty"><Search disabled /></Example>
            <Example name="disabled, filled"><OscPort disabled defaultValue="9000" /></Example>
        </div>
    ),
};

export const Password: Story = { render: () => <ApiKey defaultValue="catalog-example-key" /> };
