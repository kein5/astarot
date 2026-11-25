import { useEffect, useState } from "react";
import type { MouseEvent } from "react";
import { useI18n } from "@useI18n";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useStore_IsOpenedConfigPage, useStore_SelectedConfigTabId } from "@store";
import { useConsentDialog } from "../../../logics/common/useConsentDialog";
import { useVirtualMic } from "../../../logics/voice/useVirtualMic";
import type { VirtualMicCheck } from "../../../logics/voice/useVirtualMic";
import { preferredCable } from "../../../logics/voice/virtualMic.ts";
import { Button, Dialog, DialogFooter, DialogHeader, DialogTitle, Select, SelectOption } from "../../kit/index.ts";
import * as styles from "../config_page/setting_section/setting_box/advanced_settings/VoiceSettings.css.ts";
import * as dialogStyles from "../config_page/setting_section/setting_box/_components/download_models/LegacyModelDownloadDialog.css.ts";
import * as noticeStyles from "./TelemetryNoticeController.css.ts";
import * as guideStyles from "./VirtualMicGuideController.css.ts";

export const VB_CABLE_URL = "https://vb-audio.com/Cable/";
// How often the guide looks again for a cable that is being installed.
const REDETECT_MS = 3000;
const CHECK_ERRORS = ["virtual_mic_voice_muted", "virtual_mic_recording_unavailable", "virtual_mic_playback_unavailable",
    "virtual_mic_missing", "virtual_mic_check_busy", "audio_devices_unavailable"];
// The cable's two device names for the sentences that name them; none before a cable is found.
type CableLabels = { playback?: string; recording?: string };

// The virtual microphone guide on Windows (#321). VRChat hears TTS and converted voice only
// through a virtual cable, which the app cannot install. It opens only when the user opens it:
// from the first-run setup's "Virtual microphone" row or from Settings → Text to speech (#943).
// It never opens by itself.
//
// It leads with what is needed and why, points to the cable's own download page, looks
// again every few seconds until a cable appears, plays a test tone through the cable while
// a meter shows what comes out of its other end, and ends with the microphone to pick in
// VRChat. It changes no setting and no device choice; the tone plays only when asked.
//
// "Close" (or "Done" once a cable is found) and Escape close it; it opens again only when asked.

export const VirtualMicGuideController = () => {
    const { t } = useI18n();
    const { status, check, opened, refreshStatus, startCheck, resetCheck, closeGuide } = useVirtualMic();
    const { updateIsOpenedConfigPage } = useStore_IsOpenedConfigPage();
    const { updateSelectedConfigTabId } = useStore_SelectedConfigTabId();
    const [chosen, setChosen] = useState<string | null>(null);
    const [linkFailed, setLinkFailed] = useState(false);

    const open = opened;
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
    const finish = () => {
        close();
        setChosen(null);
        closeGuide();
    };
    const putAway = () => { if (!running) finish(); };
    const openTtsSettings = () => {
        finish();
        updateSelectedConfigTabId("tts");
        updateIsOpenedConfigPage(true);
    };
    // Opens the cable's own page in the browser; nothing is downloaded by the app.
    const openDownloadPage = async (event: MouseEvent<HTMLElement>) => {
        if (!isTauri()) return;
        event.preventDefault();
        try { await openUrl(VB_CABLE_URL); setLinkFailed(false); }
        catch { setLinkFailed(true); }
    };
    const labels: CableLabels = cable ? { playback: cable.playback_label, recording: cable.recording_label } : {};
    const outputOnCable = cable && status?.tts_output_is_cable && status.tts_output !== null;

    // Named by its title, without a description, as before the kit (D-23, D-43).
    return <div className={`${styles.container} ${dialogStyles.host}`}>
        <Dialog ref={dialog} open={open} onOpenChange={putAway} aria-describedby={undefined}>
            <DialogHeader className={noticeStyles.notice}>
                <DialogTitle>{t("virtual_mic.title")}</DialogTitle>
                <p className={noticeStyles.purpose}>{t("virtual_mic.purpose")}</p>
                <p>{t("virtual_mic.not_needed")}</p>
            </DialogHeader>

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

            {found && cable && <>
                <section className={guideStyles.step} aria-labelledby="virtual-mic-found">
                    <h4 id="virtual-mic-found">{t("virtual_mic.found.heading")}</h4>
                    {cables.length > 1 && <label className={guideStyles.choice}>
                        <span>{t("virtual_mic.found.choose")}</span>
                        <Select value={cable.playback} disabled={running}
                            onChange={event => { setChosen(event.target.value); resetCheck(); }}>
                            {cables.map(item => <SelectOption key={item.playback} value={item.playback}>{item.playback_label}</SelectOption>)}
                        </Select>
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
                    {!outputOnCable && <p><Button onClick={openTtsSettings}>{t("virtual_mic.found.open_tts")}</Button></p>}
                </section>

                <section className={guideStyles.step} aria-labelledby="virtual-mic-test">
                    <h4 id="virtual-mic-test">{t("virtual_mic.test.heading")}</h4>
                    <p>{t("virtual_mic.test.what", labels)}</p>
                    <p className={guideStyles.note}>{t("virtual_mic.test.heard_by_others")}</p>
                    <div className={guideStyles.meter_row}>
                        <Button tone="primary" autoFocus disabled={running}
                            onClick={() => startCheck(cable.playback)}>
                            {t(running ? "virtual_mic.test.running" : "virtual_mic.test.start")}
                        </Button>
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

            {/* One way out: "Done" once a cable is found, "Close" while there is none. */}
            <DialogFooter>
                {found
                    ? <Button disabled={running} onClick={finish}>{t("virtual_mic.done")}</Button>
                    : <>
                        <Button onClick={finish}>{t("virtual_mic.close")}</Button>
                        <Button tone="primary" autoFocus onClick={openDownloadPage}>{t("virtual_mic.install.open_page")}</Button>
                    </>}
            </DialogFooter>
        </Dialog>
    </div>;
};

const CheckOutcome = ({ check, labels }: { check: VirtualMicCheck; labels: CableLabels }) => {
    const { t } = useI18n();
    if (check.phase === "failed") {
        const code = check.error !== null && CHECK_ERRORS.includes(check.error) ? check.error : "other";
        return <p role="alert" className={guideStyles.failed}>{t(`virtual_mic.test.error.${code}`, labels)}</p>;
    }
    // A finished check always carries its result (useVirtualMic).
    const result = check.result;
    if (check.phase !== "done" || !result) return null;
    if (result.stopped) return <p role="status">{t("virtual_mic.test.stopped")}</p>;
    if (result.heard) return <p role="status" className={guideStyles.heard}>{t("virtual_mic.test.heard", labels)}</p>;
    return <div role="alert" className={guideStyles.failed}>
        <p>{t("virtual_mic.test.not_heard", labels)}</p>
        <ul>
            <li>{t("virtual_mic.test.hint_volume", labels)}</li>
            <li>{t("virtual_mic.test.hint_restart")}</li>
        </ul>
    </div>;
};
