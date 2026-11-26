import { useI18n } from "@useI18n";
import { useVoice } from "../../../../../../logics/voice/useVoice";
import { DirectVoiceSettings, VcMonitorRow } from "../advanced_settings/DirectVoiceSettings";
import * as styles from "../advanced_settings/VoiceSettings.css.ts";
import { AdvancedSection } from "../_components/advanced_section/AdvancedSection";
import { HintDescriptions } from "../_components/hint/Hint";

// The voice changer, then in 「詳細設定」 the forwarding of the input as it is: the same voice
// path without the conversion (#554, Q-07). Both are one feature's input, so the voice route,
// the input and Start live on one page. Reviewed against #614: the rows' descriptions are their
// labels' hints, and what each form is for is its heading's. What Start waits for, the states,
// the route in use and the setup's downloads stay in sight. The setup comes first and starts open
// while it is missing; the monitor, changed on the TTS page, is in 「詳細設定」 (#1230).
export const Rvc = () => {
    const { t } = useI18n();
    const { directState, directOwner } = useVoice();
    // The fold's line says whether the input is being forwarded now (useVoice's owner "passthrough").
    const forwarding = !!directState.active && directOwner === "passthrough";
    return <HintDescriptions>
        <DirectVoiceSettings variant="rvc" monitor={false} />
        {/* The monitor is changed on the TTS page: its row is here, not among the page's own controls (#1230). */}
        <AdvancedSection status={t(forwarding ? "voice.input_active" : "voice.input_stopped")}>
            <div className={styles.container}><VcMonitorRow converted /></div>
            <DirectVoiceSettings variant="legacy" subheading />
        </AdvancedSection>
    </HintDescriptions>;
};
