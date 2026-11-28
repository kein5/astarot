import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useI18n } from "@useI18n";
import { translator_status } from "../../logics/ui_configs.ts";
import { LOCAL_TRANSLATION_ENGINE, translatorLabel } from "../../logics/main/translatorLabel.ts";
import { Combobox, type ComboboxProps } from "../kit/index.ts";
import * as styles from "./Catalog.css.ts";

// A choice of one among many, found by typing (#1369): the select field's look on a button that
// opens the kit's Popover, with a search field over the choices and their group headings. Down
// and Up move through what can be chosen, Enter chooses; Escape, a press outside or a choice closes
// it and gives the focus back to the button. Shown with the translation engines of Settings →
// Translation, two of which cannot be used now.

const UNAVAILABLE = ["Papago_API", "Ollama"];

// The choice with the engines and the page's words; `grouped` false lists them under no heading.
type EngineChoiceProps = Omit<Partial<ComboboxProps>, "groups" | "options"> & { grouped?: boolean };

const EngineChoice = ({ value, grouped = true, ...props }: EngineChoiceProps) => {
    const { t } = useI18n();
    const [chosen, setChosen] = useState(value);
    const option = (engine: (typeof translator_status)[number]) => ({
        value: engine.id, label: translatorLabel(engine, t), disabled: UNAVAILABLE.includes(engine.id),
    });
    const local = translator_status.filter(engine => engine.id === LOCAL_TRANSLATION_ENGINE).map(option);
    const apis = translator_status.filter(engine => engine.id !== LOCAL_TRANSLATION_ENGINE).map(option);
    const key = (name: string) => t(`config_page.translation.select_translation_engine.${name}`);
    return (
        <Combobox value={chosen} onValueChange={setChosen}
            {...grouped ? { groups: [
                { id: "local", label: t("config_page.translation.local_section.label"), options: local },
                { id: "api", label: t("config_page.translation.api_section.label"), options: apis },
            ] } : { options: [...local, ...apis] }}
            aria-label={key("label")} placeholder={key("unselected")}
            searchLabel={key("search_label")} searchPlaceholder={key("search_placeholder")} emptyText={key("no_results")}
            {...props} />
    );
};

const meta = {
    title: "Kit/Combobox",
    component: EngineChoice,
    decorators: [Story => <div className={styles.fieldBox}><Story /></div>],
} satisfies Meta<typeof EngineChoice>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: () => <EngineChoice value="Groq_API" /> };

// The list open on the value, the search field focused.
export const Open: Story = { render: () => <EngineChoice value="Groq_API" defaultOpen /> };

// Nothing chosen: the placeholder's words, and the list opens on the first engine that can be chosen.
export const NothingChosen: Story = { render: () => <EngineChoice /> };

// One list with no headings.
export const WithoutGroups: Story = { render: () => <EngineChoice value="Groq_API" grouped={false} defaultOpen /> };

// While the value waits on the app: in its place and in the Tab order, half as strong, and it does not open.
export const Busy: Story = { render: () => <EngineChoice value="Groq_API" busy /> };

export const Disabled: Story = { render: () => <EngineChoice value="Groq_API" disabled /> };

// In a narrow column the words are cut at the field's edge; the list keeps the room it needs.
export const Narrow: Story = {
    render: () => (
        <div className={styles.narrowBox}>
            <EngineChoice value="Google_Cloud_API" />
        </div>
    ),
};
