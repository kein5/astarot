import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import yaml from "js-yaml";
import { hooks, loadModule, find } from "../../../logics/test/hookHarness.js";
import * as migration from "../../../logics/transcription/localAsrMigration.js";

const OldWhisperWeights = () => null;

async function setup(context, { notice = true, settings = { profiles: { asr: { model: "", vad_model: "/m/vad.gguf" } } } } = {}) {
    const runtime = hooks(), calls = [];
    const state = { notice, dismissNotice: () => { calls.push("dismiss"); state.notice = false; } };
    let closed = 0;
    const { LocalAsrNoticeController } = await loadModule(new URL("./LocalAsrNoticeController.jsx", import.meta.url), runtime, {
        "@store": {
            useStore_IsOpenedConfigPage: () => ({ updateIsOpenedConfigPage: value => calls.push(["opened", value]) }),
            useStore_SelectedConfigTabId: () => ({ updateSelectedConfigTabId: value => calls.push(["tab", value]) }),
        },
        "../../../logics/common/useConsentDialog": { useConsentDialog: open => ({ dialog: { current: null, open }, close: () => { closed++; } }) },
        "../../../logics/transcription/useLocalAsrMigration": { useLocalAsrMigration: () => state },
        "../../../logics/voice/useSpeechServers": { useSpeechServers: () => ({ settings }) },
        "../../../logics/transcription/localAsrMigration.js": migration,
        "../config_page/setting_section/setting_box/transcription/OldWhisperWeights": { OldWhisperWeights },
    });
    context.after(() => runtime.unmount());
    const render = () => runtime.render(LocalAsrNoticeController);
    const buttons = () => {
        const found = [];
        find(render(), node => { if (node.type === "button") found.push(node); return false; });
        return found;
    };
    return { render, buttons, calls, state, closed: () => closed };
}

test("the notice shows only while the backend says it is pending", async context => {
    for (const notice of [null, false]) assert.equal((await setup(context, { notice })).render(), null);
    const s = await setup(context);
    const dialog = find(s.render(), node => node.type === "dialog");
    assert.equal(dialog.props["aria-label"], "local_asr_notice.title");
    const texts = [];
    find(dialog, node => { if (node.type === "p") texts.push(node.props.children); return false; });
    // Whisper is gone and the engine moved; what the bundled server needs, and that nothing downloads without consent.
    assert.deepEqual(texts, ["local_asr_notice.removed", "local_asr_notice.needs"]);
    // Each model the asr profile needs, and whether it is set there.
    const facts = [];
    find(dialog, node => { if (node.type === "dt" || node.type === "dd") facts.push(node.props.children); return false; });
    assert.deepEqual(facts, ["local_asr_notice.asr_model", "local_asr_notice.unset", "local_asr_notice.vad_model", "local_asr_notice.set"]);
    // The old Whisper models can be deleted from here too (the box shows itself only while some remain).
    assert.equal(find(dialog, node => node.type === OldWhisperWeights).props.inDialog, true);
    assert.deepEqual(s.buttons().map(button => button.props.children), ["local_asr_notice.close", "local_asr_notice.open_settings"]);
    // The way forward has the first focus.
    assert.equal(s.buttons()[1].props.autoFocus, true);
});

test("until the server settings are known, the model lines wait instead of guessing", async context => {
    const s = await setup(context, { settings: null });
    assert.equal(find(s.render(), node => node.type === "dl"), null);
});

test("Open settings goes to Speech recognition and clears the notice; it downloads nothing", async context => {
    const s = await setup(context);
    s.buttons()[1].props.onClick();
    assert.deepEqual(s.calls, ["dismiss", ["tab", "transcription"], ["opened", true]]);
    assert.equal(s.closed(), 1);
    assert.equal(s.render(), null);
});

test("Close and Escape clear the notice for good", async context => {
    const close = await setup(context);
    close.buttons()[0].props.onClick();
    assert.deepEqual(close.calls, ["dismiss"]);
    assert.equal(close.render(), null);

    const escape = await setup(context);
    let prevented = false;
    find(escape.render(), node => node.type === "dialog").props.onCancel({ preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true, "the page closes the dialog itself, so focus goes back where it was");
    assert.deepEqual(escape.calls, ["dismiss"]);
    assert.equal(escape.render(), null);
});

for (const language of ["en", "ja"]) test(`${language}: the notice and the old models box have their text`, () => {
    const messages = yaml.load(readFileSync(new URL(`../../../../locales/${language}.yml`, import.meta.url), "utf8"));
    for (const key of ["title", "removed", "needs", "asr_model", "vad_model", "set", "unset", "open_settings", "close"])
        assert.equal(typeof messages.local_asr_notice[key], "string", key);
    for (const key of ["label", "desc", "delete", "confirm", "confirm_delete", "cancel", "deleting", "deleted", "failed", "unavailable"])
        assert.equal(typeof messages.old_whisper_weights[key], "string", key);
    for (const key of ["desc", "confirm", "failed"]) assert.match(messages.old_whisper_weights[key], /\{\{size\}\}/);
    assert.match(messages.local_asr_notice.removed, /Whisper/);
    assert.match(messages.local_asr_notice.needs, /VAD|ASR/);
});
