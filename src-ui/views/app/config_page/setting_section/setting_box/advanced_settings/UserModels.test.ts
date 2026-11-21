import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { hooks, loadModule, find, nodesIn } from "../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../logics/test/hookHarness.ts";
import * as modelCatalog from "../../../../../../logics/voice/modelCatalog.ts";

const all = (tree: unknown, predicate: (node: TreeNode) => boolean) => nodesIn(tree).filter(predicate);

const model = (id: string, name: string) => ({ id, name, target: "japanese", paths: { model: `C:/m/${id}.gguf` }, total_bytes: 1, status: "ok" });
type UserModel = ReturnType<typeof model>;

async function form(context: TestContext, models: UserModel[]) {
    const runtime = hooks(), sent: [string, unknown][] = [];
    const state = { models };
    context.onTestFinished(() => runtime.unmount());
    const { UserModelRegistration } = await loadModule<typeof import("./UserModels.tsx")>(new URL("./UserModels.tsx", import.meta.url), runtime, {
        "../../../../../../logics/voice/useModelDownloads": { useModelDownloads: () => ({
            userModels: { models: state.models }, send: (path: string, data: unknown) => sent.push([path, data]) }) },
        "../../../../../../logics/voice/modelCatalog": modelCatalog,
        "../../../../../../logics/common/fileDrop": { extensionOf: () => "" },
        "../_components/file_drop_zone/FileDropZone": { FileDropZone: "drop-zone" },
        "./VoiceAudition": { AuditionButton: "audition-button", AuditionNote: "audition-note" },
        "../_components/fold/Fold": { Fold: "fold" },
        "./catalogLayout": { CatalogFacts: "catalog-facts" },
    });
    const render = () => runtime.render(UserModelRegistration, { target: "japanese", busy: false });
    const inputs = () => all(render(), node => node.type === "input");
    const type = (index: number, value: string) => { inputs()[index].props.onChange({ target: { value } }); render(); };
    const submit = () => {
        const button = find(render(), node => node.type === "button");
        // The form's button: one that is not there fails here, as pressing it did.
        assert.ok(button);
        button.props.onClick();
        render();
    };
    return { state, sent, render, inputs, type, submit };
}

test("a form's problem is said under its button, so the button stays under the pointer (#912)", async context => {
    const s = await form(context, []);
    s.submit();
    const nodes = nodesIn(s.render());
    const button = nodes.findIndex(node => node.type === "button"), alert = nodes.findIndex(node => node.props?.role === "alert");
    assert.ok(button >= 0 && alert > button, `the problem (${alert}) after the button (${button})`);
    assert.deepEqual(s.sent, [], "nothing sent without a name");
});

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
