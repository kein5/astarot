import type { Meta, StoryObj } from "@storybook/react-vite";
import { useI18n } from "@useI18n";
import { PRESETS } from "../../logics/theme/themes.ts";
import { Select, SelectOptGroup, SelectOption, type SelectProps } from "../kit/index.ts";
import * as styles from "./Catalog.css.ts";

// The system's <select> in the field's look (shadcn/ui's NativeSelect). The open list is drawn by the
// system: WebView2 takes the field's colours for its rows, WebKitGTK partly (Field.css.ts).

const FONTS = ["Yu Gothic UI", "Noto Sans JP", "Meiryo UI"];

// The theme choice of Settings → Appearance, with its words.
const ThemeSelect = ({ groups = false, ...props }: SelectProps & { groups?: boolean }) => {
    const { t } = useI18n();
    const presets = PRESETS.map(({ id }) => (
        <SelectOption key={id} value={id}>{t(`config_page.appearance.theme.presets.${id}`)}</SelectOption>
    ));
    const custom = <SelectOption value="custom">{t("config_page.appearance.theme.custom")}</SelectOption>;
    return (
        <Select aria-label={t("config_page.appearance.theme.label")} defaultValue="dark_plum" {...props}>
            {groups ? (
                <>
                    <SelectOptGroup label="Presets">{presets}</SelectOptGroup>
                    <SelectOptGroup label="Your own">{custom}</SelectOptGroup>
                </>
            ) : <>{presets}{custom}</>}
        </Select>
    );
};

// A font that is not on the PC: the longest words a select of the settings shows.
const FontSelect = (props: SelectProps) => {
    const { t } = useI18n();
    return (
        <Select aria-label={t("config_page.appearance.font_family.label")} defaultValue="missing" {...props}>
            <SelectOption value="missing">{t("config_page.appearance.font_family.not_installed", { name: "Yu Gothic UI" })}</SelectOption>
            {FONTS.slice(1).map(font => <SelectOption key={font} value={font}>{font}</SelectOption>)}
        </Select>
    );
};

const meta = {
    title: "Kit/Select",
    component: Select,
    argTypes: {
        invalid: { control: "boolean" },
        disabled: { control: "boolean" },
    },
    args: { invalid: false, disabled: false },
    decorators: [Story => <div className={styles.fieldBox}><Story /></div>],
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = { render: args => <ThemeSelect {...args} /> };

export const Default: Story = { render: () => <ThemeSelect /> };

// SelectOptGroup: the rows under a label of their own.
export const WithGroups: Story = { render: () => <ThemeSelect groups /> };

export const Invalid: Story = { render: () => <ThemeSelect invalid /> };

// The wrapper dims the field and its chevron together.
export const Disabled: Story = { render: () => <ThemeSelect disabled /> };

// A long choice stays inside the field; the chevron keeps its room.
export const LongOption: Story = {
    render: () => (
        <div className={styles.narrowBox}>
            <FontSelect />
        </div>
    ),
};
