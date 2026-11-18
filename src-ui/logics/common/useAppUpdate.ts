import { invoke, Channel } from "@tauri-apps/api/core";
import { atom, getDefaultStore, useAtomValue } from "jotai";
import { createAppUpdate, INITIAL_APP_UPDATE } from "./appUpdate.ts";
import type { AppUpdateInstallProgress, AppUpdateState } from "./appUpdate.ts";

// One state for the whole window: the top bar and the update page show the same check.
export const Atom_AppUpdate = atom<Readonly<AppUpdateState>>(INITIAL_APP_UPDATE);

const atoms = getDefaultStore();
const appUpdate = createAppUpdate({
    invoke,
    // The installer's progress, as src-tauri/src/app_update.rs sends it.
    createChannel: onmessage => {
        const channel = new Channel<AppUpdateInstallProgress>();
        channel.onmessage = onmessage;
        return channel;
    },
    get: () => atoms.get(Atom_AppUpdate),
    set: value => atoms.set(Atom_AppUpdate, value),
    log: (what, detail) => console.warn(what, detail),
});

export const useAppUpdate = () => {
    const state = useAtomValue(Atom_AppUpdate);
    return {
        appUpdate: state,
        loadAppUpdateInfo: appUpdate.loadInfo,
        checkAppUpdate: appUpdate.check,
        installAppUpdate: appUpdate.install,
    };
};
