import { invoke, Channel } from "@tauri-apps/api/core";
import { atom, getDefaultStore, useAtomValue } from "jotai";
import { createAppUpdate, INITIAL_APP_UPDATE } from "./appUpdate.js";

// One state for the whole window: the top bar and the update page show the same check.
export const Atom_AppUpdate = atom(INITIAL_APP_UPDATE);

const atoms = getDefaultStore();
const appUpdate = createAppUpdate({
    invoke,
    createChannel: onmessage => {
        const channel = new Channel();
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
