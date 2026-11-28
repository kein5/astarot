import { useEffect, useState } from "react";
import { atom, useAtom } from "jotai";
import { useI18n } from "@useI18n";
import { useOthers } from "@logics_configs";
import { useConsentDialog } from "../../../logics/common/useConsentDialog";
import { TelemetryContents } from "../config_page/setting_section/setting_box/_components/telemetry/TelemetryContents";
import * as styles from "../config_page/setting_section/setting_box/advanced_settings/VoiceSettings.css.ts";
import * as dialogStyles from "../config_page/setting_section/setting_box/_components/download_models/LegacyModelDownloadDialog.css.ts";
import * as noticeStyles from "./TelemetryNoticeController.css.ts";
import { Button, Dialog, DialogFooter, DialogHeader, DialogTitle } from "../../kit/index.ts";

// Usage events are sent unless the user turns them off, but never before the user has
// been told. This asks: why, what is sent, what is not, the event itself as this PC would
// send it (TelemetryContents), and the two answers. The backend sends nothing while the
// notice is pending.
//
// The user is not held here. "Decide later" (and Escape) puts the notice away for this
// run without an answer: nothing is sent, and the next start asks again. While a modal
// dialog is open the window's own buttons, drawn in this page, cannot be pressed, so
// without it the app could not even be closed from its title bar.
//
// Put away for this run, outside the component: changing the UI language draws the main page
// again (App.tsx), and a notice put away must not open again then (#563).
const laterAtom = atom(false);

export const TelemetryNoticeController = () => {
    const { t } = useI18n();
    const { currentTelemetryNotice, setTelemetryNotice, getTelemetry } = useOthers();
    const [later, setLater] = useAtom(laterAtom);
    const pending = !later && currentTelemetryNotice.state === "ok" && currentTelemetryNotice.data?.pending === true;
    const { dialog } = useConsentDialog(pending);
    const [answered, setAnswered] = useState(false);
    // A refused or lost answer leaves the notice pending: let the user answer again.
    useEffect(() => { if (currentTelemetryNotice.state !== "pending") setAnswered(false); },
        [currentTelemetryNotice.state, currentTelemetryNotice.data]);

    if (!pending) return null;
    const answer = async (send: boolean) => {
        if (answered) return;
        setAnswered(true);
        await setTelemetryNotice({ send });
        // The switch in the settings shows the same choice.
        getTelemetry();
    };
    // Not once an answer is on its way: that answer stands.
    const putAway = () => { if (!answered) setLater(true); };
    // Named by its title, without a description, as before the kit (D-23, D-43).
    return <div className={`${styles.container} ${dialogStyles.host}`}>
        <Dialog ref={dialog} open={pending} onOpenChange={putAway} aria-describedby={undefined}>
            {/* Why it is asked comes first; then what is sent, what is not, and how to change it. */}
            <DialogHeader className={noticeStyles.notice}>
                <DialogTitle>{t("telemetry_notice.title")}</DialogTitle>
                <p className={noticeStyles.purpose}>{t("telemetry_notice.purpose")}</p>
                <p>{t("telemetry_notice.what")}</p>
                <p>{t("telemetry_notice.not_sent")}</p>
                <p>{t("telemetry_notice.change")}</p>
            </DialogHeader>
            <TelemetryContents />
            <DialogFooter>
                {/* Neither answer takes the first focus: the dialog opens with it on "See what gets sent" above. */}
                <Button disabled={answered} onClick={() => answer(true)}>{t("telemetry_notice.send")}</Button>
                <Button disabled={answered} onClick={() => answer(false)}>{t("telemetry_notice.dont_send")}</Button>
            </DialogFooter>
            {/* The way out that is not an answer: the kit's quiet Button, on its own line under the
                answers (decided on 2026-11-25). */}
            <Button tone="quiet" className={dialogStyles.ownLine} disabled={answered} onClick={putAway}>{t("telemetry_notice.later")}</Button>
        </Dialog>
    </div>;
};
