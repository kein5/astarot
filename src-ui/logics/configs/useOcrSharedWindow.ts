import { useMemo, useRef } from "react";
import { getDefaultStore } from "jotai";
import { invoke } from "@tauri-apps/api/core";
import { Atom_OcrSharedWindow, dynamicStoreRegistry, useStore_OcrSharedWindow } from "@store";
import { useStdoutToPython } from "@useStdoutToPython";
import { createSharedWindowActions, shouldRestoreSharing, startErrorKey } from "./ocrSharedWindow.ts";

const atoms = getDefaultStore();

// The saved restore token. Its atom is made at run time from the settings list
// (ui_config_setter.ts) and read here through the registry, which does not know its
// type; anything but text counts as none.
const savedRestoreToken = (): string => {
    const tokenAtom = dynamicStoreRegistry.Atom_OcrPortalRestoreToken;
    if (!tokenAtom || typeof tokenAtom === "function") return "";
    const state = atoms.get(tokenAtom);
    const token = typeof state === "object" && state !== null && "data" in state ? state.data : undefined;
    return typeof token === "string" ? token : "";
};

// The notice for a chat-reading start error, given what is known about this desktop when it arrives.
export const ocrStartErrorKey = (error_code: unknown) => startErrorKey(error_code, atoms.get(Atom_OcrSharedWindow).data);

// Chat reading could not start with `error_code`: is there a remembered window to share again first?
export const ocrShouldRestoreSharedWindow = (error_code: unknown) => shouldRestoreSharing(error_code,
    atoms.get(Atom_OcrSharedWindow).data, savedRestoreToken());

// Sharing a window with chat reading (Linux, Wayland). `share` is for the user's button
// only: it makes the desktop show its window dialog. `restore` is for the moment the user
// turns chat reading on and the VRChat window is not found by its name.
export const useOcrSharedWindow = () => {
    const { currentOcrSharedWindow } = useStore_OcrSharedWindow();
    const { asyncStdoutToPython } = useStdoutToPython();
    const send = useRef(asyncStdoutToPython);
    send.current = asyncStdoutToPython;
    const actions = useMemo(() => createSharedWindowActions({
        invoke,
        read: () => atoms.get(Atom_OcrSharedWindow).data,
        write: data => atoms.set(Atom_OcrSharedWindow, { state: "ok", data }),
        token: savedRestoreToken,
        saveToken: value => send.current("/set/data/ocr_portal_restore_token", value),
    }), []);
    return { currentOcrSharedWindow, ...actions };
};
