// Who spoke in a caption of the game audio, as the server's diarization labels the voices
// ("A", "B", ...): at most four, in the order they speak. A label is a voice within one
// session, not a person, and the diarization can be wrong about it. Anything else is no speakers.
export const speakerLabels = (value: unknown): string[] => Array.isArray(value) && value.length <= 4 &&
    value.every((label: unknown): label is string => typeof label === "string" && /^[A-Z]{1,3}$/.test(label)) ? value : [];

// The colors a voice can take, in the desktop caption overlay and in the conversation log (#1036):
// purple, amber, green and rose, in the order the voices speak; the fifth voice starts over.
export const SPEAKER_COLORS = 4;
// "A" is 0, "B" is 1, ... "Z" is 25, "AA" is 26: the order the server first heard the voices in.
const speakerIndex = (label: string) => [...label].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
// The color of a voice: 0 for A (purple), 1 for B (amber), 2 for C (green), 3 for D (rose), 0 for E.
export const speakerColorIndex = (label: string): number => speakerIndex(label) % SPEAKER_COLORS;
