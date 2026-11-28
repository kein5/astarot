import assert from "node:assert/strict";
import { test, vi } from "vitest";
import type { TestContext } from "vitest";
import { hooks, loadModule, stubGlobals, eventTarget, find, fieldOf } from "../test/hookHarness.ts";
import { flush, loadBridgeRoutes } from "../test/bridgeHarness.ts";
import { rebaseDraft } from "../voice/draftRebase.ts";
import { createSettingsWriteResponses } from "../common/settingsWriteResponses.ts";
import { endpointDescription, endpointNotices } from "../common/endpointPrivacy.ts";
import type { SettingsWriteRequest } from "../common/settingsWriteResponses.ts";
import type { SettingsDraft } from "../voice/useSettingsDraft.tsx";
import type { CredentialSettings } from "../../views/app/config_page/setting_section/setting_box/_components/credential_pair/CredentialPair.tsx";
import * as fieldErrors from "./fieldErrors.ts";

// The fields of the pair that differ from the saved pair.
const changedKeys = (saved: unknown, draft: unknown): string[] => {
    const record = (value: unknown): Record<string, unknown> => typeof value === "object" && value !== null ? { ...value } : {};
    const before = record(saved), after = record(draft);
    return Object.keys(after).filter(key => after[key] !== before[key]);
};

// A write the form asked for, with what it sent and the owner of its answer.
interface SentWrite {
    endpoint: string;
    data: unknown;
    request: SettingsWriteRequest | false | null;
}
// What a pair write sends; the tests read it after checking it.
interface SentPair {
    url: string;
    auth_key: string;
}
const isSentPair = (data: unknown): data is SentPair =>
    typeof fieldOf(data, "url") === "string" && typeof fieldOf(data, "auth_key") === "string";
// The write's value itself, read as the pair the test has just compared it with.
const sentPair = (data: unknown): SentPair => {
    assert.ok(isSentPair(data), "the write sends a URL and a key");
    return data;
};
// React calls a function given to a state setter instead of keeping it.
const isUpdate = <S>(next: S | ((previous: S) => S)): next is (previous: S) => S => typeof next === "function";

const providers = [["OpenAICompatible", "openai_compatible", "translation"], ["CustomWhisper", "custom_whisper", "transcription"]];
// hints: whether the page keeps descriptions out of sight (#614).
// keepUrlDescription: whether that page keeps the URL's words on screen all the same.
async function setup(context: TestContext, base: string, provider: string, section: string, hints = false, keepUrlDescription = false) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const runtime = hooks(), requests: SentWrite[] = [], owners = createSettingsWriteResponses();
    // Flush state updates as React would; a render that keeps rebasing a fresh
    // saved object must fail here instead of hiding an effect/render loop.
    const useState = runtime.api.useState;
    let updates = 0;
    runtime.api.useState = initial => {
        const [value, setValue] = useState(initial);
        return [value, next => setValue(previous => {
            const resolved = isUpdate(next) ? next(previous) : next;
            if (!Object.is(previous, resolved)) updates++;
            return resolved;
        })];
    };
    context.onTestFinished(() => { runtime.unmount(); owners.stop(); });
    const window = eventTarget();
    stubGlobals(context, { window });
    const draft = await loadModule<typeof import("../voice/useSettingsDraft.tsx")>(new URL("../voice/useSettingsDraft.tsx", import.meta.url), runtime, {
        "./draftRebase": { rebaseDraft }, 
    });
    const settings: CredentialSettings<string> = {
        [`current${base}URL`]: { state: "ok", data: "https://provider-a.example/v1" },
        [`current${base}AuthKey`]: { state: "ok", data: "FAKE-KEY-A" },
    };
    // The pair saves by itself (#1111): the tests read its form's state where the save bar read it.
    let form: { value: SettingsDraft<unknown>; saved: unknown; canSave: unknown } | undefined;
    const drafts = { ...draft, useSettingsDraft: (...args: Parameters<typeof draft.useSettingsDraft>) => {
        const value = draft.useSettingsDraft(...args);
        form = { value, saved: args[0], canSave: args[3]?.canSave };
        return value;
    } };
    const component = await loadModule<typeof import("../../views/app/config_page/setting_section/setting_box/_components/credential_pair/CredentialPair.tsx")>(new URL("../../views/app/config_page/setting_section/setting_box/_components/credential_pair/CredentialPair.tsx", import.meta.url), runtime, { "../../../../../../../logics/configs/fieldErrors.ts": fieldErrors,
        "../../../../../../../logics/voice/useSettingsDraft": drafts,
        "../../../../../../../logics/common/endpointPrivacy": { endpointDescription, endpointNotices },
        "../../_templates/Templates": { EntryWithSaveButtonContainer: "url", AuthKeyContainer: "key" },
        "../hint/Hint": { useHintDescriptions: () => hints },
        "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython: (endpoint: string, data?: unknown) => {
            const request = owners.begin(endpoint);
            requests.push({ endpoint, data, request });
            // As request.response read it: nothing for false, a TypeError for null.
            if (request === null) throw new TypeError("No owner for the write");
            return request === false ? undefined : request.response;
        } }) },
    });
    const render = () => {
        for (let count = 0; count < 20; count++) {
            const previous = updates;
            const tree = runtime.render(component.CredentialPair, { settings, base, provider, section, keepUrlDescription });
            if (updates === previous) return tree;
        }
        assert.fail("credential form did not settle after 20 renders");
    };
    const field = (type: string) => {
        const node = find(render(), node => node.type === type);
        assert.ok(node);
        return node.props;
    };
    const edit = (type: string, value: unknown) => { field(type).onChangeFunction(value); render(); };
    // Focus leaving the pair, from its key field.
    const leave = () => { field("key").leaveFunction({ relatedTarget: null }); render(); };
    const state = () => {
        assert.ok(form);
        const { value, saved, canSave } = form;
        return { saving: value.saving, saveState: value.saveState, dirty: value.dirty, changes: changedKeys(saved, value.draft),
            canSave: typeof canSave === "function" ? !!canSave(value.draft) : canSave !== false };
    };
    render();
    return { requests, owners, edit, field, render, settings, window, leave, state };
}

for (const [base, provider, section] of providers) {
    for (const enter of [false, true]) test(`${provider}: ${enter ? "Enter" : "leaving the pair"} submits both edited credentials once`, async context => {
        const s = await setup(context, base, provider, section);
        s.edit("url", "https://provider-b.example/v1");
        // Moving from the address to the key saves nothing yet.
        s.field("url").leaveFunction({ relatedTarget: {} }); s.render();
        s.edit("key", "FAKE-KEY-B");
        assert.equal(s.state().changes.length, 2);
        if (enter) s.field("key").saveFunction();
        else s.leave();
        s.render();
        assert.equal(s.requests.length, 1);
        const request = s.requests[0];
        assert.equal(request.endpoint, `/set/data/${provider}_auth_key_and_url`);
        assert.deepEqual(request.data, { url: "https://provider-b.example/v1", auth_key: "FAKE-KEY-B" });
        const sent = sentPair(request.data);
        s.owners.receive({ endpoint: `/get/data/${provider}_url`, status: 200, result: sent.url });
        assert.equal(s.state().saving, true);
        s.settings[`current${base}URL`].data = sent.url;
        s.settings[`current${base}AuthKey`].data = sent.auth_key;
        s.owners.receive({ endpoint: request.endpoint, status: 200, result: sent });
        await flush(); s.render();
        assert.equal(s.state().saveState, "saved");
        assert.equal(s.state().dirty, false);
    });

    for (const [field, value, suffix, data] of ([
        ["key", "FAKE-KEY-B", "auth_key", "FAKE-KEY-B"],
        ["key", "", "auth_key", undefined],
    ] satisfies [string, string, string, string | undefined][])) test(`${provider}: editing only ${field} (${value || "delete"}) preserves the single-field endpoint`, async context => {
        const s = await setup(context, base, provider, section);
        // A new key saves when focus leaves the pair; an empty one is deleted only on Enter (#1111, decided 2).
        s.edit(field, value);
        if (value) s.leave(); else s.field("key").saveFunction();
        s.render();
        assert.equal(s.requests.length, 1);
        assert.equal(s.requests[0].endpoint, `/${value ? "set" : "delete"}/data/${provider}_${suffix}`);
        assert.equal(s.requests[0].data, data);
    });

    test(`${provider}: leaving the pair with the key field empty keeps the saved key`, async context => {
        const s = await setup(context, base, provider, section);
        s.edit("key", "");
        s.leave(); await flush(); s.render();
        assert.equal(s.requests.length, 0);
        assert.equal(s.field("key").variable, "FAKE-KEY-A");
        assert.equal(s.state().dirty, false);
    });

    test(`${provider}: a changed URL clears the saved key and blocks every save path`, async context => {
        const s = await setup(context, base, provider, section);
        s.edit("url", "https://provider-b.example/v1");
        assert.equal(s.field("key").variable, "");
        assert.equal(s.state().canSave, false);
        assert.deepEqual(s.field("key").add_warnings, [{ label: "config_page.common.credential_reentry_required" }]);
        s.field("url").saveFunction(); s.field("key").saveFunction(); s.leave();
        await flush(); s.render();
        assert.equal(s.requests.length, 0);
        s.edit("key", "   ");
        assert.equal(s.state().canSave, false);
        s.field("key").saveFunction();
        assert.equal(s.requests.length, 0);
    });

    test(`${provider}: trimmed URL comparison restores an untouched key`, async context => {
        const s = await setup(context, base, provider, section);
        const savedURL = s.settings[`current${base}URL`].data;
        s.edit("url", `  ${savedURL}  `);
        assert.equal(s.field("key").variable, "FAKE-KEY-A");
        s.edit("url", "https://provider-b.example/v1");
        s.edit("url", "https://provider-c.example/v1");
        assert.equal(s.field("key").variable, "");
        s.edit("url", `  ${savedURL}  `);
        assert.equal(s.field("key").variable, "FAKE-KEY-A");
        assert.equal(s.state().canSave, true);
        assert.deepEqual(s.field("key").add_warnings, []);
    });

    for (const value of ["FAKE-KEY-A", "FAKE-KEY-B"]) {
        for (const keyFirst of [false, true]) test(`${provider}: URL edits preserve a typed ${value} (key first: ${keyFirst})`, async context => {
            const s = await setup(context, base, provider, section);
            if (keyFirst) s.edit("key", value);
            s.edit("url", "https://provider-b.example/v1");
            if (!keyFirst) s.edit("key", value);
            s.edit("url", s.settings[`current${base}URL`].data);
            assert.equal(s.field("key").variable, value);
            s.edit("url", "https://provider-c.example/v1");
            assert.equal(s.field("key").variable, value);
            assert.equal(s.state().canSave, true);
            s.field("key").saveFunction(); s.render();
            assert.equal(s.requests.length, 1);
            const request = s.requests[0];
            assert.equal(request.endpoint, `/set/data/${provider}_auth_key_and_url`);
            assert.deepEqual(request.data, { url: "https://provider-c.example/v1", auth_key: value });
            const sent = sentPair(request.data);
            s.settings[`current${base}URL`].data = sent.url;
            s.settings[`current${base}AuthKey`].data = value;
            s.owners.receive({ endpoint: request.endpoint, status: 200, result: sent });
            await flush(); s.render();
            assert.equal(s.state().dirty, false);
            s.edit("url", "https://provider-d.example/v1");
            assert.equal(s.field("key").variable, "");
        });
    }

    for (const leave of [false, true]) test(`${provider}: ${leave ? "leaving the page" : "Escape"} ${leave ? "asks nothing first" : "restores both values and resets key entry"}`, async context => {
        const s = await setup(context, base, provider, section);
        s.edit("url", "https://provider-b.example/v1");
        assert.equal(s.field("key").variable, "");
        // A refresh must not reinsert the saved secret into the edited pair.
        s.settings[`current${base}AuthKey`] = { state: "ok", data: "FAKE-KEY-A" };
        s.render();
        assert.equal(s.field("key").variable, "");
        if (leave) {
            // #1111, decided 4: the edit is dropped with the page, and nothing asks first.
            let prevented = false;
            s.window.dispatch("vrct:settings-leave", { preventDefault: () => { prevented = true; }, detail: { proceed() {} } });
            assert.equal(prevented, false);
            assert.ok(!find(s.render(), node => node.type === "dialog"));
            return;
        }
        s.field("url").onRevert();
        s.render();
        assert.equal(s.field("url").variable, s.settings[`current${base}URL`].data);
        assert.equal(s.field("key").variable, "FAKE-KEY-A");
        assert.equal(s.state().dirty, false);
        s.edit("key", "FAKE-KEY-B"); s.field("key").onRevert(); s.render();
        s.edit("url", "https://provider-c.example/v1");
        assert.equal(s.field("key").variable, "");
        assert.equal(s.requests.length, 0);
    });

    test(`${provider}: deleting the saved key permits a later URL-only save`, async context => {
        const s = await setup(context, base, provider, section);
        s.edit("key", ""); s.field("key").saveFunction(); s.render();
        const deletion = s.requests[0];
        assert.equal(deletion.endpoint, `/delete/data/${provider}_auth_key`);
        s.settings[`current${base}AuthKey`].data = null;
        s.owners.receive({ endpoint: deletion.endpoint, status: 200, result: null });
        await flush(); s.render();
        s.edit("url", "https://provider-b.example/v1");
        assert.equal(s.state().canSave, true);
        s.leave();
        assert.equal(s.requests[1].endpoint, `/set/data/${provider}_url`);
        assert.equal(s.requests[1].data, "https://provider-b.example/v1");
    });

    test(`${provider}: rebasing a refreshed saved key keeps the new URL draft empty`, async context => {
        const s = await setup(context, base, provider, section);
        s.edit("url", "https://provider-b.example/v1");
        s.settings[`current${base}AuthKey`].data = "FAKE-REFRESHED-KEY";
        s.render();
        assert.equal(s.field("key").variable, "");
        assert.equal(s.field("url").variable, "https://provider-b.example/v1");
        assert.equal(s.state().canSave, false);
        s.field("url").onRevert(); s.render();
        assert.equal(s.field("key").variable, "FAKE-REFRESHED-KEY");
        assert.equal(s.state().dirty, false);
    });

    for (const failure of ["rejected", "transport"]) test(`${provider}: ${failure} pair remains editable without sending a fallback key`, async context => {
        const s = await setup(context, base, provider, section);
        s.edit("url", "https://provider-b.example/v1"); s.edit("key", "FAKE-KEY-B");
        s.leave();
        const request = s.requests[0];
        if (failure === "transport") s.owners.fail(request.request, true);
        else s.owners.receive({ endpoint: request.endpoint, status: 400, result: { error_code: "auth_failed", data: "FAKE-KEY-A" } });
        await flush(); s.render();
        assert.equal(s.field("url").variable, "https://provider-b.example/v1");
        assert.equal(s.field("key").variable, "FAKE-KEY-B");
        assert.equal(s.state().dirty, true);
        assert.equal(s.state().saveState, "save_failed");
        assert.equal(s.requests.length, 1);
        // The refusal is said under the pair (#1111).
        assert.ok(s.field("key").error);
    });

    test(`${provider}: pair response updates both confirmed fields in the receive bridge`, async () => {
        const s = await loadBridgeRoutes();
        s.receiveRoutes({ endpoint: `/set/data/${provider}_auth_key_and_url`, status: 200,
            result: { url: "https://provider-b.example/v1", auth_key: "FAKE-KEY-B" } });
        // The settings' atoms, which the registry keeps beside their hooks.
        const atomAt = (name: string) => {
            const target = s.stores.dynamicStoreRegistry[name];
            assert.ok(target && typeof target !== "function");
            return target;
        };
        assert.deepEqual(s.runtime.store.get(atomAt(`Atom_${base}URL`)),
            { state: "ok", data: "https://provider-b.example/v1" });
        assert.deepEqual(s.runtime.store.get(atomAt(`Atom_${base}AuthKey`)),
            { state: "ok", data: "FAKE-KEY-B" });
        assert.deepEqual(s.notices, []);
    });
}

// #614: where the URL's description is its label's hint, the warning about plain HTTP on the LAN
// is not hidden in it: it stays under the label as a warning.
for (const hints of [false, true]) test(`${hints ? "hints" : "no hints"}: a plain HTTP URL on the LAN keeps its warning in sight`, async context => {
    const s = await setup(context, "CustomWhisper", "custom_whisper", "transcription", hints);
    s.edit("url", "http://192.168.0.10:8000/v1");
    const url = s.field("url");
    assert.match(url.desc, /config_page\.transcription\.custom_whisper_url\.desc network_privacy\.save_notice/);
    if (hints) {
        assert.doesNotMatch(url.desc, /http_warning/);
        assert.deepEqual(url.add_warnings, [{ label: "network_privacy.http_warning" }]);
    } else {
        assert.match(url.desc, /network_privacy\.http_warning$/);
        assert.equal(url.add_warnings, undefined);
    }
    s.edit("url", "https://provider-b.example/v1");
    assert.equal(s.field("url").add_warnings, undefined);
});

// The translation page keeps the OpenAI-compatible URL's words on screen: they say whose charges
// and risks another endpoint brings. The row is then drawn as on a page without hints.
test("hints: a URL whose words are kept on screen keeps them whole, the warning with them", async context => {
    const s = await setup(context, "OpenAICompatible", "openai_compatible", "translation", true, true);
    s.edit("url", "http://192.168.0.10:8000/v1");
    const url = s.field("url");
    assert.equal(url.keep_desc, true);
    assert.match(url.desc, /^config_page\.translation\.openai_compatible_url\.desc network_privacy\.save_notice network_privacy\.http_warning$/);
    assert.equal(url.add_warnings, undefined);
    // Without it, the same page shows the words as the label's hint.
    const hinted = (await setup(context, "OpenAICompatible", "openai_compatible", "translation", true)).field("url");
    assert.equal(hinted.keep_desc, false);
});
