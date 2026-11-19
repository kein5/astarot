import { useI18n } from "@useI18n";
import { useVoice } from "../../../../../../logics/voice/useVoice";
import { DirectVoiceSettings } from "../advanced_settings/DirectVoiceSettings";
import { AdvancedSection } from "../_components/advanced_section/AdvancedSection";

// The voice changer, then in 「詳細設定」 the forwarding of the input as it is: the same voice
// path without the conversion (#554, Q-07). Both are one feature's input, so the voice route,
// the input and Start live on one page.
export const Rvc = () => {
    const { t } = useI18n();
    const { directState, directOwner } = useVoice();
    // The fold's line says whether the input is being forwarded now (useVoice's owner "passthrough").
    const forwarding = !!directState.active && directOwner === "passthrough";
    return <>
        <DirectVoiceSettings variant="rvc" />
        <AdvancedSection status={t(forwarding ? "voice.input_active" : "voice.input_stopped")}>
            <DirectVoiceSettings variant="legacy" subheading />
        </AdvancedSection>
    </>;
};
