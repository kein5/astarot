import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { hooks, loadModule } from "../../../logics/test/hookHarness.ts";

// #912: words that change with a state keep the longest one's space.
test("every word lies in the one cell; only the current one is seen and read", async () => {
    const runtime = hooks();
    const { StableWords } = await loadModule<typeof import("./StableWords.tsx")>(new URL("./StableWords.tsx", import.meta.url), runtime);
    const tree = runtime.render(StableWords, { words: ["Check", "Checking…", "Connected"], current: "Checking…" });
    assert.equal(tree.props.className, "stack");
    const words = [tree.props.children].flat();
    assert.deepEqual(words.map(word => [word.props.children, word.props["aria-hidden"]]),
        [["Check", true], ["Checking…", undefined], ["Connected", true]]);
    // A current word not among them still takes part in the width.
    const added = [runtime.render(StableWords, { words: ["Send"], current: "Stop" }).props.children].flat();
    assert.deepEqual(added.map(word => [word.props.children, word.props["aria-hidden"]]), [["Send", true], ["Stop", undefined]]);
    runtime.unmount();
});

test("the cell is a grid of one area, a shorter word sits in its middle, and a word not in use keeps its width hidden", () => {
    const css = readFileSync(new URL("./StableWords.css.ts", import.meta.url), "utf8");
    assert.match(css, /stack = style\(\{ display: "inline-grid" \}\)/);
    assert.match(css, /gridArea: "1 \/ 1",\s*justifySelf: "center",/);
    assert.match(css, /'&\[aria-hidden="true"\]': \{ visibility: "hidden" \}/);
});
