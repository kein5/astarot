import assert from "node:assert/strict";
import { test } from "vitest";
import { fieldOf, unchecked } from "../../test/hookHarness.ts";
import { settingAtom } from "../../test/bridgeHarness.ts";
import { coreNotices, coreRequests, loadSettingsList, referenceReceivers, referenceUiOnly, staticRouteEndpoints } from "../../test/settingsHarness.ts";
import type { SettingsList } from "../../test/settingsHarness.ts";
import * as utils from "../../utils.ts";
import type { SettingName } from "./settingTypes.ts";

// The settings list (ui_config_setter.ts) and the functions the settings logic makes from it
// (useSettingsLogics.ts), checked setting by setting against what the core says: the requests it
// answers and the notices it sends (tools/spec_core_catalog.json, written by the core's tests), and
// where the IPC reference (docs/spec/reference/ipc-endpoints.md) hands each answer.

type Setting = SettingsList["list"]["SETTINGS_ARRAY"][number];

// The functions of a setting that send a request, and the values the test sends with them.
const REQUESTS: readonly [verb: string, value?: unknown][] = [["get"], ["set", "value"], ["delete"], ["toggle"], ["download", { weight_type: "w" }]];
// The functions the IPC reference names for a setting's answers, longest first so that no name is
// read as a shorter one.
const ANSWERS = ["updateDownloadProgress", "updateFromBackend", "updateDownloaded", "deleteSuccess", "setSuccess", "downloaded", "pending"];

const runFlag = (setting: Setting, direction: string) => {
    const runs = fieldOf(setting, "add_endpoint_run_array");
    return Array.isArray(runs) && runs.includes(direction);
};
const transformOf = (setting: Setting): unknown => fieldOf(setting, "response_transform");
const call = (api: object, name: string, ...args: unknown[]): unknown => {
    const fn = fieldOf(api, name);
    assert.equal(typeof fn, "function", `${name} is not a function`);
    return typeof fn === "function" ? fn(...args) : undefined;
};
const stateOf = (s: SettingsList, setting: Setting) => s.runtime.store.get(settingAtom(s.stores.dynamicStoreRegistry, `Atom_${setting.Base_Name}`));
// Every request a setting's functions send: each function once, and a switch both on and off.
const requestsOf = (s: SettingsList, setting: Setting): Set<string> => {
    s.sent.length = 0;
    const name = setting.Base_Name;
    for (const [verb, value] of REQUESTS) {
        const fn = fieldOf(s.category(setting.Category), `${verb}${name}`);
        if (typeof fn !== "function") continue;
        if (verb !== "toggle") { fn(value); continue; }
        for (const on of [true, false]) {
            call(s.category(setting.Category), `update${name}`, on);
            call(s.category(setting.Category), `toggle${name}`);
        }
    }
    return new Set(s.sent.map(([endpoint]) => endpoint));
};
// The reference's receiver of an endpoint, as the hook and the function: ["useDevice", "setSuccessMicThreshold"].
const receiverOf = (endpoint: string): [string, string] | null => {
    const receiver = referenceReceivers.get(endpoint);
    const match = receiver?.match(/^(use\w+)\.(\w+)$/);
    return match ? [match[1], match[2]] : null;
};

test("a setting listens for the core's notice of its value exactly when the core sends one", async () => {
    const { list } = await loadSettingsList();
    const listening = list.SETTINGS_ARRAY.filter(setting => runFlag(setting, "from_backend")).map(setting => setting.Base_Name);
    const noticed = list.SETTINGS_ARRAY.filter(setting => coreNotices.has(`/run/${setting.base_endpoint_name}`)).map(setting => setting.Base_Name);
    assert.ok(listening.length > 30, String(listening.length));
    assert.deepEqual(listening, noticed);
    // No setting sends its value to the core as a /run/ request of its own.
    assert.deepEqual(list.SETTINGS_ARRAY.filter(setting => runFlag(setting, "to_backend")).map(setting => setting.Base_Name), []);
});

test("every request a setting sends is one the core answers, and its answer goes back to the same setting", async () => {
    const s = await loadSettingsList();
    let checked = 0;
    for (const setting of s.list.SETTINGS_ARRAY) {
        const api = s.category(setting.Category), sent = requestsOf(s, setting);
        const name = setting.Base_Name;
        assert.ok(sent.size > 0, `${name} sends nothing`);
        for (const endpoint of sent) {
            // The weights' download is the one request the core no longer has: the reference lists
            // it as a route only the UI defines (docs/spec/data-and-persistence.md, CTranslate2).
            assert.ok(coreRequests.has(endpoint) || referenceUiOnly.has(endpoint), `${name}: the core does not answer ${endpoint}`);
            assert.ok(endpoint.endsWith(`/${setting.base_endpoint_name}`) || endpoint === `/run/download_${setting.base_endpoint_name}`, `${name}: ${endpoint}`);
            if (staticRouteEndpoints.has(endpoint) || !referenceReceivers.has(endpoint)) continue;
            const receiver = receiverOf(endpoint);
            assert.ok(receiver, `${name}: the reference names no receiver of ${endpoint}`);
            assert.equal(receiver[0], `use${setting.Category}`, endpoint);
            assert.ok(ANSWERS.some(prefix => receiver[1] === `${prefix}${name}`), `${endpoint} -> ${receiver.join(".")}`);
            assert.equal(typeof fieldOf(api, receiver[1]), "function", `${endpoint} -> ${receiver.join(".")}`);
            checked++;
        }
    }
    assert.ok(checked > 250, String(checked));
});

test("each request the reference routes to a setting is one that setting sends, and its receiver is in the setting's hook", async () => {
    const s = await loadSettingsList();
    const categories = new Set(s.list.SETTINGS_ARRAY.map(setting => `use${setting.Category}`));
    let routed = 0;
    for (const [endpoint] of referenceReceivers) {
        const receiver = receiverOf(endpoint);
        if (!receiver || !categories.has(receiver[0]) || staticRouteEndpoints.has(endpoint)) continue;
        const prefix = ANSWERS.find(name => receiver[1].startsWith(name));
        const setting = s.list.SETTINGS_ARRAY.find(item => `use${item.Category}` === receiver[0] && `${prefix}${item.Base_Name}` === receiver[1]);
        assert.ok(setting, `${endpoint} -> ${receiver.join(".")} names no setting`);
        const api = s.category(setting.Category);
        assert.equal(typeof fieldOf(api, receiver[1]), "function", `${endpoint} -> ${receiver.join(".")}`);
        routed++;
        if (endpoint.startsWith("/run/")) {
            // A notice of the setting's value that the core sends on its own: the setting listens for
            // it. The weights' download notices have routes of their own.
            assert.equal(runFlag(setting, "from_backend"), endpoint === `/run/${setting.base_endpoint_name}`, endpoint);
            continue;
        }
        // The weights' list is read with the other values at start-up, not by a function of the setting.
        if (!coreRequests.has(endpoint) || !endpoint.endsWith(`/${setting.base_endpoint_name}`)) continue;
        if (/^\/set\/(enable|disable)\//.test(endpoint) && setting.logics_template_id !== "toggle_enable_disable") {
            // The route table also listens for on and off for a setting drawn as a switch; this one
            // saves its value with /set/data/ (TrayCompanionWheelHintShown).
            assert.equal(setting.ui_template_id, "toggle", endpoint);
            continue;
        }
        assert.ok(requestsOf(s, setting).has(endpoint), `${setting.Base_Name} never sends ${endpoint}`);
    }
    assert.ok(routed > 300, String(routed));
});

test("a request marks its setting as waiting, and a failed answer releases it", async () => {
    const s = await loadSettingsList();
    for (const setting of s.list.SETTINGS_ARRAY) {
        if (setting.logics_template_id === "weight_download_status") continue;
        for (const [verb, value] of REQUESTS) {
            const api = s.category(setting.Category);
            const fn = fieldOf(api, `${verb}${setting.Base_Name}`);
            if (typeof fn !== "function") continue;
            // A copy: the VR layout keeps the value it has when it is given the same one.
            call(api, `update${setting.Base_Name}`, structuredClone(setting.default_value));
            assert.equal(stateOf(s, setting).state, "ok", setting.Base_Name);
            s.sent.length = 0;
            fn(value);
            assert.equal(stateOf(s, setting).state, "pending", `${verb}${setting.Base_Name}`);
            assert.equal(s.sent.length, 1, `${verb}${setting.Base_Name}`);
            s.recovery.receive({ endpoint: s.sent[0][0], status: 500, result: null }, () => true);
            assert.equal(stateOf(s, setting).state, "ok", `a failed ${s.sent[0][0]} releases ${setting.Base_Name}`);
            assert.deepEqual(stateOf(s, setting).data, setting.default_value, setting.Base_Name);
        }
    }
});

test("a switch asks to turn its setting off while it is on, and on while it is off", async () => {
    const s = await loadSettingsList();
    const switches = s.list.SETTINGS_ARRAY.filter(setting => setting.logics_template_id === "toggle_enable_disable");
    assert.ok(switches.length > 30);
    for (const setting of switches) {
        const name = setting.Base_Name, endpoint = setting.base_endpoint_name;
        for (const [value, request] of [[true, "disable"], [false, "enable"], [1, "disable"], [null, "enable"]] as const) {
            call(s.category(setting.Category), `update${name}`, value);
            s.sent.length = 0;
            call(s.category(setting.Category), `toggle${name}`);
            assert.deepEqual(s.sent, [[`/set/${request}/${endpoint}`]], `${name} at ${String(value)}`);
        }
    }
});

// An answer of the backend for a setting, and the value the setting keeps from it: a list goes
// through the setting's transform (utils.ts), any other answer is kept as it is.
const answerFor = (setting: Setting): [unknown, unknown] => {
    switch (transformOf(setting)) {
        case "deviceOptionsToObject": {
            const devices = [{ id: "1", label: "Mic" }, { id: 2, label: "Mic" }, { id: "3", label: "Line" }];
            return [devices, utils.deviceOptionsToObject(devices)];
        }
        case "arrayToObject": return [["a", 2], utils.arrayToObject(["a", 2])];
        case "transformToIndexedArray": return [[{ id: "x" }, "y"], utils.transformToIndexedArray([{ id: "x" }, "y"])];
        default: return [{ answer: setting.Base_Name }, { answer: setting.Base_Name }];
    }
};

test("an answer becomes the setting's value, through its transform; only a write's answer says it was saved", async () => {
    const s = await loadSettingsList();
    let saved = 0;
    for (const setting of s.list.SETTINGS_ARRAY) {
        const name = setting.Base_Name, [answer, value] = answerFor(setting);
        call(s.category(setting.Category), `updateFromBackend${name}`, answer);
        assert.deepEqual(stateOf(s, setting), { state: "ok", data: value }, `updateFromBackend${name}`);
        assert.equal(s.saveNotices, saved, `updateFromBackend${name} says nothing`);
        for (const success of ["setSuccess", "deleteSuccess"]) {
            const api = s.category(setting.Category);
            if (typeof fieldOf(api, `${success}${name}`) !== "function") continue;
            call(api, `update${name}`, setting.default_value);
            call(api, `${success}${name}`, answer);
            assert.deepEqual(stateOf(s, setting), { state: "ok", data: value }, `${success}${name}`);
            assert.equal(s.saveNotices, ++saved, `${success}${name} says it was saved`);
        }
    }
    assert.ok(saved > 150, String(saved));
});

test("a transform refuses an answer that is not a list, or that holds an item it cannot read", async () => {
    const s = await loadSettingsList();
    const refused: Record<string, unknown[]> = {
        deviceOptionsToObject: [[{ id: true, label: "Mic" }], [{ id: "1" }], [{ id: "1", label: 2 }], [null], ["Mic"]],
        arrayToObject: [[{}], [null], [true], [["a"]]],
        transformToIndexedArray: [],
    };
    const read: Record<string, unknown[][]> = {
        deviceOptionsToObject: [[], [{ id: 7, label: "Mic" }]],
        arrayToObject: [[], ["a"], [3], [Symbol.for("key")]],
        transformToIndexedArray: [[], [null, true, {}]],
    };
    const transformed = s.list.SETTINGS_ARRAY.filter(setting => transformOf(setting) !== undefined);
    assert.ok(transformed.length > 15);
    for (const setting of transformed) {
        const name = setting.Base_Name, transform = String(transformOf(setting));
        for (const answer of ["text", { 0: "a" }, null, 3]) {
            assert.throws(() => call(s.category(setting.Category), `updateFromBackend${name}`, answer),
                { name: "TypeError", message: `[transformResponse] ${transform} expects a list.` }, `${name} ${JSON.stringify(answer)}`);
        }
        for (const answer of refused[transform]) {
            assert.throws(() => call(s.category(setting.Category), `setSuccess${name}`, answer),
                { name: "TypeError", message: `[transformResponse] ${transform} got an item it cannot read.` }, `${name} ${String(answer)}`);
        }
        for (const answer of read[transform]) {
            call(s.category(setting.Category), `updateFromBackend${name}`, answer);
            assert.equal(stateOf(s, setting).state, "ok", `${name} reads ${answer.map(item => typeof item).join(", ")}`);
        }
    }
});

test("a category's hook gives the fields of its own settings and none of the others'", async () => {
    const s = await loadSettingsList();
    const categories = [...new Set(s.list.SETTINGS_ARRAY.map(setting => setting.Category))];
    for (const category of categories) {
        const api = s.category(category);
        for (const [key, value] of Object.entries(api)) assert.notEqual(value, undefined, `${category}: ${key} is there without a value`);
        for (const setting of s.list.SETTINGS_ARRAY) {
            const own = setting.Category === category, name = setting.Base_Name;
            assert.equal(fieldOf(api, `current${name}`) !== undefined, own, `${category}: current${name}`);
            assert.equal(typeof fieldOf(api, `updateFromBackend${name}`) === "function", own, `${category}: updateFromBackend${name}`);
            if (own) {
                assert.deepEqual(fieldOf(api, `current${name}`), stateOf(s, setting), `current${name}`);
                assert.equal(typeof fieldOf(api, `update${name}`), "function", `update${name}`);
            }
        }
    }
});

test("each setting's value can be read on its own, and an unknown name stops", async () => {
    const s = await loadSettingsList();
    for (const setting of s.list.SETTINGS_ARRAY) {
        call(s.category(setting.Category), `updateFromBackend${setting.Base_Name}`, answerFor(setting)[0]);
        assert.deepEqual(s.runtime.render(() => s.list.useSettingValue(setting.Base_Name)), stateOf(s, setting), setting.Base_Name);
    }
    // A name the list does not have, given on purpose.
    assert.throws(() => s.runtime.render(() => s.list.useSettingValue(unchecked<SettingName>("NoSuchSetting"))), { name: "TypeError", message: "No setting is named NoSuchSetting" });
});

test("the VR settings can also send text to the overlay, and no other category has functions of its own", async () => {
    const s = await loadSettingsList();
    call(s.category("Vr"), "sendTextToOverlay", "Hello");
    assert.deepEqual(s.sent, [["/run/send_text_overlay", "Hello"]]);
    assert.ok(coreRequests.has("/run/send_text_overlay"));
    const names = new Set(s.list.SETTINGS_ARRAY.map(setting => setting.Base_Name));
    for (const category of new Set(s.list.SETTINGS_ARRAY.map(setting => setting.Category))) {
        const own = Object.keys(s.category(category)).filter(key => ![...names].some(name => key.endsWith(name)));
        assert.deepEqual(own, category === "Vr" ? ["sendTextToOverlay"] : [], category);
    }
});
