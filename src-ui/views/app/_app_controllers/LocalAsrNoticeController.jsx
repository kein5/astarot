import { useI18n } from "@useI18n";
import { useStore_IsOpenedConfigPage, useStore_SelectedConfigTabId } from "@store";
import { useConsentDialog } from "../../../logics/common/useConsentDialog";
import { useLocalAsrMigration } from "../../../logics/transcription/useLocalAsrMigration";
import { useSpeechServers } from "../../../logics/voice/useSpeechServers";
import { asrModels } from "../../../logics/transcription/localAsrMigration.js";
import { OldWhisperWeights } from "../config_page/setting_section/setting_box/transcription/OldWhisperWeights";
import styles from "../config_page/setting_section/setting_box/advanced_settings/VoiceSettings.module.scss";
import dialogStyles from "../config_page/setting_section/setting_box/_components/download_models/LegacyModelDownloadDialog.module.scss";
import noticeStyles from "./TelemetryNoticeController.module.scss";

// Shown once to a user whose saved engine was the removed Whisper (#288): local recognition
// is now speech.cpp, which models the bundled ASR server needs and whether each is set, and
// the way to Settings → Speech recognition, where the models are reviewed and downloaded
// with consent. This dialog downloads nothing. Old Whisper weights, if any, can be deleted
// here after a confirmation; the same box stays in the settings.
//
// Closing it in any way (Close, Escape, or opening the settings) clears the flag for good.
export const LocalAsrNoticeController = () => {
    const { t } = useI18n();
    const { notice, dismissNotice } = useLocalAsrMigration();
    const { settings } = useSpeechServers();
    const { updateIsOpenedConfigPage } = useStore_IsOpenedConfigPage();
    const { updateSelectedConfigTabId } = useStore_SelectedConfigTabId();
    const open = notice === true;
    const { dialog, close } = useConsentDialog(open);

    if (!open) return null;
    const models = asrModels(settings);
    const done = () => { close(); dismissNotice(); };
    const openSettings = () => { done(); updateSelectedConfigTabId("transcription"); updateIsOpenedConfigPage(true); };
    return <div className={`${styles.container} ${dialogStyles.host}`}>
        <dialog ref={dialog} className={dialogStyles.dialog} aria-label={t("local_asr_notice.title")}
            onCancel={event => { event.preventDefault(); done(); }}>
            <div className={noticeStyles.notice}>
                <h3>{t("local_asr_notice.title")}</h3>
                <p>{t("local_asr_notice.removed")}</p>
                <p>{t("local_asr_notice.needs")}</p>
            </div>
            {/* Read from the speech server's asr profile, the place the models are set. */}
            {models && <dl className={dialogStyles.facts}>
                {[["asr_model", models.model], ["vad_model", models.vad_model]].map(([key, set]) =>
                    <div key={key} className={dialogStyles.fact}>
                        <dt>{t(`local_asr_notice.${key}`)}</dt>
                        <dd>{t(set ? "local_asr_notice.set" : "local_asr_notice.unset")}</dd>
                    </div>)}
            </dl>}
            <OldWhisperWeights inDialog />
            <div className={styles.actions}>
                <button type="button" onClick={done}>{t("local_asr_notice.close")}</button>
                {/* The way forward takes the first focus; it opens the settings, it does not download. */}
                <button type="button" className="primary" autoFocus onClick={openSettings}>{t("local_asr_notice.open_settings")}</button>
            </div>
        </dialog>
    </div>;
};
