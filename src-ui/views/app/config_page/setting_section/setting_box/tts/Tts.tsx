import { VoiceSettings } from "../advanced_settings/VoiceSettings";
import { SpeechServers } from "../advanced_settings/SpeechServers";
import { HintDescriptions } from "../_components/hint/Hint";

// Reviewed against #614: the rows' descriptions are their labels' hints, and what the page and its
// folds are for are its heading's and the folds' titles'. The states, the warnings, the voices'
// credit terms and the model downloads stay in sight.
export const Tts = () => <HintDescriptions><VoiceSettings /><SpeechServers profiles={["japanese", "multilingual"]} /></HintDescriptions>;
