import { getDefaultStore } from "jotai";
import type { PrimitiveAtom } from "jotai";
import i18next from "i18next";
import { Atom_LanguageMutation, Atom_NotificationStatus, Atom_SelectedPresetTabNumber, Atom_SelectedYourLanguages,
    Atom_SelectedTargetLanguages, Atom_SelectedTranslationEngines, Atom_TranslationEngines } from "@store";
import type { AtomState, AtomStatus } from "@store";
import { createLanguageMutationCoordinator, isLanguageMutation } from "./languageMutationCoordinator";
import type { LanguageMutationRequest, LanguageMutationResponse, LanguageMutationState } from "./languageMutationCoordinator";
import type { LanguageSelections } from "../common/initializationFields.ts";

// The language settings a write expects to change: compared again when its answer comes.
export interface LanguageSnapshot {
    tab: string;
    your: LanguageSelections;
    target: LanguageSelections;
    selectedEngines: Record<string, string>;
}

// Sends a request to the backend; false when it could not be sent.
export type LanguageSend = (endpoint: string) => Promise<unknown>;

// One of the language atoms, as far as this adapter reads and marks it.
interface LanguageAtom {
    readonly status: () => AtomStatus;
    readonly mark: (state: AtomStatus) => void;
}

export { isLanguageMutation };
export const LANGUAGE_RESPONSE_WAIT_MS = 30000;
const jotai = getDefaultStore();
const languageAtom = <T>(target: PrimitiveAtom<AtomState<T>>): LanguageAtom => ({
    status: () => jotai.get(target).state,
    mark: state => jotai.set(target, old => ({ ...old, state })),
});
const tabAtom = languageAtom(Atom_SelectedPresetTabNumber), yourAtom = languageAtom(Atom_SelectedYourLanguages),
    targetAtom = languageAtom(Atom_SelectedTargetLanguages), selectedEnginesAtom = languageAtom(Atom_SelectedTranslationEngines);
const getAtoms: Readonly<Partial<Record<string, LanguageAtom>>> = { "/get/data/selected_tab_no": tabAtom,
    "/get/data/selected_your_languages": yourAtom,
    "/get/data/selected_target_languages": targetAtom,
    "/get/data/selected_translation_engines": selectedEnginesAtom,
    "/get/data/selectable_translation_engines": languageAtom(Atom_TranslationEngines) };
const allAtoms = (): LanguageAtom[] => Object.values(getAtoms).filter(atom => atom !== undefined);
const affectedAtoms = (endpoint: string) => endpoint.endsWith("selected_tab_no") ? [tabAtom]
    : endpoint.endsWith("selected_your_languages") ? [yourAtom]
        : endpoint.endsWith("selected_target_languages") ? [targetAtom]
            : endpoint.endsWith("selected_translation_engines") ? [selectedEnginesAtom]
                : [yourAtom, targetAtom];
const setState = (atoms: readonly LanguageAtom[], state: AtomStatus) => atoms.forEach(atom => { atom.mark(state); });
const resyncPending = new Set<string>();
const publish = (data: LanguageMutationState) => jotai.set(Atom_LanguageMutation, { state: "ok", data: { ...data, isResyncing: resyncPending.size > 0 } });
const coordinator = createLanguageMutationCoordinator(publish, request => {
    if (request.source !== "pc") return;
    jotai.set(Atom_NotificationStatus, { state: "ok", data: {
        status: "warning", is_open: true, category_id: null,
        message: i18next.t("vr_panel.language.pc_retry"), options: {},
    } });
});
let timer: ReturnType<typeof setTimeout> | undefined;
const clearTimer = () => { clearTimeout(timer); timer = undefined; };

export const createLanguageRequestId = () => crypto.randomUUID();
export const getLanguageSnapshot = (): LanguageSnapshot => ({
    tab: jotai.get(Atom_SelectedPresetTabNumber).data,
    your: jotai.get(Atom_SelectedYourLanguages).data,
    target: jotai.get(Atom_SelectedTargetLanguages).data,
    selectedEngines: jotai.get(Atom_SelectedTranslationEngines).data,
});
export const canChangeLanguageSettings = () => !jotai.get(Atom_LanguageMutation).data.inFlight
    && !jotai.get(Atom_LanguageMutation).data.isResyncing
    && allAtoms().every(atom => atom.status() === "ok");

export function resyncLanguageSettings(send: LanguageSend) {
    Object.keys(getAtoms).forEach(endpoint => { resyncPending.add(endpoint); });
    publish(coordinator.getState());
    setState(allAtoms(), "pending");
    for (const [endpoint, atom] of Object.entries(getAtoms)) {
        if (!atom) continue;
        const failed = () => { setState([atom], "error"); finishResync(endpoint); };
        send(endpoint).then(sent => { if (sent === false) failed(); }).catch(failed);
    }
}

function finishResync(endpoint: string) {
    if (!resyncPending.delete(endpoint)) return;
    if (resyncPending.size === 0) publish(coordinator.getState());
}

export function rejectLanguageMutation(request: LanguageMutationRequest | null | undefined, reason: string) {
    if (request && isLanguageMutation(request.endpoint)) coordinator.reject(request, reason);
}

export function failLanguageRead(endpoint: string) {
    const atom = getAtoms[endpoint];
    if (!atom) return;
    setState([atom], "error");
    finishResync(endpoint);
}

export function beginLanguageMutation(request: LanguageMutationRequest) {
    if (resyncPending.size > 0 || allAtoms().some(atom => atom.status() !== "ok")) {
        coordinator.reject(request, "syncing");
        return false;
    }
    if (!coordinator.begin(request, getLanguageSnapshot())) return false;
    setState(affectedAtoms(request.endpoint), "pending");
    clearTimer();
    timer = setTimeout(() => {
        coordinator.markUnconfirmed(request.requestId, "timeout");
    }, LANGUAGE_RESPONSE_WAIT_MS);
    return true;
}

export function failLanguageMutationBeforeSend(requestId: string) {
    const request = coordinator.failBeforeSend(requestId, "backend-unavailable");
    if (!request) return;
    clearTimer();
    setState(affectedAtoms(request.endpoint), "error");
}

export function languageMutationWriteUnconfirmed(requestId: string) {
    if (!coordinator.markUnconfirmed(requestId, "write-unconfirmed")) return;
    clearTimer();
    // A GET while the write is still running can return its previous value.
    // Keep ownership and wait for the final response before fetching state.
}

export function receiveLanguageMutation(response: LanguageMutationResponse, send: LanguageSend) {
    const active = coordinator.getState().inFlight;
    // Publish resynchronization before releasing ownership / publishing failure.
    // VR receives atom changes as separate events, so it must never see a gap
    // between failed completion and the subsequent GETs.
    if (active?.endpoint === response.endpoint && [400, 404, 423, 500].includes(response.status)) resyncLanguageSettings(send);
    const request = coordinator.complete(response);
    const read = getAtoms[response.endpoint];
    if (request) {
        clearTimer();
    } else if (response.status !== 200 && read) {
        setState([read], "error");
    }
    if (read) finishResync(response.endpoint);
}

export function resetLanguageMutations() { clearTimer(); resyncPending.clear(); coordinator.reset(); }
