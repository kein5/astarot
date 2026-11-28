import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, find, findIn, nodesIn, componentName, draw, stubGlobals, kitStandIns } from "../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../logics/test/hookHarness.ts";
import * as fieldErrors from "../../../../../../logics/configs/fieldErrors.ts";

// The word filter's registered words and the sent message format's other examples fold as the
// rest of the settings do, with the app's one fold (#820): a bar for the list of words, the
// few-words size for the examples. Whether each is open stays in the app's state while it runs.

const t = (key: string, values?: object) => values ? `${key}:${JSON.stringify(values)}` : key;
const draftPath = "../../../../../../../logics/voice/useSettingsDraft";

async function wordFilter(context: Parameters<typeof stubGlobals>[0], words: string[], opened: boolean) {
    const runtime = hooks();
    context.onTestFinished(() => runtime.unmount());
    stubGlobals(context, { requestAnimationFrame: (fn: () => void) => fn() });
    const store = { opened, updates: [] as boolean[] };
    let draft: string[] | null = null;
    const state = { currentMicWordFilterList: { data: words }, setMicWordFilterList() {} };
    const { WordFilter } = await loadModule<typeof import("./word_filter/WordFilter.tsx")>(new URL("./word_filter/WordFilter.tsx", import.meta.url), runtime, { "../../../../../../../logics/configs/fieldErrors.ts": fieldErrors, "../field_problem/FieldProblem": { FieldProblem: "field-problem" },
        "@useI18n": { useI18n: () => ({ t }) },
        "@logics_configs": { useTranscription: () => state },
        "@store": { useStore_IsOpenedMicWordFilterList: () => ({ currentIsOpenedMicWordFilterList: { data: store.opened },
            updateIsOpenedMicWordFilterList: (open: boolean) => { store.opened = open; store.updates.push(open); } }) },
        [draftPath]: { useSettingsDraft: () => ({ draft, setDraft: (next: string[]) => { draft = next; }, change: (next: string[]) => { draft = next; }, navigationDialog: null }) },
        "../_atoms/_entry/_Entry": { _Entry: "entry" },
        "../fold/Fold": { Fold: "fold" },
    });
    const render = () => runtime.render(WordFilter, { "aria-labelledby": "label", "aria-describedby": "help" });
    return { render, store };
}

const words = (tree: TreeNode) => nodesIn(tree).filter(node => node.props?.deleteAction).map(node => node.props.value);

test("the registered words are a bar of the app's fold that says how many, open as the app keeps it", async context => {
    const s = await wordFilter(context, ["alpha", "日本語", "gamma"], false);
    let tree = s.render();
    assert.deepEqual([tree.props.role, tree.props["aria-labelledby"]], ["group", "label"]);
    let fold = findIn(tree, node => node.type === "fold");
    assert.deepEqual([fold.props.size, fold.props.open], [undefined, false], "a bar, closed");
    assert.equal(fold.props.summary, "config_page.transcription.mic_word_filter.list:{\"count\":3}");
    assert.equal(fold.props.summaryProps["aria-describedby"], "help");
    assert.deepEqual(words(fold), [], "closed, the words are not drawn");
    // Opening it keeps it open in the app's state; the words are drawn inside it.
    fold.props.onToggle({ currentTarget: { open: true } });
    assert.deepEqual(s.store.updates, [true]);
    tree = s.render();
    fold = findIn(tree, node => node.type === "fold");
    assert.equal(fold.props.open, true);
    assert.deepEqual(words(fold), ["alpha", "日本語", "gamma"]);
    // The toggle the browser fires when the state opened it changes nothing more.
    fold.props.onToggle({ currentTarget: { open: true } });
    assert.deepEqual(s.store.updates, [true]);
    // The entry stays outside the fold, so a word is added with the list closed.
    assert.ok(find(tree, node => node.type === "entry"));
    assert.equal(find(fold, node => node.type === "entry"), null);
});

test("with no word the bar says 0 and, opened, that there is none; adding words opens the list", async context => {
    const s = await wordFilter(context, [], false);
    let fold = findIn(s.render(), node => node.type === "fold");
    assert.equal(fold.props.summary, "config_page.transcription.mic_word_filter.list:{\"count\":0}");
    assert.equal(find(fold, node => node.type === "p"), null, "closed, nothing is drawn inside");
    fold.props.onToggle({ currentTarget: { open: true } });
    fold = findIn(s.render(), node => node.type === "fold");
    assert.equal(fold.props.open, true);
    assert.equal(findIn(fold, node => node.type === "p").props.children, "config_page.transcription.mic_word_filter.list_empty");
    assert.deepEqual(words(fold), []);
    // Closed again, words added open it.
    fold.props.onToggle({ currentTarget: { open: false } });
    const tree = s.render();
    const entry = findIn(tree, node => node.type === "entry");
    assert.equal(entry.props["aria-label"], "config_page.transcription.mic_word_filter.label");
    entry.props.onChange({ target: { value: "alpha, beta" } });
    // Add, the kit's primary Button, beside the entry.
    const add = findIn(s.render(), node => node.type === kitStandIns.Button);
    assert.deepEqual([add.props.tone, add.props.children], ["primary", "config_page.transcription.mic_word_filter.add_button_label"]);
    add.props.onClick();
    assert.deepEqual(s.store.updates, [true, false, true]);
});

const defaults = { message: { prefix: "", suffix: "" }, separator: "\n", translation: { prefix: "", suffix: "", separator: "\n" }, translation_first: false };

async function messageFormat(format_id: "send" | "received", shown: "Simplified" | "All", data = defaults) {
    const runtime = hooks();
    const views = { data: { send: shown, received: "Simplified" } }, updates: unknown[] = [], drafts: (typeof defaults)[] = [];
    const { MessageFormat } = await loadModule<typeof import("./message_format/MessageFormat.tsx")>(new URL("./message_format/MessageFormat.tsx", import.meta.url), runtime, { "../../../../../../../logics/configs/fieldErrors.ts": fieldErrors, "../field_problem/FieldProblem": { FieldProblem: "field-problem" },
        "react-i18next": { useTranslation: () => ({ t }) },
        "@store": { useStore_IsBreakPoint: () => ({ currentIsBreakPoint: { data: false } }),
            useStore_MessageFormat_ExampleViewFilter: () => ({ currentMessageFormat_ExampleViewFilter: views,
                updateMessageFormat_ExampleViewFilter: (next: typeof views.data) => { updates.push(next); views.data = next; } }) },
        "@logics_configs": { useAppearance: () => ({ currentUiLanguage: { data: "ja" } }) },
        "@ui_configs": { ui_configs: { send_message_format_parts: defaults, received_message_format_parts: defaults } },
        "@common_components": { ResetButton: "reset" },
        [draftPath]: { useSettingsDraft: () => ({ draft: null, setDraft: (value: typeof defaults) => drafts.push(value), change: (value: typeof defaults) => drafts.push(value), submit() {}, commit() {}, navigationDialog: null }) },
        "../_atoms/_entry/_Entry": { _Entry: "entry" },
        "../fold/Fold": { Fold: "fold" },
    });
    const props = { variable: { state: "ok", data }, setFunction: async () => true, format_id, label: "Format" };
    // ExampleComponent and InputComponent are private to MessageFormat: drawn with the props its parent gives them.
    const examples = () => draw(findIn(runtime.render(MessageFormat, props), node => componentName(node) === "ExampleComponent"));
    const input = () => draw(findIn(runtime.render(MessageFormat, props), node => componentName(node) === "InputComponent"));
    return { examples, input, updates, drafts };
}

const boxes = (tree: TreeNode) => nodesIn(tree).filter(node => node.props?.className === "example_label").map(node => node.props.children);
const example = (id: string) => `config_page.others.message_format_common.example_view.${id}`;

test("the sent format shows two examples and the other three in a fold of the few-words size", async () => {
    const s = await messageFormat("send", "Simplified");
    const tree = s.examples();
    const fold = findIn(tree, node => node.type === "fold");
    assert.deepEqual([fold.props.size, fold.props.open], ["link", false]);
    assert.equal(fold.props.summary, `${example("more")}:{"count":3}`);
    assert.deepEqual(boxes(fold), [example("translated_only_multi"), example("translated_only"), example("original_only")]);
    assert.deepEqual(boxes(tree).slice(0, 2), [example("original_translated"), example("original_translated_multi")]);
    // Opening it keeps it open in the app's state; the toggle the browser fires when the state
    // opened it changes nothing more.
    fold.props.onToggle({ currentTarget: { open: true } });
    assert.deepEqual(s.updates, [{ send: "All", received: "Simplified" }]);
    findIn(s.examples(), node => node.type === "fold").props.onToggle({ currentTarget: { open: true } });
    assert.equal(s.updates.length, 1);
    assert.equal(findIn(s.examples(), node => node.type === "fold").props.open, true);
});

test("the received format shows its three examples without a fold", async () => {
    const s = await messageFormat("received", "Simplified");
    const tree = s.examples();
    assert.equal(find(tree, node => node.type === "fold"), null);
    assert.deepEqual(boxes(tree), [example("original_translated"), example("original_only"), example("translated_only")]);
});

// The swap of the original and the translation is the kit's plain Button. Its words name both
// parts in their order, and the pointer, Enter and Space swap them; Enter and Space hold back the
// button's own press, so a key swaps once.
test("the message format's swap names both parts in their order and swaps by pointer, Enter and Space", async () => {
    const settings = (id: string) => `config_page.others.message_format_common.settings.${id}`;
    for (const first of [false, true]) {
        const s = await messageFormat("send", "Simplified", { ...defaults, translation_first: first });
        const swap = findIn(s.input(), node => node.type === kitStandIns.Button && node.props.className === "swap_button");
        assert.equal(swap.props.tone, undefined);
        const words = nodesIn(swap).filter(node => node.type === "span").map(node => node.props.children);
        assert.deepEqual(words, first ? [settings("translated"), settings("original")] : [settings("original"), settings("translated")]);
        const held: string[] = [];
        for (const key of ["Enter", " ", "Tab"]) swap.props.onKeyDown({ key, preventDefault: () => held.push(key) });
        swap.props.onClick();
        assert.deepEqual(held, ["Enter", " "]);
        assert.deepEqual(s.drafts.map(draft => draft.translation_first), [!first, !first, !first]);
    }
});
