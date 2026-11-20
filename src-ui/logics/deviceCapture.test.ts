import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import i18next from "i18next";
import type { ResourceKey } from "i18next";
import type { Atom } from "jotai/vanilla";
import yaml from "js-yaml";
import { loadBridgeRoutes } from "./test/bridgeHarness.ts";
import { loadModule, unchecked } from "./test/hookHarness.ts";
import type { AtomState } from "./store.ts";

// A locale file, which is a mapping of keys to text.
const localeFile = (path: string) => unchecked<ResourceKey>(yaml.load(readFileSync(new URL(path, import.meta.url), "utf8")));
// The store's registry holds each atom under its Atom_ name.
const registered = <T>(registry: Record<string, unknown>, name: string) => unchecked<Atom<AtomState<T>>>(registry[name]);
import * as meterValue from "./common/meterValue.ts";

for (const language of ["en", "ja"]) for (const source of ["mic", "speaker"]) {
    test(`${language} ${source}: opened fallback is selected by ID and one notice names both devices`, async () => {
        const translation = localeFile(`../../locales/${language}.yml`);
        const i18n = i18next.createInstance();
        await i18n.init({ lng: language, resources: { [language]: { translation } }, interpolation: { escapeValue: false } });
        const s = await loadBridgeRoutes(undefined, i18n);
        const kind = source === "mic" ? "Mic" : "Speaker";
        const receive = (endpoint: string, result: unknown) => s.receiveRoutes({ status: 200, endpoint, result });
        receive(`/run/selectable_${source}_device_options`, [
            { id: "id-a", label: "USB Audio" }, { id: "id-b", label: "USB Audio" },
        ]);
        receive(`/run/selected_${source}_device_id`, "id-b");
        const options = s.runtime.store.get(registered<Record<string, string>>(s.stores.dynamicStoreRegistry, `Atom_${kind}DeviceOptions`)).data;
        const selected = s.runtime.store.get(registered<string>(s.stores.dynamicStoreRegistry, `Atom_Selected${kind}DeviceId`)).data;
        assert.deepEqual(Object.keys(options), ["id-a", "id-b"]);
        assert.equal(selected, "id-b");
        assert.match(options[selected], /USB Audio/);
        assert.notEqual(options["id-a"], options["id-b"]);
        receive("/run/audio_device_switched", { source,
            old_device: { id: "id-a", name: "マイク A" }, new_device: { id: "id-b", name: "USB B" } });
        assert.equal(s.notices.length, 1);
        assert.equal(s.notices[0].type, "warning");
        assert.match(s.notices[0].key, /マイク A/);
        assert.match(s.notices[0].key, /USB B/);
        // The notice's options say how long it stays.
        assert.notEqual(unchecked<{ hide_duration: unknown }>(s.notices[0]?.options).hide_duration, null);
        assert.deepEqual(s.reads, []);
    });
}

for (const source of ["mic", "speaker"]) test(`${source}: terminal device error clears the meter and its enabled state`, async () => {
    const kind = source === "mic" ? "Mic" : "Speaker";
    const s = await loadBridgeRoutes(async subject => {
        const volume = await loadModule(new URL("./common/useVolume.ts", import.meta.url), subject.runtime, {
            "@store": subject.stores, jotai: subject.jotai,
            "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython: () => {} }) },
            "./meterValue.ts": meterValue,
        });
        return volume;
    });
    // A level of the wrong shape on purpose: the error resets the meter whatever it held.
    s.runtime.store.set(s.stores[`Atom_${kind}Volume`], unchecked(500));
    s.runtime.store.set(s.stores[`Atom_${kind}ThresholdCheckStatus`], { state: "ok", data: true });
    s.receiveRoutes({ status: 400, endpoint: "/run/error_device", result: { error_code: `DEVICE_NO_${source.toUpperCase()}` } });
    assert.equal(s.runtime.store.get(s.stores[`Atom_${kind}ThresholdCheckStatus`]).data, false);
    assert.equal(Number(s.runtime.store.get(s.stores[`Atom_${kind}Volume`]).data), 0);
});

test("switches between duplicate labels distinguish the endpoints in the notice", async () => {
    const i18n = i18next.createInstance();
    const translation = localeFile("../../locales/en.yml");
    await i18n.init({ lng: "en", resources: { en: { translation } }, interpolation: { escapeValue: false } });
    const s = await loadBridgeRoutes(undefined, i18n);
    s.receiveRoutes({ status: 200, endpoint: "/run/audio_device_switched", result: { source: "mic",
        old_device: { id: "endpoint-a", name: "USB mic" }, new_device: { id: "endpoint-b", name: "USB mic" } } });
    assert.match(s.notices[0].key, /USB mic \(endpoint-a\)/);
    assert.match(s.notices[0].key, /USB mic \(endpoint-b\)/);
});
