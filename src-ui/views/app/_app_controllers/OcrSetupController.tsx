import { useCallback, useEffect, useRef } from "react";
import { useI18n } from "@useI18n";
import { useNotificationStatus } from "@logics_common";
import { useOcr } from "@logics_configs";
import { useMainFunction } from "@logics_main";
import { useOcrSetup, OCR_MODELS_SETTING_ID } from "../../../logics/ocr/useOcrSetup";
import { useModelDownloads } from "../../../logics/voice/useModelDownloads";
import { useOpenSettings } from "../../../logics/common/useOpenSettings";
import { useConsentDialog } from "../../../logics/common/useConsentDialog";
import { OcrModels } from "../config_page/setting_section/setting_box/ocr/OcrModels";
import * as styles from "../config_page/setting_section/setting_box/advanced_settings/VoiceSettings.css.ts";
import * as dialogStyles from "../config_page/setting_section/setting_box/_components/download_models/LegacyModelDownloadDialog.css.ts";
import { Button, Dialog, DialogFooter, DialogHeader, DialogTitle } from "../../kit/index.ts";

// What the models' readiness says (/get/data/ocr_model_readiness): the models the reading language
// needs, and those of them not on the PC.
type ModelReadiness = { required_models?: readonly string[] | null; missing_models?: readonly string[] | null } | null | undefined;

// The phases of a download that is under way (useModelDownloads).
const ACTIVE: readonly unknown[] = ["queued", "downloading", "verifying"];

// Turning chat reading on without its models is refused (#1225). This dialog says so where the user
// is and offers the missing models in it, as the speech recognition fix does (#1241): each model's
// review shows its provider, license and size, and it downloads only after consent. Once every
// model started here is on the PC, chat reading is turned on, as the user asked for it. Nothing
// needs applying: chat reading finds the verified files by their id. "Open the chat reading
// settings" leads to the models section of the settings instead.
export const OcrSetupController = () => {
    const { t } = useI18n();
    const { open, setOpen, waiting, setWaiting } = useOcrSetup();
    const { currentOcrModelReadiness, getOcrModelReadiness } = useOcr();
    const { state: downloads } = useModelDownloads();
    const { setOcrCapture } = useMainFunction();
    const { showNotification_Success } = useNotificationStatus();
    // The settings: their window in the app (#1236), the page in a browser.
    const openSettingsAt = useOpenSettings();
    const { dialog, close } = useConsentDialog(open);
    // The hooks hand out new functions on every render: the effects read the latest.
    const latest = useRef({ getOcrModelReadiness, setOcrCapture, showNotification_Success, t, close, setOpen, setWaiting });
    latest.current = { getOcrModelReadiness, setOcrCapture, showNotification_Success, t, close, setOpen, setWaiting };
    // The same function on every render: the models' part asks again with it whenever a model of
    // the list is ready, and a new one each render would ask on every render.
    const refresh = useCallback(() => latest.current.getOcrModelReadiness(), []);
    // The first focus is the safe action. The kit's Dialog opens in its own effect, before this
    // component's run; a focus asked for before it is open is lost, and the browser then gives the
    // focus to the first part that takes it, the models' section.
    const closeButton = useRef<HTMLButtonElement>(null);
    useEffect(() => { if (open) closeButton.current?.focus(); }, [open]);

    const readiness: ModelReadiness = currentOcrModelReadiness.data;
    const required = readiness?.required_models ?? [];
    const missing = readiness?.missing_models ?? [];
    const phase = (id: string) => downloads.jobs[id]?.phase;
    const here = (id: string) => phase(id) === "ready" || !missing.includes(id);

    useEffect(() => () => setOpen(false), [setOpen]);
    // Which models are missing now: asked as the dialog opens.
    useEffect(() => { if (open) refresh(); }, [open, refresh]);

    // Every model started here is on the PC: chat reading is turned on, and the dialog, done, closes.
    // A download that failed or was cancelled ends the wait; its card says why.
    const arrived = !!waiting && waiting.every(here);
    const abandoned = !!waiting && waiting.some(id => ["failed", "cancelled"].includes(String(phase(id))));
    useEffect(() => {
        const { setWaiting, close, setOpen, setOcrCapture, showNotification_Success, t } = latest.current;
        if (arrived) {
            setWaiting(null);
            close();
            setOpen(false);
            showNotification_Success(t("ocr_setup.models_ready"), { category_id: "ocr_setup_ready" });
            setOcrCapture(true);
        } else if (abandoned) {
            setWaiting(null);
        }
    }, [arrived, abandoned]);

    if (!open) return null;
    // Closing keeps the wait only while every missing model is on its way: chat reading is not turned
    // on later by a download started elsewhere.
    const cancel = () => {
        close();
        setOpen(false);
        if (waiting && !missing.every(id => here(id) || ACTIVE.includes(phase(id)))) setWaiting(null);
    };
    const openSettings = () => {
        cancel();
        openSettingsAt({ page: "ocr", target: OCR_MODELS_SETTING_ID });
    };
    // The models the language needs, all missing ones in the wait as soon as one is started.
    const started = () => setWaiting(missing.length > 0 ? [...missing] : null);
    // Named by its title, without a description, as before the kit (D-23, D-43).
    return <div className={`${styles.container} ${dialogStyles.host}`}>
        <Dialog ref={dialog} open={open} onOpenChange={cancel} aria-describedby={undefined}>
            <DialogHeader>
                <DialogTitle>{t("ocr_setup.title")}</DialogTitle>
                <p>{t("ocr_setup.body")}</p>
                <p>{t("ocr_setup.next")}</p>
            </DialogHeader>
            {/* The models the language needs: those on the PC say so, a missing one has its review,
                and nothing downloads before its consent. */}
            {required.length > 0 && <div data-ocr-setup-models>
                <OcrModels inFix ids={required} missing={missing}
                    onChanged={refresh} onStart={started}
                    title={t("config_page.ocr.models.title")} note={t("config_page.ocr.models.required")} />
            </div>}
            <DialogFooter>
                <Button ref={closeButton} autoFocus onClick={cancel}>{t("ocr_setup.close")}</Button>
                <Button onClick={openSettings}>{t("ocr_setup.review")}</Button>
            </DialogFooter>
        </Dialog>
    </div>;
};
