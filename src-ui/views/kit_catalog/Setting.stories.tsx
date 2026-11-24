import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useI18n } from "@useI18n";
import { Select, SelectOption, SettingGroup, SettingRow, Switch, TextField } from "../kit/index.ts";
import * as styles from "./Catalog.css.ts";

// SettingGroup and SettingRow: where one setting ends and the next begins (#452). Groups are divided
// by a subheading and space, rows by a hairline; inside a row the label and its description sit
// together and the control beside them. The words are the settings page's own.

const FONTS = ["Yu Gothic UI", "Noto Sans JP", "Meiryo UI"];

const VrchatGroup = () => {
    const { t } = useI18n();
    const [send, setSend] = useState(true);
    const [onlyTranslated, setOnlyTranslated] = useState(false);
    const [muteSync, setMuteSync] = useState(true);
    return (
        <SettingGroup title={t("config_page.side_menu_labels.vrchat")}>
            <SettingRow layout="inline" label={t("config_page.others.send_message_to_vrc.label")} description={t("config_page.others.send_message_to_vrc.desc")}>
                {control => <Switch {...control} checked={send} onCheckedChange={setSend} />}
            </SettingRow>
            <SettingRow layout="inline" label={t("config_page.others.send_only_translated_messages.label")}>
                {control => <Switch {...control} checked={onlyTranslated} onCheckedChange={setOnlyTranslated} />}
            </SettingRow>
            <SettingRow layout="inline" label={t("config_page.others.notification_vrc_sfx.label")}>
                {control => <Switch {...control} checked={false} disabled />}
            </SettingRow>
            <SettingRow layout="inline" changed label={t("config_page.others.vrc_mic_mute_sync.label")} description={t("config_page.others.vrc_mic_mute_sync.desc")}>
                {control => <Switch {...control} checked={muteSync} onCheckedChange={setMuteSync} />}
            </SettingRow>
        </SettingGroup>
    );
};

// A port the app refuses: the row's description says why, the field's red border repeats it.
const OscGroup = () => {
    const { t } = useI18n();
    const [ip, setIp] = useState("127.0.0.1");
    const [port, setPort] = useState("99999");
    const portNumber = Number(port);
    const portInvalid = !/^\d+$/.test(port) || portNumber < 1 || portNumber > 65535;
    return (
        <SettingGroup title={t("config_page.advanced_settings.section_label_osc")}>
            <SettingRow label={t("config_page.advanced_settings.osc_ip_address.label")}>
                {control => <TextField {...control} mono value={ip} onChange={event => setIp(event.target.value)} />}
            </SettingRow>
            <SettingRow changed label={t("config_page.advanced_settings.osc_port.label")}
                description={portInvalid ? t("backend_errors.VALIDATION_OSC_PORT_INVALID") : undefined}>
                {control => <TextField {...control} mono inputMode="numeric" invalid={portInvalid} value={port} onChange={event => setPort(event.target.value)} />}
            </SettingRow>
        </SettingGroup>
    );
};

const DisplayGroup = () => {
    const { t } = useI18n();
    const [font, setFont] = useState(FONTS[0]);
    return (
        <SettingGroup title={t("config_page.appearance.section_label_display")}>
            <SettingRow label={t("config_page.appearance.font_family.label")}>
                {control => (
                    <Select {...control} value={font} onChange={event => setFont(event.target.value)}>
                        {FONTS.map(name => <SelectOption key={name} value={name}>{name}</SelectOption>)}
                    </Select>
                )}
            </SettingRow>
            <SettingRow label={t("config_page.appearance.ui_language.label")}>
                {control => (
                    <Select {...control} disabled value="ja">
                        <SelectOption value="ja">日本語</SelectOption>
                    </Select>
                )}
            </SettingRow>
        </SettingGroup>
    );
};

const Page = () => (
    <>
        <VrchatGroup />
        <OscGroup />
        <DisplayGroup />
    </>
);

// The two layouts, each with and without a description.
const Layouts = () => {
    const { t } = useI18n();
    const [on, setOn] = useState(true);
    return (
        <SettingGroup title={t("config_page.side_menu_labels.vrchat")}>
            <SettingRow layout="inline" label={t("config_page.others.send_message_to_vrc.label")} description={t("config_page.others.send_message_to_vrc.desc")}>
                {control => <Switch {...control} checked={on} onCheckedChange={setOn} />}
            </SettingRow>
            <SettingRow layout="inline" label={t("config_page.others.send_only_translated_messages.label")}>
                {control => <Switch {...control} checked={!on} onCheckedChange={next => setOn(!next)} />}
            </SettingRow>
            <SettingRow label={t("config_page.translation.deepl_auth_key.label")} description={t("config_page.translation.deepl_auth_key.desc", { translator: t("main_page.translator") })}>
                {control => <TextField {...control} type="password" mono defaultValue="catalog-example-key" />}
            </SettingRow>
            <SettingRow label={t("config_page.advanced_settings.osc_ip_address.label")}>
                {control => <TextField {...control} mono defaultValue="127.0.0.1" />}
            </SettingRow>
        </SettingGroup>
    );
};

// A group's description, under a heading one level up (an h2 where the page has no h2 of its own).
const Described = () => {
    const { t } = useI18n();
    return (
        <SettingGroup title={t("config_page.appearance.theme.label")} description={t("config_page.appearance.theme.desc")} headingLevel={2}>
            <SettingRow label={t("config_page.appearance.font_family.label")}>
                {control => (
                    <Select {...control} defaultValue={FONTS[0]}>
                        {FONTS.map(name => <SelectOption key={name} value={name}>{name}</SelectOption>)}
                    </Select>
                )}
            </SettingRow>
        </SettingGroup>
    );
};

const meta = {
    title: "Kit/Setting",
    component: SettingGroup,
    // The groups hold their own rows and state; there is nothing for the controls to set.
    args: { title: "", children: null },
    parameters: { controls: { disable: true } },
    decorators: [Story => <div className={styles.column}><Story /></div>],
} satisfies Meta<typeof SettingGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

// Three groups of the settings page: switches, fields and selects, with a disabled row, two changed
// rows (the lilac rule on their left) and a port the app refuses.
export const SettingsPage: Story = { render: () => <Page /> };

export const RowLayouts: Story = { render: () => <Layouts /> };

export const GroupWithDescription: Story = { render: () => <Described /> };

// Under 35.6rem the field rows put their control under the label; the switches stay at the row's end.
export const NarrowColumn: Story = {
    render: () => <div className={styles.narrowColumn}><Page /></div>,
};
