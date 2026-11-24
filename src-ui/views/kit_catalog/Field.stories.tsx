import type { Meta, StoryObj } from "@storybook/react-vite";
import { useI18n } from "@useI18n";
import { PRESETS } from "../../logics/theme/themes.ts";
import { Select, SelectOption, TextField } from "../kit/index.ts";
import { Example } from "./CatalogParts.tsx";
import * as styles from "./Catalog.css.ts";

// Field.css.ts: one field for typing and one for choosing, in the same frame (#436, "選択欄が2種類ある").
// Each state below puts a TextField and a Select side by side, so a difference between them shows.

type State = { invalid?: boolean; disabled?: boolean; mono?: boolean; empty?: boolean };

const Pair = ({ invalid = false, disabled = false, mono = false, empty = false }: State) => {
    const { t } = useI18n();
    return (
        <div className={styles.fieldPair}>
            <TextField
                aria-label={t("config_page.advanced_settings.osc_ip_address.label")}
                placeholder={empty ? t("config_page.search.placeholder") : undefined}
                defaultValue={empty ? undefined : "127.0.0.1"}
                mono={mono}
                invalid={invalid}
                disabled={disabled}
            />
            <Select aria-label={t("config_page.appearance.theme.label")} defaultValue="dark_plum" invalid={invalid} disabled={disabled}>
                {PRESETS.map(({ id }) => (
                    <SelectOption key={id} value={id}>{t(`config_page.appearance.theme.presets.${id}`)}</SelectOption>
                ))}
            </Select>
        </div>
    );
};

const meta = {
    title: "Kit/Field",
    parameters: { controls: { disable: true } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const States: Story = {
    render: () => (
        <div className={styles.wideStack}>
            <Example name="default"><Pair /></Example>
            <Example name="placeholder (text field)"><Pair empty /></Example>
            <Example name="mono (text field)"><Pair mono /></Example>
            <Example name="invalid"><Pair invalid /></Example>
            <Example name="disabled"><Pair disabled /></Example>
        </div>
    ),
};
