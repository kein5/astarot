import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useI18n } from "@useI18n";
import { Button, InlineConfirm, InlineConfirmAction, InlineConfirmCancel, InlineConfirmContent, InlineConfirmDescription,
    InlineConfirmTrigger } from "../kit/index.ts";
import { Example } from "./CatalogParts.tsx";
import * as styles from "./Catalog.css.ts";

// The confirmation inside a row (H-07), with the words of the catalogs' cards: Remove makes the
// row's actions give way to the sentence, Back and the removal. Back takes the focus when it opens,
// and after Back the focus returns to Remove.

type RowProps = { name: string; sentence: string; trigger: string; back: string; remove: string; use?: string };

const Row = ({ name, sentence, trigger, back, remove, use }: RowProps) => {
    const { t } = useI18n();
    const [removing, setRemoving] = useState(false);
    return (
        <InlineConfirm>
            {removing
                ? <InlineConfirmContent aria-label={t("translation_catalog.remove_confirm_label", { name })}>
                    <InlineConfirmDescription>{t(sentence)}</InlineConfirmDescription>
                    <InlineConfirmCancel onClick={() => setRemoving(false)}>{t(back)}</InlineConfirmCancel>
                    <InlineConfirmAction onClick={() => setRemoving(false)}>{t(remove)}</InlineConfirmAction>
                </InlineConfirmContent>
                : <div className={styles.row}>
                    {use ? <Button tone="primary">{t(use)}</Button> : null}
                    <InlineConfirmTrigger tone="danger" onClick={() => setRemoving(true)}>{t(trigger)}</InlineConfirmTrigger>
                </div>}
        </InlineConfirm>
    );
};

const Rows = () => (
    <div className={styles.stack}>
        <Example name="translation catalog">
            <Row name="Home server" sentence="translation_catalog.remove_confirm.api" trigger="translation_catalog.remove"
                back="translation_catalog.back" remove="translation_catalog.remove_do" use="translation_catalog.use.api" />
        </Example>
        <Example name="a model of your own">
            <Row name="Own model" sentence="user_models.remove_confirm" trigger="user_models.remove"
                back="model_downloads.back" remove="user_models.remove_do" />
        </Example>
    </div>
);

// The confirmation as it is drawn once Remove is pressed.
const Open = () => {
    const { t } = useI18n();
    return (
        <InlineConfirm>
            <InlineConfirmContent aria-label={t("user_models.remove_confirm_label", { name: "Own model" })}>
                <InlineConfirmDescription>{t("user_models.remove_confirm")}</InlineConfirmDescription>
                <InlineConfirmCancel>{t("model_downloads.back")}</InlineConfirmCancel>
                <InlineConfirmAction>{t("user_models.remove_do")}</InlineConfirmAction>
            </InlineConfirmContent>
        </InlineConfirm>
    );
};

const meta = {
    title: "Kit/InlineConfirm",
    component: InlineConfirm,
    // The rows hold their own state; there is nothing for the controls to set.
    args: { children: null },
    parameters: { controls: { disable: true } },
    decorators: [Story => <div className={styles.column}><Story /></div>],
} satisfies Meta<typeof InlineConfirm>;

export default meta;
type Story = StoryObj<typeof meta>;

// Press Remove, then Back or Remove: the confirmation stays in the row.
export const InARow: Story = { render: () => <Rows /> };

export const Opened: Story = { render: () => <Open /> };
