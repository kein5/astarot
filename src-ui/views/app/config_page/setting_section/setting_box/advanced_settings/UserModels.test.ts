import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { hooks, loadModule, find, nodesIn } from "../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../logics/test/hookHarness.ts";
import * as modelCatalog from "../../../../../../logics/voice/modelCatalog.ts";

const all = (tree: unknown, predicate: (node: TreeNode) => boolean) => nodesIn(tree).filter(predicate);

const model = (id: string, name: string) => ({ id, name, target: "japanese", paths: { model: `C:/m/${id}.gguf` }, total_bytes: 1, status: "ok" });
type UserModel = ReturnType<typeof model>;

async function form(context: TestContext, models: UserModel[], hintsOn = true) {
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
        "../_components/hint/Hint": { useHintDescriptions: () => hintsOn },
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

test("a form's problem is said under its button, in a line kept for it, so nothing moves (#912)", async context => {
    const s = await form(context, []);
    // The line is there before any problem.
    const slot = (tree: TreeNode) => find(tree, node => node.props?.className === "problem_slot");
    assert.ok(slot(s.render()), "a line kept for the problem");
    assert.equal(find(s.render(), node => node.props?.role === "alert"), null);
    s.submit();
    const tree = s.render();
    const nodes = nodesIn(tree);
    const button = nodes.findIndex(node => node.type === "button"), alert = nodes.findIndex(node => node.props?.role === "alert");
    assert.ok(button >= 0 && alert > button, `the problem (${alert}) after the button (${button})`);
    assert.ok(find(slot(tree), node => node.props?.role === "alert"), "the problem in that line");
    assert.deepEqual(s.sent, [], "nothing sent without a name");
});

test("the line kept for a form's problem is as high as the problem's frame of one line (#912)", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync(new URL("./VoiceSettings.module.scss", import.meta.url), "utf8");
    const alert = /\[role="alert"\] \{([^}]*)\}/.exec(css)?.[1] ?? "";
    const size = /font-size: ([\d.]+)rem/.exec(alert)?.[1], padding = Number(/padding: ([\d.]+)rem/.exec(alert)?.[1]);
    const border = Number(/border: ([\d.]+)rem/.exec(alert)?.[1]);
    // The descriptions' line height, which the problem's text takes as a paragraph.
    const line = /\n {4}p \{ font-size: [\d.]+rem; line-height: ([\d.]+);/.exec(css)?.[1];
    assert.ok(size && line && padding && border, "the problem's frame");
    assert.match(css, new RegExp(`\\.problem_slot \\{ min-height: calc\\(${size}rem \\* ${line} \\+ ${+(2 * padding + 2 * border).toFixed(2)}rem\\); \\}`));
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

// #614: on a page that keeps descriptions out of sight, what registering does is the fold's hint;
// whose files they are stays in view, as a warning. Elsewhere both are lines in the form.
test("what registering does is the fold's hint, and the warning about the files stays in view", async context => {
    const words = (tree: unknown) => nodesIn(tree).filter(node => node.type === "p").map(node => node.props.children);
    const hinted = await form(context, [], true);
    let tree = hinted.render();
    assert.equal(tree.props.hint, "user_models.register_help");
    assert.deepEqual(words(tree).filter(word => typeof word === "string" && word.startsWith("user_models.")), ["user_models.terms_help"]);
    const plain = await form(context, [], false);
    tree = plain.render();
    assert.equal(tree.props.hint, undefined);
    assert.deepEqual(words(tree).filter(word => typeof word === "string" && word.startsWith("user_models.")), ["user_models.register_help", "user_models.terms_help"]);
});
