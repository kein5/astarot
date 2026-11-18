import { useEffect, useState } from "react";
import { atom, useAtom } from "jotai";
import { useI18n } from "@useI18n";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useOthers } from "@logics_configs";
import { useStore_IsOpenedConfigPage, useStore_SelectedConfigTabId } from "@store";
import { useConsentDialog } from "../../../logics/common/useConsentDialog";
import { useLocalAsrMigration } from "../../../logics/transcription/useLocalAsrMigration";
import { useVirtualMic } from "../../../logics/voice/useVirtualMic";
import { useFirstRunSetup } from "../../../logics/setup/useFirstRunSetup";
import { setupComesFirst } from "../../../logics/setup/firstRunSetup.ts";
import { guideOpensByItself, preferredCable } from "../../../logics/voice/virtualMic.ts";
import styles from "../config_page/setting_section/setting_box/advanced_settings/VoiceSettings.module.scss";
import dialogStyles from "../config_page/setting_section/setting_box/_components/download_models/LegacyModelDownloadDialog.module.scss";
import noticeStyles from "./TelemetryNoticeController.module.scss";
import guideStyles from "./VirtualMicGuideController.module.scss";

export const VB_CABLE_URL = "https://vb-audio.com/Cable/";
// How often the guide looks again for a cable that is being installed.
const REDETECT_MS = 3000;
const CHECK_ERRORS = ["virtual_mic_voice_muted", "virtual_mic_recording_unavailable", "virtual_mic_playback_unavailable",
    "virtual_mic_missing", "virtual_mic_check_busy", "audio_devices_unavailable"];

// The virtual microphone guide on Windows (#321). VRChat hears TTS and converted voice only
// through a virtual cable, which the app cannot install. At start-up the guide opens by
// itself only when no cable is found (and after the usage notice and the speech recognition
// notice); it can also be opened from Settings → Text to speech at any time.
//
// It leads with what is needed and why, points to the cable's own download page, looks
// again every few seconds until a cable appears, plays a test tone through the cable while
// a meter shows what comes out of its other end, and ends with the microphone to pick in
// VRChat. It changes no setting and no device choice; the tone plays only when asked.
//
// "Later" and Escape put it away for this run. "Don't show again" and "Done" stop it from
// opening by itself; the entry in the settings stays.
//
// Put away for this run, outside the component: changing the UI language draws the main page
// again (App.jsx), and a guide put away must not open again then (#563).
const laterAtom = atom(false);

export const VirtualMicGuideController = () => {
    const { t } = useI18n();
    const { notice, status, check, opened, refreshStatus, startCheck, resetCheck, dismissNotice, closeGuide } = useVirtualMic();
    const { currentTelemetryNotice } = useOthers();
    const { notice: localAsrNotice } = useLocalAsrMigration();
    const firstRunSetup = useFirstRunSetup();
    const { updateIsOpenedConfigPage } = useStore_IsOpenedConfigPage();
    const { updateSelectedConfigTabId } = useStore_SelectedConfigTabId();
    const [later, setLater] = useAtom(laterAtom);
    // Once open by itself it stays open while a cable is installed, until the user closes it.
    const [shown, setShown] = useState(false);
    const [chosen, setChosen] = useState(null);
    const [linkFailed, setLinkFailed] = useState(false);

    // Other first-run notices and the first-run setup come first; one dialog at a time.
    const othersFirst = (currentTelemetryNotice.state === "ok" && currentTelemetryNotice.data?.pending === true)
        || localAsrNotice === true || setupComesFirst(firstRunSetup);
    const byItself = !later && !othersFirst && guideOpensByItself(notice, status);
    useEffect(() => { if (byItself) setShown(true); }, [byItself]);
    const open = opened || shown;
    const { dialog, close } = useConsentDialog(open);

    const cables = status?.cables ?? [];
    const found = cables.length > 0;
    // Look again while open and still without a cable: the user may be installing one.
    useEffect(() => {
        if (!open || found) return;
        refreshStatus();
        const timer = setInterval(refreshStatus, REDETECT_MS);
        return () => clearInterval(timer);
    }, [open, found, refreshStatus]);
    // The device list may have changed since start-up (a cable added, the TTS output saved).
    useEffect(() => { if (open && found) refreshStatus(); }, [open, found, refreshStatus]);

    if (!open) return null;
    const cable = cables.find(item => item.playback === chosen) ?? preferredCable(status);
    const running = check.phase === "running";
    const finish = (forGood) => {
        close();
        if (forGood) dismissNotice();
        setShown(false);
        setLater(true);
        setChosen(null);
        closeGuide();
    };
    const putAway = () => { if (!running) finish(false); };
    const openTtsSettings = () => {
        finish(false);
        updateSelectedConfigTabId("tts");
        updateIsOpenedConfigPage(true);
    };
    // Opens the cable's own page in the browser; nothing is downloaded by the app.
    const openDownloadPage = async event => {
        if (!isTauri()) return;
        event.preventDefault();
        try { await openUrl(VB_CABLE_URL); setLinkFailed(false); }
        catch { setLinkFailed(true); }
    };
    const labels = cable ? { playback: cable.playback_label, recording: cable.recording_label } : {};
    const outputOnCable = cable && status?.tts_output_is_cable && status.tts_output !== null;

    return <div className={`${styles.container} ${dialogStyles.host}`}>
        <dialog ref={dialog} className={dialogStyles.dialog} aria-label={t("virtual_mic.title")}
            onCancel={event => { event.preventDefault(); putAway(); }}>
            <div className={noticeStyles.notice}>
                <h3>{t("virtual_mic.title")}</h3>
                <p className={noticeStyles.purpose}>{t("virtual_mic.purpose")}</p>
                <p>{t("virtual_mic.not_needed")}</p>
            </div>

            {!found && <section className={guideStyles.step} aria-labelledby="virtual-mic-install">
                <h4 id="virtual-mic-install">{t("virtual_mic.install.heading")}</h4>
                <ol>
                    <li>
                        {t("virtual_mic.install.download")}{" "}
                        <a href={VB_CABLE_URL} onClick={openDownloadPage} target="_blank" rel="noreferrer">{t("virtual_mic.install.link")}</a>
                        {linkFailed && <span role="alert"> {t("model_downloads.link_error")} <code>{VB_CABLE_URL}</code></span>}
                    </li>
                    <li>{t("virtual_mic.install.setup")}</li>
                    <li>{t("virtual_mic.install.restart")}</li>
                </ol>
                <p className={guideStyles.note}>{t("virtual_mic.install.third_party")}</p>
                <p role="status" className={guideStyles.searching}>
                    {status?.error ? t("virtual_mic.install.list_error") : t("virtual_mic.install.searching")}
                </p>
            </section>}

            {found && <>
                <section className={guideStyles.step} aria-labelledby="virtual-mic-found">
                    <h4 id="virtual-mic-found">{t("virtual_mic.found.heading")}</h4>
                    {cables.length > 1 && <label className={guideStyles.choice}>
                        <span>{t("virtual_mic.found.choose")}</span>
                        <select value={cable.playback} disabled={running}
                            onChange={event => { setChosen(event.target.value); resetCheck(); }}>
                            {cables.map(item => <option key={item.playback} value={item.playback}>{item.playback_label}</option>)}
                        </select>
                    </label>}
                    <dl className={dialogStyles.facts}>
                        <div className={dialogStyles.fact}>
                            <dt>{t("virtual_mic.found.playback")}</dt><dd>{cable.playback_label}</dd>
                        </div>
                        <div className={dialogStyles.fact}>
                            <dt>{t("virtual_mic.found.recording")}</dt><dd>{cable.recording_label}</dd>
                        </div>
                    </dl>
                    <p>{outputOnCable ? t("virtual_mic.found.output_set", labels) : t("virtual_mic.found.output_unset", labels)}</p>
                    {!outputOnCable && <p><button type="button" onClick={openTtsSettings}>{t("virtual_mic.found.open_tts")}</button></p>}
                </section>

                <section className={guideStyles.step} aria-labelledby="virtual-mic-test">
                    <h4 id="virtual-mic-test">{t("virtual_mic.test.heading")}</h4>
                    <p>{t("virtual_mic.test.what", labels)}</p>
                    <p className={guideStyles.note}>{t("virtual_mic.test.heard_by_others")}</p>
                    <div className={guideStyles.meter_row}>
                        <button type="button" className="primary" autoFocus disabled={running}
                            onClick={() => startCheck(cable.playback)}>
                            {t(running ? "virtual_mic.test.running" : "virtual_mic.test.start")}
                        </button>
                        <div className={guideStyles.meter} role="meter" aria-label={t("virtual_mic.test.meter", labels)}
                            aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(check.level * 100)}>
                            <div className={guideStyles.meter_fill} style={{ transform: `scaleX(${check.level})` }} />
                        </div>
                    </div>
                    <CheckOutcome check={check} labels={labels} />
                </section>

                <section className={guideStyles.step} aria-labelledby="virtual-mic-vrchat">
                    <h4 id="virtual-mic-vrchat">{t("virtual_mic.vrchat.heading")}</h4>
                    <p>{t("virtual_mic.vrchat.select", labels)}</p>
                    <p>{t("virtual_mic.vrchat.confirm")}</p>
                </section>
            </>}

            <div className={styles.actions}>
                <button type="button" disabled={running} onClick={() => finish(false)}>{t("virtual_mic.later")}</button>
                {found
                    ? <button type="button" disabled={running} onClick={() => finish(true)}>{t("virtual_mic.done")}</button>
                    : <button type="button" className="primary" autoFocus onClick={openDownloadPage}>{t("virtual_mic.install.open_page")}</button>}
            </div>
            {!found && notice === true && <div className={dialogStyles.alternative}>
                <button type="button" onClick={() => finish(true)}>{t("virtual_mic.dont_show")}</button>
            </div>}
        </dialog>
    </div>;
};

const CheckOutcome = ({ check, labels }) => {
    const { t } = useI18n();
    if (check.phase === "failed") {
        const code = CHECK_ERRORS.includes(check.error) ? check.error : "other";
        return <p role="alert" className={guideStyles.failed}>{t(`virtual_mic.test.error.${code}`, labels)}</p>;
    }
    if (check.phase !== "done") return null;
    if (check.result.stopped) return <p role="status">{t("virtual_mic.test.stopped")}</p>;
    if (check.result.heard) return <p role="status" className={guideStyles.heard}>{t("virtual_mic.test.heard", labels)}</p>;
    return <div role="alert" className={guideStyles.failed}>
        <p>{t("virtual_mic.test.not_heard", labels)}</p>
        <ul>
            <li>{t("virtual_mic.test.hint_volume", labels)}</li>
            <li>{t("virtual_mic.test.hint_restart")}</li>
        </ul>
    </div>;
};
