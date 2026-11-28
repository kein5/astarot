import { useI18n } from "@useI18n";
import { useConsentDialog } from "../../../../../logics/common/useConsentDialog";
import { Button, Dialog, DialogFooter, DialogHeader, DialogTitle } from "../../../../kit/index.ts";
import * as dialogStyles from "../../../config_page/setting_section/setting_box/_components/download_models/LegacyModelDownloadDialog.css.ts";

export interface BlockedSwitchDialogProps {
    // The switch's name, as the row shows it.
    name: string;
    // Why it cannot be turned on yet (main_page.switch_blocked.*), in words.
    reason: string;
    // The one step that provides what is missing, named as the switch's icon names it; none while
    // there is only to wait (a download on its way).
    fixLabel: string | null;
    onFix: () => void;
    onClose: () => void;
}

// A greyed switch that is pressed says why it cannot be turned on yet and offers the step that
// fixes it (#1314, M-1), as the speech recognition switches do (#1225): before, it did nothing and
// only its tooltip said why. Nothing here turns a switch on or downloads anything; the step opens
// the review or the settings the switch's icon opens.
export const BlockedSwitchDialog = ({ name, reason, fixLabel, onFix, onClose }: BlockedSwitchDialogProps) => {
    const { t } = useI18n();
    const { dialog, close } = useConsentDialog(true);
    const leave = () => { close(); onClose(); };
    // Named by its title, without a description, as the other dialogs of the kit (D-23, D-43).
    return <div className={dialogStyles.host}>
        <Dialog ref={dialog} open onOpenChange={leave} aria-describedby={undefined}>
            <DialogHeader>
                <DialogTitle>{t("main_page.switch_blocked_dialog.title", { name })}</DialogTitle>
                <p>{reason}</p>
            </DialogHeader>
            <DialogFooter>
                <Button autoFocus onClick={leave}>{t("main_page.switch_blocked_dialog.close")}</Button>
                {fixLabel && <Button tone="primary" onClick={() => { leave(); onFix(); }}>{fixLabel}</Button>}
            </DialogFooter>
        </Dialog>
    </div>;
};
