import { useId, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useI18n } from "@useI18n";
import { CUSTOM, DEFAULT_THEME, PRESETS } from "../../logics/theme/themes.ts";
import { ChoiceCard } from "../kit/index.ts";
import { Example } from "./CatalogParts.tsx";
import * as styles from "./Catalog.css.ts";

// Choices drawn as cards (U-07): the native radio of one group inside each card, so the arrow keys
// move the choice and Tab enters the group at the one in use. The one in use has the accent frame
// and a check after its name. Here they are the theme choice of Settings → Appearance, with its
// words; the page draws a small picture of each theme, which a swatch of its two colours stands for.

const THEMES = [...PRESETS, { id: CUSTOM, colors: DEFAULT_THEME.custom }];

const ThemeCards = ({ start, disabled = false }: { start: string; disabled?: boolean }) => {
    const { t } = useI18n();
    const [chosen, setChosen] = useState(start);
    // Each example is a group of its own.
    const group = useId();
    return (
        <div role="radiogroup" aria-label={t("config_page.appearance.theme.label")} className={styles.row}>
            {THEMES.map(({ id, colors }) => (
                <ChoiceCard key={id} className={styles.choiceCard} name={group} value={id} checked={chosen === id} disabled={disabled}
                    onChange={() => setChosen(id)}
                    title={id === CUSTOM ? t("config_page.appearance.theme.custom") : t(`config_page.appearance.theme.presets.${id}`)}>
                    <span className={styles.themeSwatch} aria-hidden="true">
                        <span style={{ background: colors.base }} />
                        <span style={{ background: colors.accent }} />
                    </span>
                </ChoiceCard>
            ))}
        </div>
    );
};

const meta = {
    title: "Kit/ChoiceCard",
    component: ChoiceCard,
    // Each story draws its own group of cards, chosen by its own state; the controls of one card's
    // props would not reach it.
    args: { title: "" },
    parameters: { controls: { disable: true } },
} satisfies Meta<typeof ChoiceCard>;

export default meta;
type Story = StoryObj<typeof meta>;

// A click, Space or an arrow key chooses; the check and the accent frame follow.
export const Default: Story = { render: () => <ThemeCards start={PRESETS[0].id} /> };

export const States: Story = {
    render: () => (
        <div className={styles.stack}>
            <Example name="one in use"><ThemeCards start={PRESETS[1].id} /></Example>
            <Example name="disabled"><ThemeCards start={PRESETS[0].id} disabled /></Example>
        </div>
    ),
};
