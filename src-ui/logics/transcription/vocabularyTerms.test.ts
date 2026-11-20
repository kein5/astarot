import assert from "node:assert/strict";
import { test } from "vitest";
import { MAX_USER_TERMS, addTerms, parseTerm, termsText, writtenKey } from "./vocabularyTerms.ts";

test("an entry is made canonical as the core makes it, or refused", () => {
    assert.equal(parseTerm("  VRChat = ブイアールチャット , ブイチャ "), "VRChat=ブイアールチャット,ブイチャ");
    assert.equal(parseTerm("Midnight   Rooftop"), "Midnight Rooftop");
    assert.equal(parseTerm("猫丸="), "猫丸");
    for (const bad of ["", "=よみ", "a,b=よみ", "x".repeat(49), `x=${"y".repeat(33)}`, "x=a,,b", "x=a=b",
        `x=${Array(9).fill("y").join(",")}`, "a\tb"]) {
        assert.equal(parseTerm(bad), null, bad);
    }
    assert.equal(parseTerm("x".repeat(48)), "x".repeat(48));
    assert.equal(writtenKey("VRChat=ぶいちゃ"), "vrchat");
});

test("lines are added once each, up to the dictionary's limit, and the rest is counted", () => {
    const result = addTerms(["VRChat=ブイチャ"], "猫丸=ねこまる\n\nvrchat\r\nMidnight Rooftop\n猫丸\n=bad\n");
    assert.deepEqual(result, { terms: ["VRChat=ブイチャ", "猫丸=ねこまる", "Midnight Rooftop"], added: 2, duplicates: 2, invalid: 1, over: 0, rest: ["=bad"] });
    const full = Array.from({ length: MAX_USER_TERMS - 1 }, (_, index) => `t${index}`);
    const capped = addTerms(full, "a\nb\nc");
    assert.equal(capped.terms.length, MAX_USER_TERMS);
    assert.deepEqual([capped.added, capped.over, capped.rest], [1, 2, ["b", "c"]]);
});

test("the copied text is taken back as the same entries", () => {
    const terms = ["VRChat=ブイアールチャット,ブイチャ", "Midnight Rooftop"];
    assert.equal(termsText(terms), "VRChat=ブイアールチャット,ブイチャ\nMidnight Rooftop\n");
    assert.deepEqual(addTerms([], termsText(terms)).terms, terms);
    assert.equal(termsText([]), "");
});
