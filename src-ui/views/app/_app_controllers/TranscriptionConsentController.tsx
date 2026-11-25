import { useEffect, useRef, useState } from "react";
import { useI18n } from "@useI18n";
import { useTranscription } from "@logics_configs";
import { useMainFunction } from "@logics_main";
import { useStore_IsOpenedConfigPage, useStore_SelectedConfigTabId } from "@store";
import { useTranscriptionConsent } from "../../../logics/transcription/useTranscriptionConsent";
import type { TranscriptionConsentRequest } from "../../../logics/transcription/useTranscriptionConsent";
import { useConsentDialog } from "../../../logics/common/useConsentDialog";
import * as styles from "../config_page/setting_section/setting_box/advanced_settings/VoiceSettings.css.ts";
import * as dialogStyles from "../config_page/setting_section/setting_box/_components/download_models/LegacyModelDownloadDialog.css.ts";
import { Button, Dialog, DialogFooter, DialogHeader, DialogTitle } from "../../kit/index.ts";

// The engine the user chose, and the request it answers.
type Selection = { engine: string; request: TranscriptionConsentRequest };

export const TranscriptionConsentController = () => {
    const { t } = useI18n();
    const { request, setRequest } = useTranscriptionConsent();
    const { currentSelectedTranscriptionEngine, setSelectedTranscriptionEngine } = useTranscription();
    const { setTranscriptionSend, setTranscriptionReceive } = useMainFunction();
    const { updateIsOpenedConfigPage } = useStore_IsOpenedConfigPage();
    const { updateSelectedConfigTabId } = useStore_SelectedConfigTabId();
    const { dialog, close } = useConsentDialog(!!request);
    const selection = useRef<Selection | null>(null);
    const [choice, setChoice] = useState<Selection | null>(null);
    const cancel = () => { selection.current = null; setChoice(null); close(); setRequest(null); };

    useEffect(() => () => { selection.current = null; setRequest(null); }, [setRequest]);
    useEffect(() => {
        const waiting = selection.current;
        if (!waiting || request !== waiting.request || currentSelectedTranscriptionEngine.state !== "ok") return;
        // A write being sent is not an acknowledgement. Continue only after the
        // saved selection comes back through the ordinary settings response.
        if (currentSelectedTranscriptionEngine.data !== waiting.engine) {
            selection.current = null;
            return;
        }
        selection.current = null;
        close();
        // Both choices start at once; a missing speech.cpp model is reported by the switch
        // itself, with the way to download it after consent.
        setRequest(null);
        // The request is the one the choice answers (checked above).
        (waiting.request.endpoint.endsWith("_send") ? setTranscriptionSend : setTranscriptionReceive)(true);
    }, [request, choice, currentSelectedTranscriptionEngine.data, currentSelectedTranscriptionEngine.state]);

    if (!request) return null;
    const choose = async (engine: string) => {
        if (selection.current) return;
        const waiting = { engine, request };
        selection.current = waiting;
        setChoice(waiting);
        const sent = await setSelectedTranscriptionEngine(engine);
        if (sent === false && selection.current === waiting) selection.current = null;
    };
    const pending = currentSelectedTranscriptionEngine.state === "pending";
    const openSettings = () => { cancel(); updateSelectedConfigTabId("transcription"); updateIsOpenedConfigPage(true); };
    // Named by its title, without a description, as before the kit (D-23, D-43).
    return <div className={`${styles.container} ${dialogStyles.host}`}>
        <Dialog ref={dialog} open={!!request} onOpenChange={cancel} aria-describedby={undefined}>
            <DialogHeader>
                <DialogTitle>{t("transcription_consent.title")}</DialogTitle>
                {request.mode === "choose" ? <>
                    <p>{t("transcription_consent.speechcpp_notice")}</p>
                    <p>{t("transcription_consent.cloud_notice")}</p>
                </> : <p>{t("backend_errors.TRANSCRIPTION_ENGINE_UNAVAILABLE")}</p>}
            </DialogHeader>
            <DialogFooter>
                <Button autoFocus onClick={cancel}>{t("transcription_consent.cancel")}</Button>
                <Button onClick={openSettings}>{t("transcription_consent.settings")}</Button>
                {request.mode === "choose" && <Button disabled={pending} onClick={() => choose("SpeechCpp")}>{t("transcription_consent.speechcpp")}</Button>}
            </DialogFooter>
        </Dialog>
    </div>;
};
