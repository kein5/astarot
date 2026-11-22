import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { findIn, hooks, loadModule, nodesIn } from "../../../../../../../logics/test/hookHarness.ts";

// The app's one fold: a native <details> in two sizes. Its summary says what it holds; the words
// and the chevron of what pressing does are for the eye, and the details element says whether it
// is open. Every fold of the app is drawn with it.
async function fold() {
    const runtime = hooks();
    const { Fold } = await loadModule<typeof import("./Fold.tsx")>(new URL("./Fold.tsx", import.meta.url), runtime, { "../hint/Hint": { Hint: "hint" } });
    return (props: Parameters<typeof Fold>[0]) => runtime.render(Fold, props);
}

test("a bar says what it holds, then Open or Close with a chevron, hidden from assistive technology", async () => {
    const draw = await fold();
    const toggled: boolean[] = [];
    const tree = draw({ summary: "Models and servers", open: true, "data-setup": true, onToggle: () => toggled.push(true),
        summaryProps: { "aria-describedby": "help", "data-hint-row": true }, children: "inside" });
    assert.equal(tree.type, "details");
    assert.deepEqual([tree.props.open, tree.props["data-setup"], tree.props.className], [true, true, "fold bar"]);
    tree.props.onToggle();
    assert.deepEqual(toggled, [true]);
    const [summary, body] = tree.props.children;
    assert.equal(summary.type, "summary");
    assert.deepEqual([summary.props["aria-describedby"], summary.props["data-hint-row"]], ["help", true]);
    assert.equal(findIn(summary, node => node.props.className === "summaryText").props.children, "Models and servers");
    const toggle = findIn(summary, node => node.props.className === "toggle");
    assert.equal(toggle.props["aria-hidden"], "true");
    assert.deepEqual(nodesIn(toggle).filter(node => typeof node.props.children === "string").map(node => node.props.children),
        ["config_page.common.fold_open", "config_page.common.fold_close"]);
    assert.ok(nodesIn(toggle).some(node => node.type === "svg"), "the chevron");
    assert.deepEqual([body.type, body.props.className, body.props.children], ["div", "body", "inside"]);
});

test("a link is the words it opens on with a chevron after them, no Open or Close", async () => {
    const draw = await fold();
    const tree = draw({ summary: "Details", size: "link", className: "more", children: "the rest" });
    assert.equal(tree.props.className, "fold link more");
    const [summary] = tree.props.children;
    assert.equal(summary.props.children[0], "Details");
    const toggle = findIn(summary, node => node.props.className === "toggle");
    assert.equal(nodesIn(toggle).filter(node => typeof node.props.children === "string").length, 0);
    assert.ok(nodesIn(toggle).some(node => node.type === "svg"));
});

// A fold whose purpose is a hint (#614): the mark sits beside the title, inside the summary's
// words, and the words are the summary's accessible description, as a setup section's title has it.
test("a fold with a hint carries it beside its title, as the summary's description", async () => {
    const draw = await fold();
    const tree = draw({ summary: "Register a model", hint: "What registering does", children: "form" });
    const [summary] = tree.props.children;
    assert.equal(summary.props["data-hint-row"], true);
    const host = findIn(summary, node => node.props["data-hint-host"] === true);
    const hint = findIn(host, node => node.type === "hint");
    assert.deepEqual([hint.props.text, hint.props.row], ["What registering does", true]);
    assert.equal(summary.props["aria-describedby"], hint.props.id);
    assert.equal(host.props.children[0], "Register a model", "the title comes first, the mark after it");
    // Without one, nothing is added.
    const plain = draw({ summary: "Register a model", children: "form" });
    assert.equal(plain.props.children[0].props["aria-describedby"], undefined);
    assert.ok(!nodesIn(plain).some(node => node.type === "hint"));
});

// No fold of the app's settings or catalogs is drawn without it: a bare <details> would bring back
// the browser's own triangle. The VR panel draws its windows' folds at its own scale.
test("every fold of the app is the app's one fold", () => {
    const box = new URL("../../", import.meta.url);
    const files = ["_components/setup_section/SetupSection.tsx", "_components/advanced_section/AdvancedSection.tsx",
        "_components/description/Description.tsx", "_components/telemetry/TelemetryContents.tsx", "translation/TranslationCatalog.tsx",
        "advanced_settings/UserModels.tsx", "advanced_settings/ModelDownloads.tsx", "transcription/VocabularyList.tsx",
        "_components/word_filter/WordFilter.tsx", "_components/message_format/MessageFormat.tsx"];
    for (const file of files) {
        const source = readFileSync(new URL(file, box), "utf8");
        assert.match(source, /<Fold[\s>]/, file);
        assert.doesNotMatch(source, /<details[\s>]/, file);
    }
});
