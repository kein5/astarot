import { useState } from "react";
import { useI18n } from "@useI18n";
import RefreshSvg from "@images/refresh.svg?react";
import { Button, Select, SelectOption, SettingGroup, SettingRow, Switch, TextField } from "../kit/index.ts";
import * as styles from "./KitLab.css.ts";

// The #452 component experiment on one page, for review in the dev server only
// (kit-lab.html on the Vite port; it is not one of the build's pages). The settings use
// real labels from the locales, so long Japanese text and narrow windows can be judged.
// Nothing here talks to the backend: every value lives in this page's state.
export const KitLab = () => {
    const { t, i18n } = useI18n();
    const [send, setSend] = useState(true);
    const [onlyTranslated, setOnlyTranslated] = useState(false);
    const [muteSync, setMuteSync] = useState(true);
    const [ip, setIp] = useState("127.0.0.1");
    const [port, setPort] = useState("99999");
    const [font, setFont] = useState("Yu Gothic UI");
    const portNumber = Number(port);
    const portInvalid = !/^\d+$/.test(port) || portNumber < 1 || portNumber > 65535;

    return (
        <main className={styles.page} lang={i18n.language}>
            {/* i18n-exempt-start: developer-only gallery headings, never shown in the app */}
            <header className={styles.bar}>
                <h1 className={styles.title}>#452 settings kit</h1>
                <div className={styles.tools}>
                    <Button size="compact" tone="quiet" onClick={() => void i18n.changeLanguage("ja")}>ja</Button>
                    <Button size="compact" tone="quiet" onClick={() => void i18n.changeLanguage("en")}>en</Button>
                </div>
            </header>
            <h2 className={styles.section}>Settings page</h2>
            {/* i18n-exempt-end */}
            <div className={styles.column}>
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

                <SettingGroup title={t("config_page.advanced_settings.section_label_osc")}>
                    <SettingRow label={t("config_page.advanced_settings.osc_ip_address.label")}>
                        {control => <TextField {...control} mono value={ip} onChange={event => setIp(event.target.value)} />}
                    </SettingRow>
                    <SettingRow changed label={t("config_page.advanced_settings.osc_port.label")}>
                        {control => <TextField {...control} mono inputMode="numeric" invalid={portInvalid} value={port} onChange={event => setPort(event.target.value)} />}
                    </SettingRow>
                </SettingGroup>

                <SettingGroup title={t("config_page.appearance.section_label_display")}>
                    <SettingRow label={t("config_page.appearance.font_family.label")}>
                        {control => (
                            <Select {...control} value={font} onChange={event => setFont(event.target.value)}>
                                {/* i18n-exempt-start: font family names */}
                                <SelectOption value="Yu Gothic UI">Yu Gothic UI</SelectOption>
                                <SelectOption value="Noto Sans JP">Noto Sans JP</SelectOption>
                                <SelectOption value="Meiryo UI">Meiryo UI</SelectOption>
                                {/* i18n-exempt-end */}
                            </Select>
                        )}
                    </SettingRow>
                    <SettingRow label={t("config_page.appearance.ui_language.label")}>
                        {/* i18n-exempt: a language code standing in for the real list */}
                        {control => <Select {...control} disabled value="ja"><SelectOption value="ja">ja</SelectOption></Select>}
                    </SettingRow>
                </SettingGroup>
            </div>

            {/* i18n-exempt: developer-only gallery heading */}
            <h2 className={styles.section}>Buttons</h2>
            <div className={styles.buttons}>
                <Button tone="primary">{t("voice_ui.save_changes")}</Button>
                <Button tone="quiet">{t("voice_ui.discard")}</Button>
                <Button>{t("model_downloads.review")}</Button>
                <Button tone="danger">{t("realtime.vocabulary_remove_short")}</Button>
                <Button tone="primary" disabled>{t("voice_ui.save_changes")}</Button>
                <Button size="compact">{t("model_downloads.review")}</Button>
                <Button><RefreshSvg className={styles.icon} aria-hidden="true" />{t("realtime.refresh_devices")}</Button>
                <Button size="icon" aria-label={t("realtime.refresh_devices")}><RefreshSvg className={styles.icon} aria-hidden="true" /></Button>
            </div>
        </main>
    );
};
