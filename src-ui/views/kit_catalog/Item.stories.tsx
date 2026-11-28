import type { Meta, StoryObj } from "@storybook/react-vite";
import { useI18n } from "@useI18n";
import { Button, Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "../kit/index.ts";
import type { ItemProps, ItemState } from "../kit/index.ts";
import { Example } from "./CatalogParts.tsx";
import * as styles from "./Catalog.css.ts";

// shadcn/ui's Item, with the words of the app's two lists: the first-run setup's 「いまの状態」
// (#557), whose layout tells what needs the user before any word is read (#759, #614), and the
// term dictionary's rows (#792), compact, with a state shown by place and look.

// What the setup found: the rows that need the user first, each a card; the others in one frame.
const Findings = () => {
    const { t } = useI18n();
    const row = (state: ItemState, name: string, words: string, action?: string) => (
        <Item key={name} variant={state === "attention" ? "attention" : "default"}>
            <ItemMedia state={state} />
            <ItemContent>
                <ItemTitle>{t(name)}</ItemTitle>
                <ItemDescription>{t(words)}</ItemDescription>
            </ItemContent>
            {action ? <ItemActions><Button>{t(action)}</Button></ItemActions> : null}
        </Item>
    );
    return (
        <div className={styles.stack}>
            <Example name="variant=attention">
                <ItemGroup>
                    {row("attention", "first_run_setup.found.mic", "first_run_setup.found.mic_missing")}
                    {row("attention", "first_run_setup.found.translation", "first_run_setup.found.translation_missing",
                        "first_run_setup.choose_other")}
                </ItemGroup>
            </Example>
            <Example name="ItemGroup variant=outline">
                <ItemGroup variant="outline">
                    {row("checking", "first_run_setup.found.vrchat", "vrchat_presence.checking")}
                    {row("ready", "first_run_setup.found.virtual_mic", "first_run_setup.found.virtual_mic_found",
                        "first_run_setup.found.virtual_mic_open")}
                    {row("neutral", "first_run_setup.found.recognition", "first_run_setup.found.recognition_own_server")}
                    {row("ready", "first_run_setup.found.translation", "first_run_setup.found.translation_ready")}
                </ItemGroup>
            </Example>
        </div>
    );
};

// The dictionary's terms: compact rows, the written form, its readings beside it (under it in a
// narrow list) and the row's buttons at its end.
const TERMS: { written: string; readings: string; variant: ItemProps["variant"]; actions: string[] }[] = [
    { written: "Midnight Rooftop", readings: "みっどないと、るーふとっぷ", variant: "default",
        actions: ["realtime.vocabulary_change_readings", "realtime.vocabulary_remove_short"] },
    { written: "VRChat", readings: "ぶいちゃ", variant: "muted",
        actions: ["realtime.vocabulary_change_readings", "realtime.vocabulary_restore", "realtime.vocabulary_take_out"] },
    { written: "インスタンス", readings: "", variant: "removed", actions: ["realtime.vocabulary_put_back"] },
    { written: "ワールド", readings: "", variant: "default", actions: ["realtime.vocabulary_change_readings", "realtime.vocabulary_take_out"] },
];

const Terms = () => {
    const { t } = useI18n();
    return (
        <ItemGroup size="compact" aria-label={t("realtime.vocabulary_list", { count: TERMS.length - 1 })}>
            {TERMS.map(term => (
                <Item key={term.written} size="compact" variant={term.variant}>
                    <ItemContent>
                        <ItemTitle>{term.written}</ItemTitle>
                        <ItemDescription>{term.readings || t("realtime.vocabulary_no_reading")}</ItemDescription>
                    </ItemContent>
                    <ItemActions>
                        {term.actions.map(action => (
                            <Button key={action} size="compact" tone={action === "realtime.vocabulary_remove_short" ? "danger" : "plain"}>{t(action)}</Button>
                        ))}
                    </ItemActions>
                </Item>
            ))}
        </ItemGroup>
    );
};

const meta = {
    title: "Kit/Item",
    component: ItemGroup,
    // The lists hold their own rows; there is nothing for the controls to set.
    parameters: { controls: { disable: true } },
    decorators: [Story => <div className={styles.column}><Story /></div>],
} satisfies Meta<typeof ItemGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

// The first-run setup's 「いまの状態」: the cards of what needs the user, then the quiet rows.
export const WhatWasFound: Story = { render: () => <Findings /> };

// The term dictionary: a changed term on a tinted ground, one taken out quiet and struck through.
// Narrow the window below 52rem of list to see the readings go under the written form.
export const Compact: Story = { render: () => <Terms /> };
