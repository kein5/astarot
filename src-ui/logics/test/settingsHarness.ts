// The settings list (ui_config_setter.ts) as it runs: the real store, the real settings logic
// (useSettingsLogics.ts) and the real list, loaded through the harness so their mutants run. The
// backend is a recorder: every request a setting sends is kept, and each send answers true. The
// request recovery (pendingRequestRecovery.ts) is a fresh one per load, so a test can fail a
// request and see which setting it releases.
//
// It also reads the two references the list is checked against: the core's own catalog
// (tools/spec_core_catalog.json, which the core's tests write) and the IPC reference
// (docs/spec/reference/ipc-endpoints.md, which tools/spec_catalog.py writes from that catalog and
// from the UI's route table and settings).
import { readFileSync } from "node:fs";
import { atom } from "jotai/vanilla";
import type { Atom, WritableAtom } from "jotai/vanilla";
import { hooks, loadModule } from "./hookHarness.ts";
import * as recoveryModule from "../common/pendingRequestRecovery.ts";
import * as initialization from "../common/initializationFields.ts";
import * as meterValue from "../common/meterValue.ts";
import * as utils from "../utils.ts";
import * as uiConfigs from "../ui_configs.ts";
import type { SettingCategory } from "../configs/config_page_setter/settingTypes.ts";
import * as fieldErrors from "../configs/fieldErrors.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

// --- The references --------------------------------------------------------------------------

interface CoreCatalog {
    endpoints: { endpoint: string }[];
    notifications: { name: string; endpoint: string }[];
    config: { key: string; kind: string; default: unknown }[];
}
const isCoreCatalog = (value: unknown): value is CoreCatalog => typeof value === "object" && value !== null
    && ["endpoints", "notifications", "config"].every(key => Array.isArray(Reflect.get(value, key)));
const catalog: unknown = JSON.parse(read("../../../tools/spec_core_catalog.json"));
if (!isCoreCatalog(catalog)) throw new TypeError("tools/spec_core_catalog.json has no endpoints, notifications and config");

// The requests the core answers, and the notices it sends on its own.
export const coreRequests: ReadonlySet<string> = new Set(catalog.endpoints.map(({ endpoint }) => endpoint));
export const coreNotices: ReadonlySet<string> = new Set(catalog.notifications.map(({ endpoint }) => endpoint));
// The config keys the core keeps, with the value a new install starts with.
export const coreDefaults: ReadonlyMap<string, unknown> = new Map(catalog.config.map(({ key, default: value }) => [key, value]));

// The UI's receiver of each request and notice as the IPC reference names it ("useDevice.setSuccessMicThreshold"),
// and the routes only the UI defines, read by the shared reader of the reference (ipcReference.ts).
export { receivers as referenceReceivers, uiOnly as referenceUiOnly } from "./ipcReference.ts";

// The routes useReceiveRoutes.ts writes by hand, which come before the ones the settings make:
// where both name an endpoint, the reference names the hand-written receiver.
export const staticRouteEndpoints: ReadonlySet<string> = new Set([...read("../useReceiveRoutes.ts")
    .matchAll(/\{\s*endpoint:\s*"([^"]+)",\s*ns:/g)].map(([, endpoint]) => endpoint));

// --- The list, loaded ------------------------------------------------------------------------

// A request a setting sent: the endpoint, and the value when there was one.
export type SentRequest = [endpoint: string, data?: unknown];

export const loadSettingsList = async () => {
    const runtime = hooks();
    const recovery = recoveryModule.createPendingRequestRecovery();
    const jotai = { atom, getDefaultStore: () => runtime.store,
        useAtomValue: <T>(target: Atom<T>) => runtime.store.get(target),
        useSetAtom: <T>(target: WritableAtom<T, [T], void>) => (value: T) => runtime.store.set(target, value),
    };
    const stores = await loadModule<typeof import("../store.ts")>(new URL("../store.ts", import.meta.url), runtime, {
        jotai, "@ui_configs": uiConfigs,
        "./common/vrPanelTooltip": { keepNewestVrLayout: (_: unknown, next: unknown) => next },
        
        "./common/pendingRequestRecovery.ts": { ...recoveryModule, pendingRequestRecovery: recovery },
        "./common/meterValue.ts": meterValue,
        "./common/initializationFields.ts": initialization,
    });
    const sent: SentRequest[] = [];
    let saveNotices = 0;
    const logics = await loadModule<typeof import("../configs/config_page_setter/useSettingsLogics.ts")>(new URL("../configs/config_page_setter/useSettingsLogics.ts", import.meta.url), runtime, {
        "@store": stores, "@utils": utils,
        "@logics_common": { useNotificationStatus: () => ({ showNotification_SaveSuccess: () => { saveNotices++; } }) },
        "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython: async (...request: SentRequest) => { sent.push(request); return true; } }) },
        "../fieldErrors.ts": fieldErrors,
    });
    const vrLayout: unknown = JSON.parse(read("../../views/vr/vr_layout.json"));
    const list = await loadModule<typeof import("../configs/config_page_setter/ui_config_setter.ts")>(new URL("../configs/config_page_setter/ui_config_setter.ts", import.meta.url), runtime, {
        jotai, "@store": stores, "../../common/pendingRequestRecovery.ts": recoveryModule,
        "../../../views/vr/vr_layout.json": vrLayout, "@ui_configs": uiConfigs,
        "./useSettingsLogics": logics,
    });
    return { runtime, stores, recovery, sent, logics, list, vrLayout,
        get saveNotices() { return saveNotices; },
        // What a category's hook (useDevice, useTranslation, ...) gives, drawn once. Its fields are
        // named after the settings; a test reads them with fieldOf.
        category: (name: SettingCategory): object => runtime.render(list.createCategoryHook(name)),
    };
};
export type SettingsList = Awaited<ReturnType<typeof loadSettingsList>>;
