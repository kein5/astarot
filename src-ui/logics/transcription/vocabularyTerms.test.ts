import assert from "node:assert/strict";
import { test } from "vitest";
import { MAX_USER_TERMS, addTerms, builtinRows, changeReadings, ownTerms, parseTerm, readingsText, restoreAllBuiltin, restoreBuiltin,
    takeOut, termsText, writtenKey } from "./vocabularyTerms.ts";

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

// #792: the built-in terms as the app ships them, and the user's changes over them.
const BUILTIN = ["VRChat=ブイアールチャット,ブイチャ", "ワールド", "Friends+=フレンドプラス,フレプラ", "Quest=クエスト"];

test("each built-in term shows the readings in use and whether the user changed it or took it out", () => {
    const vocabulary = { builtin: true, terms: ["猫丸=ねこまる", "friends+=ふれぷら"], removed: ["quest"] };
    assert.deepEqual(builtinRows(BUILTIN, vocabulary).map(row => [row.written, row.readings, row.state]), [
        ["VRChat", ["ブイアールチャット", "ブイチャ"], "builtin"],
        ["ワールド", [], "builtin"],
        ["Friends+", ["ふれぷら"], "changed"],
        ["Quest", ["クエスト"], "removed"],
    ]);
    // A user's term of that written form wins over a take-out, as in the core.
    assert.equal(builtinRows(BUILTIN, { terms: ["Quest=くえすと"], removed: ["Quest"] })[3].state, "changed");
    // The user's own list leaves out the changes of built-in terms, unless the built-in terms are off.
    assert.deepEqual(ownTerms(BUILTIN, vocabulary), ["猫丸=ねこまる"]);
    assert.deepEqual(ownTerms(BUILTIN, { ...vocabulary, builtin: false }), vocabulary.terms);
    assert.deepEqual(ownTerms(null, vocabulary), vocabulary.terms, "before the built-in list arrives");
    assert.equal(readingsText(["フレンドプラス", "フレプラ"]), "フレンドプラス、フレプラ");
});

test("a built-in term's readings are changed by a term of the user's, and its own readings take the change away", () => {
    const start = { builtin: true, terms: ["猫丸"] };
    const changed = changeReadings(start, BUILTIN[2], " ふれんどぷらす、ふれぷら ");
    assert.deepEqual(changed, { ok: true, vocabulary: { builtin: true, terms: ["猫丸", "Friends+=ふれんどぷらす,ふれぷら"] } });
    assert.ok(changed.ok);
    // Changed again in its place, not added twice.
    const again = changeReadings(changed.vocabulary, BUILTIN[2], "ふれぷら");
    assert.ok(again.ok);
    assert.deepEqual(again.vocabulary.terms, ["猫丸", "Friends+=ふれぷら"]);
    // The readings it ships with are no change: the user's term goes.
    const back = changeReadings(again.vocabulary, BUILTIN[2], "フレンドプラス,フレプラ");
    assert.ok(back.ok);
    assert.deepEqual(back.vocabulary, { builtin: true, terms: ["猫丸"] });
    // No reading at all is a change too; what the rules of a term refuse is not.
    const none = changeReadings(start, BUILTIN[0], "");
    assert.ok(none.ok);
    assert.deepEqual(none.vocabulary.terms, ["猫丸", "VRChat"]);
    assert.deepEqual(changeReadings(start, BUILTIN[0], "a=b"), { ok: false, reason: "invalid" });
    assert.deepEqual(changeReadings(start, BUILTIN[0], Array(9).fill("よ").join(",")), { ok: false, reason: "invalid" });
    const full = { terms: Array.from({ length: MAX_USER_TERMS }, (_, index) => `t${index}`) };
    assert.deepEqual(changeReadings(full, BUILTIN[0], "ぶいちゃ"), { ok: false, reason: "full" });
});

test("a built-in term is taken out, put back, and all of them restored, the user's own terms kept", () => {
    const start = { builtin: true, terms: ["猫丸", "Quest=くえすと"] };
    const out = takeOut(start, BUILTIN[3]);
    assert.deepEqual(out, { builtin: true, terms: ["猫丸"], removed: ["Quest"] }, "its change goes with it");
    const both = takeOut(out, BUILTIN[1]);
    assert.deepEqual(both.removed, ["Quest", "ワールド"]);
    // Nothing taken out leaves the member out, as the core saves it.
    assert.deepEqual(restoreBuiltin(takeOut(start, BUILTIN[3]), BUILTIN[3]), { builtin: true, terms: ["猫丸"] });
    const changed = changeReadings(both, BUILTIN[2], "ふれぷら");
    assert.ok(changed.ok);
    assert.deepEqual(restoreAllBuiltin(changed.vocabulary, BUILTIN), { builtin: true, terms: ["猫丸"] });
    // Changing the readings of a term taken out puts it back.
    const readings = changeReadings(out, BUILTIN[3], "くえすと");
    assert.ok(readings.ok);
    assert.deepEqual(readings.vocabulary, { builtin: true, terms: ["猫丸", "Quest=くえすと"] });
});
