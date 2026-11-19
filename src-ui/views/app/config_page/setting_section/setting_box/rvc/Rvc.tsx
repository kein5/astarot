import { useI18n } from "@useI18n";
import { useVoice } from "../../../../../../logics/voice/useVoice";
import { DirectVoiceSettings } from "../advanced_settings/DirectVoiceSettings";
import { AdvancedSection } from "../_components/advanced_section/AdvancedSection";
import { HintDescriptions } from "../_components/hint/Hint";

// The voice changer, then in 「詳細設定」 the forwarding of the input as it is: the same voice
// path without the conversion (#554, Q-07). Both are one feature's input, so the voice route,
// the input and Start live on one page. Reviewed against #614: the rows' descriptions are their
// labels' hints, and what each form is for is its heading's. What Start waits for, the states,
// the route in use and the setup's downloads stay in sight.
export const Rvc = () => {
    const { t } = useI18n();
    const { directState, directOwner } = useVoice();
    // The fold's line says whether the input is being forwarded now (useVoice's owner "passthrough").
    const forwarding = !!directState.active && directOwner === "passthrough";
    return <HintDescriptions>
        <DirectVoiceSettings variant="rvc" />
        <AdvancedSection status={t(forwarding ? "voice.input_active" : "voice.input_stopped")}>
            <DirectVoiceSettings variant="legacy" subheading />
        </AdvancedSection>
    </HintDescriptions>;
};
