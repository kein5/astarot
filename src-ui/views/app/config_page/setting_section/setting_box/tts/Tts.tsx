import { VoiceSettings } from "../advanced_settings/VoiceSettings";
import { SpeechServers } from "../advanced_settings/SpeechServers";
import { HintDescriptions } from "../_components/hint/Hint";
import { useVoice } from "../../../../../../logics/voice/useVoice";
import { useSpeechServers } from "../../../../../../logics/voice/useSpeechServers";
import { ttsModelsNeeded } from "../../../../../../logics/voice/ttsSetupNeeds";

// Reviewed against #614: the rows' descriptions are their labels' hints, and what the page and its
// folds are for are its heading's and the folds' titles'. The states, the warnings, the voices'
// credit terms and the model downloads stay in sight.
// 「モデルとサーバー」 comes after the voices it serves and before 「詳細設定」, and starts open while
// a voice the bundled server makes has no model (#1230).
export const Tts = () => {
    const { settings: voice } = useVoice();
    const { settings: speech } = useSpeechServers();
    const needed = ttsModelsNeeded(voice, speech?.profiles);
    return <HintDescriptions>
        <VoiceSettings setup={<SpeechServers profiles={["japanese", "multilingual"]} needed={needed} embedded />} />
    </HintDescriptions>;
};
