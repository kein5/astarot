import { useState } from "react";
import { useI18n } from "@useI18n";
import { useConsentDialog } from "../../../../../../logics/common/useConsentDialog";
import { useTalkAiSession } from "../../../../../../logics/talk_ai/useTalkAiSession.ts";
import { seconds } from "../../../../../../logics/talk_ai/talkAi.ts";
import type { AnswerOutput, ScreenSource, TalkProvider } from "../../../../../../logics/talk_ai/talkAi.ts";
import * as dialogStyles from "../_components/download_models/LegacyModelDownloadDialog.css.ts";
import * as voiceStyles from "../advanced_settings/VoiceSettings.css.ts";
import { Button, Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../../../../kit/index.ts";
import * as styles from "./TalkAi.css.ts";

// The consents of Talk AI (ADR-018, 2.4). Each is asked anew: at every start for the voice, and
// at every share for the screen. They say where it goes, what goes, and how to stop it, before
// anything leaves the PC; Cancel is where the focus starts. Agreeing is the only way on.

type ConsentProps = {
    provider: TalkProvider;
    output: AnswerOutput;
    // The virtual microphone the answer goes to, when the user chose it and one is set up.
    device: string | null;
    onClose: () => void;
};

export const TalkAiConsentDialog = ({ provider, output, device, onClose }: ConsentProps) => {
    const { t } = useI18n();
    const { start } = useTalkAiSession();
    const { dialog, close } = useConsentDialog(true);
    // Sending the answer into the virtual microphone lets the others hear it: a consent of its own.
    const share = output === "virtual_mic" && device !== null;
    const [shareAgreed, setShareAgreed] = useState(false);
    const cancel = () => { close(); onClose(); };
    const agree = () => {
        close();
        onClose();
        void start(provider, { device: share ? device : null, share });
    };
    return <div className={`${voiceStyles.container} ${dialogStyles.host}`}>
        <Dialog ref={dialog} open onOpenChange={cancel}>
            <DialogHeader>
                <DialogTitle>{t("talk_ai.consent.title")}</DialogTitle>
                <DialogDescription>{t("talk_ai.consent.what", { name: provider.name })}</DialogDescription>
            </DialogHeader>
            <dl className={dialogStyles.facts}>
                <div className={dialogStyles.fact}><dt>{t("talk_ai.consent.destination")}</dt>
                    <dd><code className={dialogStyles.path}>{provider.destination}</code></dd></div>
                <div className={dialogStyles.fact}><dt>{t("talk_ai.consent.sent")}</dt><dd>{t("talk_ai.consent.sent_voice")}</dd></div>
                <div className={dialogStyles.fact}><dt>{t("talk_ai.consent.answer")}</dt>
                    <dd>{t(share ? "talk_ai.consent.answer_virtual_mic" : "talk_ai.consent.answer_headphones")}</dd></div>
                <div className={dialogStyles.fact}><dt>{t("talk_ai.consent.stop")}</dt><dd>{t("talk_ai.consent.stop_value")}</dd></div>
            </dl>
            <p>{t("talk_ai.consent.transcription")}</p>
            {provider.cloud && <p>{t("talk_ai.consent.cloud")}</p>}
            {share && <label className={styles.check}>
                <input type="checkbox" checked={shareAgreed} onChange={event => setShareAgreed(event.target.checked)} />
                <span>{t("talk_ai.consent.share_check")}</span>
            </label>}
            <DialogFooter>
                <Button autoFocus onClick={cancel}>{t("talk_ai.consent.cancel")}</Button>
                <Button tone="primary" disabled={share && !shareAgreed} onClick={agree}>{t("talk_ai.consent.agree")}</Button>
            </DialogFooter>
        </Dialog>
    </div>;
};

type ScreenProps = {
    provider: TalkProvider;
    source: ScreenSource;
    interval: number;
    edge: number;
    onClose: () => void;
};

export const TalkAiScreenDialog = ({ provider, source, interval, edge, onClose }: ScreenProps) => {
    const { t } = useI18n();
    const { share } = useTalkAiSession();
    const { dialog, close } = useConsentDialog(true);
    const cancel = () => { close(); onClose(); };
    const agree = () => {
        close();
        onClose();
        share(source, provider.destination);
    };
    return <div className={`${voiceStyles.container} ${dialogStyles.host}`}>
        <Dialog ref={dialog} open onOpenChange={cancel}>
            <DialogHeader>
                <DialogTitle>{t("talk_ai.screen_consent.title")}</DialogTitle>
                <DialogDescription>{t("talk_ai.screen_consent.what", { name: provider.name })}</DialogDescription>
            </DialogHeader>
            <dl className={dialogStyles.facts}>
                <div className={dialogStyles.fact}><dt>{t("talk_ai.consent.destination")}</dt>
                    <dd><code className={dialogStyles.path}>{provider.destination}</code></dd></div>
                <div className={dialogStyles.fact}><dt>{t("talk_ai.screen_consent.source")}</dt><dd>{t(`talk_ai.screen.source.${source}`)}</dd></div>
                <div className={dialogStyles.fact}><dt>{t("talk_ai.screen_consent.sent")}</dt>
                    <dd>{t("talk_ai.screen_consent.sent_value", { seconds: seconds(interval), px: edge })}</dd></div>
                <div className={dialogStyles.fact}><dt>{t("talk_ai.consent.stop")}</dt><dd>{t("talk_ai.screen_consent.stop_value")}</dd></div>
            </dl>
            {source === "monitor" && <p>{t("talk_ai.screen_consent.monitor")}</p>}
            <DialogFooter>
                <Button autoFocus onClick={cancel}>{t("talk_ai.consent.cancel")}</Button>
                <Button tone="primary" onClick={agree}>{t("talk_ai.screen_consent.agree")}</Button>
            </DialogFooter>
        </Dialog>
    </div>;
};
