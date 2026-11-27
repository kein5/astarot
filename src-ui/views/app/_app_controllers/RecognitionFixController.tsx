import { useEffect, useRef, useState } from "react";
import { useI18n } from "@useI18n";
import { useMainFunction } from "@logics_main";
import { useNotificationStatus } from "@logics_common";
import { useRecognitionFix } from "../../../logics/transcription/useRecognitionFix";
import { detectingAsr, firstLanguage, languageSettingId, withLanguage } from "../../../logics/transcription/recognitionFix";
import type { RecognitionFix } from "../../../logics/transcription/recognitionFix";
import { useRealtimeASR } from "../../../logics/transcription/useRealtimeASR";
import { useSpeechServers } from "../../../logics/voice/useSpeechServers";
import { useModelDownloads } from "../../../logics/voice/useModelDownloads";
import { familyLabel } from "../../../logics/voice/modelCatalog";
import { useFirstRunSetup } from "../../../logics/setup/useFirstRunSetup";
import { useConsentDialog } from "../../../logics/common/useConsentDialog";
import { createLanguageNames } from "../../../logics/common/languageNames.ts";
import { useOpenSettings } from "../../../logics/common/useOpenSettings";
import { ModelDownloads } from "../config_page/setting_section/setting_box/advanced_settings/ModelDownloads";
import * as styles from "../config_page/setting_section/setting_box/advanced_settings/VoiceSettings.css.ts";
import * as dialogStyles from "../config_page/setting_section/setting_box/_components/download_models/LegacyModelDownloadDialog.css.ts";
import * as fixStyles from "./RecognitionFixController.css.ts";
import { Button, Dialog, DialogFooter, DialogHeader, DialogTitle } from "../../kit/index.ts";

// Where Settings shows the speech.cpp models and servers (Transcription.tsx).
const MODELS_SETTING_ID = "speechcpp_section";

// Turning Mic transcription or Listening on without what speech recognition needs used to end in a
// notice that named a settings page (#1225). This says what is missing where the user is and
// carries the actions that fix it (decided A on 2026-11-26):
// - the models: the first-run setup, which shows what it downloads and how large it is, and
//   downloads only after consent;
// - the language: one of the languages the model takes, chosen here, after which the switch is
//   turned on again; or, on the bundled server, a model that tells the language by itself, through
//   the catalog's own review (size, license, consent). Once it is downloaded it is applied as the
//   recognition model, which the bundled server gives the switches, and the switch is turned on.
// Either way, "Open the setting" leads to the exact setting instead.
export const RecognitionFixController = () => {
    const { t, i18n } = useI18n();
    const { request, setRequest, waiting, setWaiting } = useRecognitionFix();
    const { settings: realtime, send: sendRealtime } = useRealtimeASR();
    const { settings: speech, send: sendSpeech } = useSpeechServers();
    const { catalog, state: downloads, error: downloadError, send: sendDownload } = useModelDownloads();
    const { setTranscriptionSend, setTranscriptionReceive } = useMainFunction();
    const { showNotification_Success, showNotification_Error } = useNotificationStatus();
    const { openSetup } = useFirstRunSetup();
    const openSettings = useOpenSettings();
    const { dialog, close } = useConsentDialog(!!request);
    const [language, setLanguage] = useState("");
    // The language chosen here, until the saved settings come back with it.
    const chosen = useRef<{ fix: RecognitionFix; language: string } | null>(null);
    const turnOn = (fix: RecognitionFix) => (fix.source === "mic" ? setTranscriptionSend : setTranscriptionReceive)(true);

    useEffect(() => () => { setRequest(null); }, [setRequest]);
    // A new refusal offers its own first language.
    useEffect(() => { if (request) setLanguage(firstLanguage(request.languages, i18n.language)); }, [request]);
    const offersModel = !!request && request.auto && realtime?.server === "bundled";
    useEffect(() => { if (offersModel && !catalog) sendDownload("/get/data/model_download_catalog"); }, [offersModel, !!catalog]);

    // The language is saved: the switch is turned on again, as the user asked for it.
    useEffect(() => {
        const asked = chosen.current;
        if (!asked || realtime?.[asked.fix.source]?.language !== asked.language) return;
        chosen.current = null;
        turnOn(asked.fix);
    }, [realtime]);

    // The download of a model that tells the language: applied once it is verified, as the
    // first-run setup applies its downloads; the switch is turned on once its path is saved. For
    // Listening it is Listening's own model (#1242): Mic input keeps its model.
    const asr = speech?.profiles?.asr;
    const savedFor = (source: RecognitionFix["source"] | undefined) => (source === "speaker" ? asr?.listening_model : asr?.model) ?? "";
    const saved = savedFor(waiting?.fix.source ?? request?.source);
    const job = waiting ? downloads.jobs[waiting.model] : undefined;
    const ours = job?.job_id && job.job_id !== waiting?.before ? job : undefined;
    const ready = ours?.phase === "ready" ? ours.job_id ?? null : null;
    const applied = useRef<string | null>(null);
    useEffect(() => {
        if (!ready || !waiting || applied.current === ready) return;
        applied.current = ready;
        sendDownload("/run/apply_model_download", { id: waiting.model, job_id: ready, expected: { model: waiting.expected },
            ...(waiting.fix.source === "speaker" && { source: "speaker" }) });
    }, [ready]);
    const arrived = !!waiting && saved !== "" && saved !== waiting.expected;
    const abandoned = ours?.phase === "failed" || ours?.phase === "cancelled";
    // The apply was refused: most often the ASR server runs, started from Settings, and keeps the
    // model it loaded until it is stopped (#1149 links the server to the switches).
    const refused = !!waiting && !!ready && applied.current === ready && !arrived && downloadError ? downloadError : null;
    useEffect(() => {
        if (!waiting) return;
        if (arrived) {
            const fix = waiting.fix;
            setWaiting(null);
            showNotification_Success(t("recognition_fix.model_ready"), { category_id: "recognition_fix_ready" });
            turnOn(fix);
        } else if (abandoned) {
            setWaiting(null);  // cancelled or failed; its own card says why
        } else if (refused) {
            setWaiting(null);
            showNotification_Error(refused === "model_target_busy" ? t("recognition_fix.server_running")
                : t(`model_downloads.errors.${refused}`, { defaultValue: t("model_downloads.errors.download_failed") }), { category_id: "recognition_fix_apply" });
        }
    }, [arrived, abandoned, refused]);

    // One model for both (#1242): Listening's own model is taken away, and the switch is turned on
    // again once the saved settings come back without it.
    const sharing = useRef<RecognitionFix | null>(null);
    useEffect(() => {
        const fix = sharing.current;
        if (!fix || (asr?.listening_model ?? "") !== "") return;
        sharing.current = null;
        turnOn(fix);
    }, [asr?.listening_model]);

    if (!request) return null;
    const fix = request;
    const cancel = () => { chosen.current = null; close(); setRequest(null); };
    const openSetting = (settingId: string) => {
        cancel();
        openSettings({ page: "transcription", target: settingId });
    };
    const name = t(fix.source === "mic" ? "main_page.transcription_send" : "main_page.transcription_receive");
    const names = createLanguageNames(i18n.language);
    const chooseLanguage = () => {
        if (!realtime || !language) return;
        chosen.current = { fix, language };
        close();
        setRequest(null);
        sendRealtime("/set/data/realtime_asr_settings", withLanguage(realtime, fix.source, language));
    };
    const detecting = offersModel ? detectingAsr(catalog) : null;
    // The name of Mic input's model, for the offer to share it: its catalog entry's, if it is one.
    const micName = (() => {
        const id = Object.entries(downloads.downloaded ?? {}).find(([, paths]) => !!asr?.model && paths?.model === asr.model)?.[0];
        const entry = id ? catalog?.models.find(model => model.id === id) : undefined;
        return entry ? familyLabel(entry) : t("recognition_fix.mic_model");
    })();
    const share = () => {
        if (!speech || !asr) return;
        sharing.current = fix;
        close();
        setRequest(null);
        sendSpeech("/set/data/speech_server_settings", { ...speech, profiles: { ...speech.profiles, asr: { ...asr, listening_model: "" } } });
    };
    const detectBody = fix.source === "speaker" ? "recognition_fix.detect_body_listening" : "recognition_fix.detect_body";
    // Named by its title, without a description, as the other dialogs of the kit (D-23, D-43).
    return <div className={`${styles.container} ${dialogStyles.host}`}>
        <Dialog ref={dialog} open onOpenChange={cancel} aria-describedby={undefined}>
            <DialogHeader>
                <DialogTitle>{t("recognition_fix.title", { name })}</DialogTitle>
                {fix.kind === "models" ? <p>{t("recognition_fix.models_body")}</p>
                    : fix.kind === "share" ? <p>{t("recognition_fix.share_body")}</p>
                    : <p>{t(fix.auto ? "recognition_fix.language_auto_body" : "recognition_fix.language_body")}</p>}
            </DialogHeader>
            {fix.kind === "language" && fix.languages.length > 0 && <div data-recognition-fix-language>
                <label>
                    {t("recognition_fix.language_label")}
                    <select aria-label={t("recognition_fix.language_label")} value={language} onChange={event => setLanguage(event.target.value)}>
                        {fix.languages.map(code => <option key={code} value={code}>{names.fromCode(code)}</option>)}
                    </select>
                </label>
                <div className={fixStyles.languageAction}>
                    <Button tone="primary" disabled={!realtime || !language} onClick={chooseLanguage}>{t("recognition_fix.use_language")}</Button>
                </div>
            </div>}
            {/* A model that tells the language, through the catalog's review: its size and license
                are shown and agreed to before anything is downloaded. */}
            {detecting && <section data-recognition-fix-model aria-label={t("recognition_fix.detect_heading")}>
                <h3>{t("recognition_fix.detect_heading")}</h3>
                <p>{t(detectBody, { model: familyLabel(detecting), name, count: detecting.speech?.languages?.length ?? 0 })}</p>
                <ModelDownloads targets={["asr"]} only={[detecting.id]} expected={{ asr: { model: saved } }}
                    onStart={id => setWaiting({ fix, model: id, before: downloads.jobs[id]?.job_id ?? null, expected: saved })} />
            </section>}
            <DialogFooter>
                <Button autoFocus onClick={cancel}>{t("recognition_fix.close")}</Button>
                <Button onClick={() => openSetting(fix.kind === "language" ? languageSettingId(fix.source) : MODELS_SETTING_ID)}>
                    {t("recognition_fix.open_setting")}</Button>
                {fix.kind === "models" && <Button tone="primary" onClick={() => { cancel(); openSetup(); }}>{t("recognition_fix.get_models")}</Button>}
                {fix.kind === "share" && <Button tone="primary" disabled={!speech || !asr} onClick={share}>{t("recognition_fix.use_shared", { model: micName })}</Button>}
            </DialogFooter>
        </Dialog>
    </div>;
};
