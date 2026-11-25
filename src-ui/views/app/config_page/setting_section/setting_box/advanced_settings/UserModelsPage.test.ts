import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { find, findIn, hooks, kitStandIns, loadModule, nodesIn, treeNode } from "../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../logics/test/hookHarness.ts";
import * as modelCatalog from "../../../../../../logics/voice/modelCatalog.ts";
import * as fileDrop from "../../../../../../logics/common/fileDrop.ts";

// The models of one's own (UserModels.tsx): their cards in a catalog's list and the form that
// registers one, drawn with the real catalog rules (the file kinds of each use, the registration's
// checks, a model's state) and the real file extension. The downloads hook is a stand-in that holds
// the registered models and records what the page sends; the shared parts are stand-ins that keep
// their props.

const t = (key: string, variables?: object) => variables ? `${key} ${JSON.stringify(variables)}` : key;
const GiB = 1024 ** 3;
const own = (id: string, extra: Record<string, unknown> = {}) => ({ id, target: "rvc", name: `Voice ${id}`, paths: { model: `/m/${id}.pth`, index: `/m/${id}.index` },
    total_bytes: 2 * GiB, registered_at: null, status: "ok", ...extra });

async function userModels(context: TestContext, models: unknown[] | null, options: { hints?: boolean } = {}) {
    const runtime = hooks(), sent: unknown[][] = [];
    context.onTestFinished(() => runtime.unmount());
    const state = { userModels: models === null ? null : { models } };
    const module = await loadModule<typeof import("./UserModels.tsx")>(new URL("./UserModels.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t }) },
        "../../../../../../logics/voice/useModelDownloads": { useModelDownloads: () => ({ userModels: state.userModels,
            send: (...args: unknown[]) => { sent.push(args); } }) },
        "../../../../../../logics/voice/modelCatalog": modelCatalog,
        "../../../../../../logics/common/fileDrop": fileDrop,
        "../_components/file_drop_zone/FileDropZone": { FileDropZone: "drop-zone" },
        "../_components/fold/Fold": { Fold: "fold" },
        "../_components/hint/Hint": { useHintDescriptions: () => options.hints ?? false },
        "./catalogLayout": { CatalogFacts: "catalog-facts", CatalogState: "catalog-state" },
        "./VoiceAudition": { AuditionButton: "audition-button", AuditionNote: "audition-note" },
    });
    const cards = (props: Record<string, unknown>) => runtime.render(module.UserModelCards, { target: "rvc", busy: false, ...props });
    const form = (props: Record<string, unknown> = {}) => runtime.render(module.UserModelRegistration, { target: "rvc", busy: false, ...props });
    return { state, sent, cards, form };
}

// The words a part of the tree shows.
const textOf = (value: unknown): string => {
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (Array.isArray(value)) return value.map(textOf).join("");
    const node = treeNode(value);
    return node ? textOf(node.props.children) : "";
};
// type: an element's tag, or a part of the kit (kitStandIns).
const ofType = (tree: unknown, type: unknown) => nodesIn(tree).filter(node => node.type === type);
const classesOf = (node: TreeNode) => String(node.props.className ?? "").split(" ").filter(Boolean);
const cardsIn = (drawn: unknown) => [drawn].flat().map(item => treeNode(item)).filter((item): item is TreeNode => item !== null);
const buttonNamed = (tree: unknown, words: string) => findIn(tree, node => node.type === "button" && textOf(node) === words, `the button ${words}`);
const facts = (tree: unknown) => ofType(tree, "dl").map(list => ofType(list, "div").map(row => [textOf(findIn(row, node => node.type === "dt")), textOf(findIn(row, node => node.type === "dd"))]));

test("a registered model's card says it is the user's, its state, its files and its size, in the list or in the grid", async context => {
    const u = await userModels(context, [own("a"), own("b", { status: "missing" }), own("c", { target: "japanese", paths: { model: "/c.gguf" } })]);
    const [card, missing, ...others] = cardsIn(u.cards({ expected: { rvc: { model: "/m/other.pth" } } }));
    assert.equal(others.length, 0, "only this use's models");
    // The kit's Card, an item of the catalog's list, not the one in use.
    assert.deepEqual([card.type, card.props.as, card.props.active, card.props["data-user-model"], card.props.tabIndex, card.props.role,
        card.props["aria-label"], card.props["data-status"]], [kitStandIns.Card, "li", false, true, -1, "group", "Voice a", "registered"]);
    assert.deepEqual(ofType(card, kitStandIns.CardTitle).map(textOf), ["Voice a"]);
    // The badges in their order: the user's own (the dashed edge), then the state, a registered model's drawn as downloaded.
    const badges = (node: TreeNode) => nodesIn(node).filter(badge => badge.type === kitStandIns.Badge || badge.type === "catalog-state")
        .map(badge => badge.type === "catalog-state" ? ["state", badge.props.state, textOf(badge)] : [`${badge.props.tone} ${badge.props.variant}`, textOf(badge)]);
    assert.deepEqual(badges(card), [["strong dashed", "user_models.badge"], ["state", "downloaded", "user_models.status.registered"]]);
    assert.deepEqual(badges(missing), [["strong dashed", "user_models.badge"], ["state", "missing", "user_models.status.missing"]]);
    // The model in use carries the active frame.
    const [used] = cardsIn(u.cards({ expected: { rvc: { model: "/m/a.pth" } } }));
    assert.deepEqual([used.props["data-status"], used.props.active], ["in_use", true]);
    assert.equal(findIn(card, node => node.type === "catalog-facts").props.layout, "list");
    assert.deepEqual(facts(card), [[["user_models.file.model", "/m/a.pth"], ["user_models.file.index", "/m/a.index"], ["user_models.size", "2.00 GiB"]]]);
    assert.deepEqual(ofType(card, "code").map(code => code.props.style), [{ overflowWrap: "anywhere" }, { overflowWrap: "anywhere" }]);
    // A model without an index lists its model file only.
    const [single] = cardsIn((await userModels(context, [own("d", { paths: { model: "/d.pth" } })])).cards({}));
    assert.deepEqual(facts(single), [[["user_models.file.model", "/d.pth"], ["user_models.size", "2.00 GiB"]]]);
    // In the grid: the mark under the name, the size on the card, the files in the fold.
    const [grid] = cardsIn(u.cards({ layout: "grid" }));
    assert.deepEqual(badges(grid), [["state", "downloaded", "user_models.status.registered"], ["strong dashed", "user_models.badge"]]);
    assert.deepEqual(facts(grid), [[["user_models.size", "2.00 GiB"]], [["user_models.file.model", "/m/a.pth"], ["user_models.file.index", "/m/a.index"]]]);
    assert.deepEqual(ofType(grid, "dl").map(classesOf), [["facts", "card_key"], ["facts"]], "each list of facts in its place on the card");
    assert.equal(findIn(grid, node => node.type === "catalog-facts").props.layout, "grid");
    assert.deepEqual(cardsIn(u.cards({ target: "vad" })), []);
    assert.deepEqual(cardsIn((await userModels(context, null)).cards({})), [], "before the list arrives, no cards");
});

test("a model whose files went or changed says what to do, and a registered one says why Use waits", async context => {
    const u = await userModels(context, [own("gone", { status: "missing" }), own("edited", { status: "changed" }), own("ok"), own("used")]);
    const view = (props: Record<string, unknown>) => Object.fromEntries(cardsIn(u.cards({ expected: { rvc: { model: "/m/used.pth" } }, ...props }))
        .map(card => [card.props["aria-label"], ofType(card, "p").map(line => [line.props.role, textOf(line)])]));
    assert.deepEqual(view({}), { "Voice gone": [["alert", "user_models.status_help.missing"]], "Voice edited": [["alert", "user_models.status_help.changed"]],
        "Voice ok": [], "Voice used": [] });
    assert.deepEqual(view({ blocked: "edited" })["Voice ok"], [[undefined, "user_models.blocked_edited"]]);
    assert.deepEqual(view({ blocked: "busy" })["Voice ok"], [[undefined, "model_downloads.blocked"]]);
    assert.deepEqual(view({ blocked: "busy" })["Voice used"], [], "the model in use waits for nothing");
});

test("Use writes the model's paths over the saved ones when nothing else runs; the model in use has no Use", async context => {
    const u = await userModels(context, [own("ok"), own("used"), own("gone", { status: "missing" })]);
    const expected = { rvc: { model: "/m/used.pth", index: "/m/used.index" } };
    const use = (props: Record<string, unknown>) => Object.fromEntries(cardsIn(u.cards({ expected, ...props })).map(card => {
        const button = find(card, node => node.type === "button" && textOf(node) === "user_models.use");
        return [card.props["aria-label"], button && [button.props.disabled, button.props.className]];
    }));
    assert.deepEqual(use({}), { "Voice ok": [false, "primary"], "Voice used": null, "Voice gone": [true, "primary"] });
    assert.deepEqual(use({ busy: true })["Voice ok"], [true, "primary"]);
    assert.deepEqual(use({ blocked: "edited" })["Voice ok"], [true, "primary"]);
    assert.deepEqual(use({ expected: {} })["Voice ok"], [true, "primary"], "without the saved paths it would replace");
    const [ok] = cardsIn(u.cards({ expected }));
    buttonNamed(ok, "user_models.use").props.onClick();
    assert.deepEqual(u.sent, [["/run/apply_user_model", { id: "ok", expected: expected.rvc }]]);
    const [used] = cardsIn(u.cards({ expected })).slice(1);
    assert.equal(used.props["data-status"], "in_use");
});

test("removing asks first in the card, and forgets only the registration", async context => {
    const u = await userModels(context, [own("a"), own("b")]);
    let [first, second] = cardsIn(u.cards({}));
    assert.equal(buttonNamed(first, "user_models.remove").props.disabled, false);
    assert.equal(ofType(first, "audition-note").length, 1);
    buttonNamed(first, "user_models.remove").props.onClick();
    [first, second] = cardsIn(u.cards({}));
    const confirm = findIn(first, node => node.props?.role === "group" && node.type === "div");
    assert.equal(confirm.props["aria-label"], `user_models.remove_confirm_label {"name":"Voice a"}`);
    assert.deepEqual(ofType(confirm, "p").map(textOf), ["user_models.remove_confirm"]);
    assert.equal(ofType(first, "audition-note").length, 0, "no audition note while it asks");
    assert.equal(find(second, node => node.props?.role === "group" && node.type === "div"), null, "only this card asks");
    const back = buttonNamed(confirm, "model_downloads.back");
    assert.equal(back.props.autoFocus, true);
    back.props.onClick();
    [first] = cardsIn(u.cards({}));
    assert.equal(find(first, node => textOf(node) === "user_models.remove_confirm" && node.type === "p"), null);
    assert.deepEqual(u.sent, []);
    buttonNamed(first, "user_models.remove").props.onClick();
    [first] = cardsIn(u.cards({ busy: true }));
    assert.equal(buttonNamed(first, "user_models.remove_do").props.disabled, true, "not while a download runs");
    [first] = cardsIn(u.cards({}));
    buttonNamed(first, "user_models.remove_do").props.onClick();
    assert.deepEqual(u.sent, [["/run/remove_user_model", { id: "a" }]]);
    [first] = cardsIn(u.cards({}));
    assert.equal(find(first, node => node.type === "p" && textOf(node) === "user_models.remove_confirm"), null);
    assert.equal(buttonNamed(cardsIn(u.cards({ busy: true }))[0], "user_models.remove").props.disabled, true);
});

test("a model of one's own can be heard as a downloaded one: registered as downloaded, in use as in use, missing or changed not at all", async context => {
    const u = await userModels(context, [own("ok"), own("used"), own("gone", { status: "missing" }), own("edited", { status: "changed" })]);
    const audition = { values: { pitch: 2, index_rate: 0.5 }, input: "mic" };
    const shown = cardsIn(u.cards({ expected: { rvc: { model: "/m/used.pth" } }, audition }));
    const props = shown.map(card => [findIn(card, node => node.type === "audition-button").props, findIn(card, node => node.type === "audition-note").props]);
    assert.deepEqual(props.map(([button, note]) => [button.target, button.status, button.entry, button.values, button.input, note.status, note.entry, note.values, note.input]), [
        ["rvc", "downloaded", "ok", audition.values, "mic", "downloaded", "ok", audition.values, "mic"],
        ["rvc", "in_use", "used", audition.values, "mic", "in_use", "used", audition.values, "mic"],
        ["rvc", "not_downloaded", "gone", audition.values, "mic", "not_downloaded", "gone", audition.values, "mic"],
        ["rvc", "not_downloaded", "edited", audition.values, "mic", "not_downloaded", "edited", audition.values, "mic"]]);
    const plain = cardsIn(u.cards({}));
    assert.deepEqual([findIn(plain[0], node => node.type === "audition-button").props.values, findIn(plain[0], node => node.type === "audition-button").props.input], [undefined, undefined]);
});

// The registration form's parts, as drawn.
const fieldsOf = (tree: unknown) => ofType(tree, "input").map(input => input.props);
const groupOf = (tree: unknown) => findIn(tree, node => node.type === "div" && node.props.role === "group");

test("the registration form names its use, says whose files they are, and takes a name and each file of the use", async context => {
    const u = await userModels(context, []);
    const tree = u.form();
    assert.deepEqual([tree.type, tree.props["data-user-model-register"], tree.props.summary, tree.props.hint], ["fold", true, "user_models.register_title", undefined]);
    assert.equal(groupOf(tree).props["aria-label"], `user_models.register_label {"group":"model_catalog.group.rvc"}`);
    assert.deepEqual(ofType(groupOf(tree), "p").map(textOf), ["user_models.register_help", "user_models.terms_help"]);
    const labels = ofType(tree, "label").map(label => [label.props.children].flat()[0]);
    assert.deepEqual(labels, ["user_models.name", `user_models.file_field.model {"kind":".pth"}`, `user_models.file_field.index {"kind":".index"}`]);
    assert.deepEqual(fieldsOf(tree).map(field => [field.type, field.value, field.maxLength, field.disabled, field.spellCheck, field.placeholder]), [
        ["text", "", modelCatalog.USER_MODEL_NAME_LIMIT, false, false, "user_models.name_placeholder"],
        ["text", "", 4096, false, false, undefined], ["text", "", 4096, false, false, undefined]]);
    const drop = findIn(tree, node => node.type === "drop-zone").props;
    assert.deepEqual([drop.accept, drop.disabled, drop.hint], [[".pth", ".index"], false, "user_models.drop_hint"]);
    const register = buttonNamed(tree, "user_models.register");
    assert.deepEqual([register.props.type, register.props.disabled], ["button", false]);
    const row = findIn(tree, node => node.type === "div" && find(node, inner => inner.type === "button" && textOf(inner) === "user_models.register") !== null
        && [node.props.children].flat().length === 1);
    assert.equal(classesOf(row).length, 2, "the button's row in the control column");
    // While a download runs, nothing can be typed or registered.
    const busy = u.form({ busy: true });
    assert.deepEqual([...fieldsOf(busy).map(field => field.disabled), findIn(busy, node => node.type === "drop-zone").props.disabled,
        buttonNamed(busy, "user_models.register").props.disabled], [true, true, true, true, true]);
    // A use that takes no files of one's own has no file fields.
    assert.deepEqual(fieldsOf(u.form({ target: "translation" })).length, 1);
    // A speech model takes one file.
    assert.deepEqual(findIn(u.form({ target: "japanese" }), node => node.type === "drop-zone").props.accept, [".gguf"]);
});

test("on a page that keeps descriptions out of sight, what registering does is the fold's hint", async context => {
    const u = await userModels(context, [], { hints: true });
    const tree = u.form();
    assert.equal(tree.props.hint, "user_models.register_help");
    assert.deepEqual(ofType(groupOf(tree), "p").map(textOf), ["user_models.terms_help"]);
});

test("dropped files fill the fields of their kind, keep what the others hold, and a file of another kind is left out", async context => {
    const u = await userModels(context, []);
    findIn(u.form(), node => node.type === "drop-zone").props.onFiles(["/x/voice.pth", "/x/readme.txt"]);
    assert.deepEqual(fieldsOf(u.form()).map(field => field.value), ["", "/x/voice.pth", ""]);
    findIn(u.form(), node => node.type === "drop-zone").props.onFiles(["/x/voice.INDEX"]);
    assert.deepEqual(fieldsOf(u.form()).map(field => field.value), ["", "/x/voice.pth", "/x/voice.INDEX"]);
    findIn(u.form(), node => node.type === "drop-zone").props.onFiles(["/x/notes.md"]);
    assert.deepEqual(fieldsOf(u.form()).map(field => field.value), ["", "/x/voice.pth", "/x/voice.INDEX"]);
    fieldsOf(u.form())[1].onChange({ target: { value: "/typed.pth" } });
    fieldsOf(u.form())[0].onChange({ target: { value: "Mine" } });
    assert.deepEqual(fieldsOf(u.form()).map(field => field.value), ["Mine", "/typed.pth", "/x/voice.INDEX"]);
});

test("a registration with a problem says which, under the button, with the file kind it needs; the fields point to it", async context => {
    const u = await userModels(context, []);
    const problem = () => {
        const tree = u.form();
        const line = find(tree, node => node.type === "p" && node.props.role === "alert");
        return line && [textOf(line), fieldsOf(tree).slice(1).every(field => field["aria-describedby"] === line.props.id), line.props.id];
    };
    buttonNamed(u.form(), "user_models.register").props.onClick();
    const [words, pointed, id] = problem() ?? [];
    assert.deepEqual([words, pointed], [`user_models.problem.name_missing {"kind":""}`, true]);
    assert.match(String(id), /-problem$/);
    fieldsOf(u.form())[0].onChange({ target: { value: "Mine" } });
    fieldsOf(u.form())[1].onChange({ target: { value: "/voice.onnx" } });
    buttonNamed(u.form(), "user_models.register").props.onClick();
    assert.deepEqual(problem()?.slice(0, 2), [`user_models.problem.model_kind {"kind":".pth"}`, true]);
    fieldsOf(u.form())[1].onChange({ target: { value: "/voice.pth" } });
    fieldsOf(u.form())[2].onChange({ target: { value: "/voice.txt" } });
    buttonNamed(u.form(), "user_models.register").props.onClick();
    assert.deepEqual(problem()?.slice(0, 2), [`user_models.problem.index_kind {"kind":".index"}`, true]);
    fieldsOf(u.form())[2].onChange({ target: { value: "" } });
    buttonNamed(u.form(), "user_models.register").props.onClick();
    assert.equal(problem(), null, "sent: no problem");
    assert.deepEqual(fieldsOf(u.form()).map(field => field["aria-describedby"]), [undefined, undefined, undefined]);
    assert.deepEqual(u.sent, [["/run/register_user_model", { target: "rvc", name: "Mine", paths: { model: "/voice.pth" } }]]);
});

test("Enter in a field registers as a form would, except while a download runs; Enter elsewhere and other keys do nothing", async context => {
    const u = await userModels(context, []);
    fieldsOf(u.form())[0].onChange({ target: { value: "Mine" } });
    fieldsOf(u.form())[1].onChange({ target: { value: "/voice.pth" } });
    let prevented = 0;
    const key = (name: string, target: object, busy = false) => groupOf(u.form({ busy })).props.onKeyDown({ key: name, target, preventDefault: () => { prevented++; } });
    key("Enter", { tagName: "BUTTON" });
    key("Tab", { tagName: "INPUT" });
    key("Enter", {});
    key("Enter", { tagName: 1 });
    assert.deepEqual([u.sent.length, prevented], [0, 0]);
    key("Enter", { tagName: "INPUT" }, true);
    assert.deepEqual([u.sent.length, prevented], [0, 1], "kept from submitting the settings form, but not sent while busy");
    key("Enter", { tagName: "INPUT" });
    assert.deepEqual([u.sent.length, prevented], [1, 2]);
    assert.deepEqual(u.sent[0], ["/run/register_user_model", { target: "rvc", name: "Mine", paths: { model: "/voice.pth" } }]);
});

test("the form clears once the list holds a new model of the name sent, for this use, and only once", async context => {
    const u = await userModels(context, [own("old", { name: "Mine" }), own("speech", { name: "Next", target: "japanese" })]);
    const values = () => fieldsOf(u.form()).map(field => field.value);
    fieldsOf(u.form())[0].onChange({ target: { value: "Mine" } });
    fieldsOf(u.form())[1].onChange({ target: { value: "/voice.pth" } });
    buttonNamed(u.form(), "user_models.register").props.onClick();
    // The model that already had the name is not the one just registered, nor is a new one of another name.
    assert.deepEqual(values(), ["Mine", "/voice.pth", ""]);
    u.state.userModels = { models: [own("old", { name: "Mine" }), own("speech", { name: "Next", target: "japanese" }), own("other", { name: "Other" })] };
    assert.deepEqual(values(), ["Mine", "/voice.pth", ""]);
    // A problem on a second try stays until the registration arrives, which clears it with the fields.
    fieldsOf(u.form())[0].onChange({ target: { value: "" } });
    buttonNamed(u.form(), "user_models.register").props.onClick();
    assert.ok(find(u.form(), node => node.props?.role === "alert"));
    u.state.userModels = { models: [own("old", { name: "Mine" }), own("speech", { name: "Next", target: "japanese" }), own("new", { name: "Mine" })] };
    u.form();
    assert.deepEqual(values(), ["", "", ""]);
    assert.equal(find(u.form(), node => node.props?.role === "alert"), null);
    // What is typed next stays, also when the list loses and gets back that model.
    fieldsOf(u.form())[0].onChange({ target: { value: "Next" } });
    u.state.userModels = { models: [own("old", { name: "Mine" })] };
    u.form();
    u.state.userModels = { models: [own("old", { name: "Mine" }), own("new", { name: "Mine" })] };
    u.form();
    assert.deepEqual(values(), ["Next", "", ""]);
    // A model of the name for another use is not this registration.
    fieldsOf(u.form())[1].onChange({ target: { value: "/next.pth" } });
    buttonNamed(u.form(), "user_models.register").props.onClick();
    u.state.userModels = { models: [own("old", { name: "Mine" }), own("speech", { name: "Next", target: "japanese" })] };
    u.form();
    assert.deepEqual(values(), ["Next", "/next.pth", ""]);
});

test("a registration sent before the list arrives waits for it without failing", async context => {
    const u = await userModels(context, null);
    fieldsOf(u.form())[0].onChange({ target: { value: "Mine" } });
    fieldsOf(u.form())[1].onChange({ target: { value: "/voice.pth" } });
    buttonNamed(u.form(), "user_models.register").props.onClick();
    assert.deepEqual(fieldsOf(u.form()).map(field => field.value), ["Mine", "/voice.pth", ""]);
    u.state.userModels = { models: [own("new", { name: "Mine" })] };
    u.form();
    assert.deepEqual(fieldsOf(u.form()).map(field => field.value), ["", "", ""]);
});
