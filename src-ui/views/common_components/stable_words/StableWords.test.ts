import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { hooks, loadModule } from "../../../logics/test/hookHarness.ts";

const STYLES = { "./StableWords.css.ts": { stack: "stack", wordAt: { center: "center", start: "start" } } };

// #912: words that change with a state keep the longest one's space.
test("every word lies in the one cell; only the current one is seen and read", async () => {
    const runtime = hooks();
    const { StableWords } = await loadModule<typeof import("./StableWords.tsx")>(new URL("./StableWords.tsx", import.meta.url), runtime, STYLES);
    const tree = runtime.render(StableWords, { words: ["Check", "Checking…", "Connected"], current: "Checking…" });
    assert.equal(tree.props.className, "stack");
    const words = [tree.props.children].flat();
    assert.deepEqual(words.map(word => [word.props.children, word.props["aria-hidden"], word.props.className]),
        [["Check", true, "center"], ["Checking…", undefined, "center"], ["Connected", true, "center"]]);
    // A current word not among them still takes part in the width.
    const added = [runtime.render(StableWords, { words: ["Send"], current: "Stop" }).props.children].flat();
    assert.deepEqual(added.map(word => [word.props.children, word.props["aria-hidden"]]), [["Send", true], ["Stop", undefined]]);
    // A readout's sentences start where the longest one starts.
    const sentences = [runtime.render(StableWords, { words: ["Checking.", "Not connected. Start it."], current: "Checking.", align: "start" }).props.children].flat();
    assert.deepEqual(sentences.map(word => word.props.className), ["start", "start"]);
    runtime.unmount();
});

test("the cell is a grid of one area, a shorter word sits in its middle or at its start, and a word not in use keeps its space hidden", () => {
    const css = readFileSync(new URL("./StableWords.css.ts", import.meta.url), "utf8");
    assert.match(css, /stack = style\(\{ display: "inline-grid" \}\)/);
    assert.match(css, /gridArea: "1 \/ 1",/);
    assert.match(css, /'&\[aria-hidden="true"\]': \{ visibility: "hidden" \}/);
    assert.match(css, /center: \[word, \{ justifySelf: "center" \}\], start: \[word, \{ justifySelf: "start" \}\]/);
});
