import { atom } from "jotai";
import { isUsersWeight } from "./translationCatalog.ts";
import type { TranslationCatalog } from "./translationCatalog.ts";

// The translation catalog (#413) as the backend sends it, null until the first answer.
export const catalogAtom = atom<TranslationCatalog | null>(null);

// Only the fields the VR settings display are mirrored through the panel channel.
export const vrCustomTranslationModelNamesAtom = atom(get => {
    const data: Partial<Record<string, string>> = {};
    for (const { origin, weight, name } of get(catalogAtom)?.engine ?? []) {
        if (origin === "user" && isUsersWeight(weight)) data[weight] = name;
    }
    return { state: "ok", data } as const;
});
