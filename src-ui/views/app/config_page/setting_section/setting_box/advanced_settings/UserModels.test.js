import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, find } from "../../../../../../logics/test/hookHarness.js";
import * as modelCatalog from "../../../../../../logics/voice/modelCatalog.ts";

const all = (tree, predicate, found = []) => { find(tree, node => { if (predicate(node)) found.push(node); return false; }); return found; };

async function form(context, models) {
    const runtime = hooks(), sent = [];
    const state = { models };
    context.onTestFinished(() => runtime.unmount());
    const { UserModelRegistration } = await loadModule(new URL("./UserModels.tsx", import.meta.url), runtime, {
        "../../../../../../logics/voice/useModelDownloads": { useModelDownloads: () => ({
            userModels: { models: state.models }, send: (path, data) => sent.push([path, data]) }) },
        "../../../../../../logics/voice/modelCatalog": modelCatalog,
        "../../../../../../logics/common/fileDrop": { extensionOf: () => "" },
        "../_components/file_drop_zone/FileDropZone": { FileDropZone: "drop-zone" },
        "./VoiceAudition": { AuditionButton: "audition-button", AuditionNote: "audition-note" },
    });
    const render = () => runtime.render(UserModelRegistration, { target: "japanese", busy: false });
    const inputs = () => all(render(), node => node.type === "input");
    const type = (index, value) => { inputs()[index].props.onChange({ target: { value } }); render(); };
    const submit = () => { find(render(), node => node.type === "button").props.onClick(); render(); };
    return { state, sent, render, inputs, type, submit };
}

const model = (id, name) => ({ id, name, target: "japanese", paths: { model: `C:/m/${id}.gguf` }, total_bytes: 1, status: "ok" });

test("a name already registered is refused without clearing what was typed", async context => {
    const s = await form(context, [model("old", "Voice")]);
    s.type(0, "Voice");
    s.type(1, "C:/m/new.gguf");
    s.submit();
    assert.equal(s.sent[0][0], "/run/register_user_model");
    // The engine refuses with user_model_exists; the list still holds only the old one.
    s.state.models = [model("old", "Voice")];
    s.render();
    assert.deepEqual(s.inputs().map(input => input.props.value), ["Voice", "C:/m/new.gguf"]);
});

test("a model registered under the name sent clears the form", async context => {
    const s = await form(context, [model("old", "Other")]);
    s.type(0, " Voice ");
    s.type(1, "C:/m/new.gguf");
    s.submit();
    s.state.models = [model("old", "Other"), model("new", "Voice")];
    s.render();
    s.render();
    assert.deepEqual(s.inputs().map(input => input.props.value), ["", ""]);
});
