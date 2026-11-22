// The models the first-run setup offers for each feature (#955): speech recognition, translation
// and text to speech. Each is chosen on its own, or not installed at all, so a user who wants only
// one feature prepares only that one. A step offers one file per model (the one speech.cpp fetches
// for its name, or the one with a recommendation), the recommended model first.
import { catalogFamilies, firstVariant } from "../voice/modelCatalog";
import type { SetupCatalog, SetupEntry } from "./firstRunSetup.ts";

// The choice that installs nothing for a feature.
export const SKIP = "skip";

export type SetupFeature = "recognition" | "translation" | "speech";

// The text-to-speech models the setup offers, by the speech server's profile they go to.
export const SPEECH_TARGETS = ["japanese", "multilingual"] as const;

// The UI language's primary subtag ("ja-JP" → "ja").
const primary = (language: unknown): string => typeof language === "string" ? language.split(/[-_]/)[0].toLowerCase() : "";

// One file per model of the targets, in catalog order, the recommended model first.
export const modelChoices = (catalog: SetupCatalog, targets: readonly string[], recommended: string | null | undefined): SetupEntry[] => {
    const rows = (catalog?.models ?? []).filter(entry => targets.includes(entry.target));
    const picks = catalogFamilies([...rows]).map(family => firstVariant(family.rows, recommended, () => false));
    return [...picks.filter(entry => entry.id === recommended), ...picks.filter(entry => entry.id !== recommended)];
};

// The text-to-speech model recommended for the UI language: the Japanese one for Japanese, the
// other languages' one otherwise, each the file its catalog row recommends for that language.
export const recommendedSpeech = (catalog: SetupCatalog, language: unknown): SetupEntry | null => {
    const code = primary(language);
    const target = code === "ja" ? "japanese" : "multilingual";
    const rows = (catalog?.models ?? []).filter(entry => entry.target === target);
    return rows.find(entry => entry.profile?.recommended_for?.includes(code))
        ?? rows.find(entry => (entry.profile?.recommended_for?.length ?? 0) > 0)
        ?? rows[0] ?? null;
};

// The model a choice names, or null for "do not install" and for a choice the list no longer has.
export const chosenEntry = (choices: readonly SetupEntry[], choice: string | null | undefined): SetupEntry | null =>
    choice === SKIP ? null : choices.find(entry => entry.id === choice) ?? null;

// Whether a feature is settled for the setup's end: ready (prepared before, or by this setup, or
// set up another way), or not to be installed now; and nothing of it under way.
export interface FeatureView {
    ready: boolean;
    skipped: boolean;
    running: boolean;
}
export const settled = ({ ready, skipped, running }: FeatureView): boolean => !running && (ready || skipped);

// What the setup's end says about a feature: it can be used once its switch on the main screen is
// turned on, or it is not used now and its switch can stay off. Nothing is turned on by the setup.
export type FeatureOutcome = "use" | "unused";
export const featureOutcome = ({ ready }: FeatureView): FeatureOutcome => ready ? "use" : "unused";
