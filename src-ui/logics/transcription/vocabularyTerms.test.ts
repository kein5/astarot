import assert from "node:assert/strict";
import { test } from "vitest";
import { MAX_USER_TERMS, addTerm, builtinRows, changeOwnReadings, changeReadings, deleteOwn, dictionaryRows, importVocabulary, ownTerms,
    parseTerm, readingsText, restoreAllBuiltin, restoreBuiltin, takeOut, writtenKey } from "./vocabularyTerms.ts";

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

// The whole dictionary, one list: the user's own terms first, as the core uses them, then the
// built-in terms with the user's changes. Terms are added from the list.
test("the list holds the user's own terms, then the built-in ones while they are on", () => {
    const vocabulary = { builtin: true, terms: ["猫丸=ねこまる", "Quest=くえすと"], removed: ["ワールド"] };
    assert.deepEqual(dictionaryRows(BUILTIN, vocabulary).map(row => [row.written, row.state, row.term]), [
        ["猫丸", "own", "猫丸=ねこまる"],
        ["VRChat", "builtin", BUILTIN[0]],
        ["ワールド", "removed", BUILTIN[1]],
        ["Friends+", "builtin", BUILTIN[2]],
        ["Quest", "changed", BUILTIN[3]],
    ]);
    // Built-in terms off, or their list not here yet: only the user's terms, a change of a built-in
    // one among them.
    assert.deepEqual(dictionaryRows(BUILTIN, { ...vocabulary, builtin: false }).map(row => [row.written, row.state]), [["猫丸", "own"], ["Quest", "own"]]);
    assert.deepEqual(dictionaryRows(null, vocabulary).map(row => row.written), ["猫丸", "Quest"]);
});

test("a term added from the list is the user's own, or changes the built-in term of its written form", () => {
    const start = { builtin: true, terms: ["猫丸"] };
    assert.deepEqual(addTerm(start, BUILTIN, "  Midnight   Rooftop ", "みっどないと、るーふとっぷ"),
        { ok: true, kind: "added", vocabulary: { builtin: true, terms: ["猫丸", "Midnight Rooftop=みっどないと,るーふとっぷ"] } });
    assert.deepEqual(addTerm(start, BUILTIN, "黒猫", ""), { ok: true, kind: "added", vocabulary: { builtin: true, terms: ["猫丸", "黒猫"] } });
    // The written form of a built-in term: its readings change, and a term taken out is put back.
    assert.deepEqual(addTerm(start, BUILTIN, "quest", "くえすと"),
        { ok: true, kind: "builtin", vocabulary: { builtin: true, terms: ["猫丸", "Quest=くえすと"] } });
    assert.deepEqual(addTerm({ ...start, removed: ["Quest"] }, BUILTIN, "Quest", "クエスト"),
        { ok: true, kind: "builtin", vocabulary: { builtin: true, terms: ["猫丸"] } });
    // With the built-in terms off, the same written form is a term of the user's.
    assert.deepEqual(addTerm({ ...start, builtin: false }, BUILTIN, "Quest", "くえすと"),
        { ok: true, kind: "added", vocabulary: { builtin: false, terms: ["猫丸", "Quest=くえすと"] } });
    // Nothing new, or what the rules of a term refuse, or no room.
    assert.deepEqual(addTerm(start, BUILTIN, "猫丸", "ねこ"), { ok: false, reason: "duplicate" });
    assert.deepEqual(addTerm(start, BUILTIN, "Quest", "クエスト"), { ok: false, reason: "duplicate" });
    for (const [written, readings] of [["a=b", ""], ["a,b", ""], ["x".repeat(49), ""], ["猫", "ね=こ"], ["", "ねこ"]]) {
        assert.deepEqual(addTerm(start, BUILTIN, written, readings), { ok: false, reason: "invalid" }, `${written}|${readings}`);
    }
    const full = { terms: Array.from({ length: MAX_USER_TERMS }, (_, index) => `t${index}`) };
    assert.deepEqual(addTerm(full, BUILTIN, "黒猫", ""), { ok: false, reason: "full" });
});

test("the user's own terms have their readings changed in their place, or are deleted", () => {
    const start = { builtin: true, terms: ["猫丸=ねこまる", "黒猫"], removed: ["Quest"] };
    const changed = changeOwnReadings(start, "黒猫", "くろねこ、くろ");
    assert.deepEqual(changed, { ok: true, vocabulary: { ...start, terms: ["猫丸=ねこまる", "黒猫=くろねこ,くろ"] } });
    assert.deepEqual(changeOwnReadings(start, "黒猫", "く=ろ"), { ok: false, reason: "invalid" });
    assert.deepEqual(deleteOwn(start, "猫丸=ねこまる"), { ...start, terms: ["黒猫"] }, "what is taken out stays");
});

// #792: a dictionary file read back into the dictionary: terms added or their readings changed, the
// built-in terms it takes out taken out, and nothing of the dictionary dropped.
test("a dictionary file adds its terms, changes the readings of those already there and takes out what it names", () => {
    const start = { builtin: true, terms: ["猫丸=ねこまる", "黒猫"], removed: ["Vket"] };
    const file = "# ASTAROT term dictionary\n\n 猫丸 = ねこ \r\nMidnight Rooftop=みっどないと\nVRChat=ブイアールチャット,ブイチャ\n"
        + "Friends+=ふれぷら\n-Quest\n-vket\n-Midnight Rooftop\n-a=b\nx,y\n";
    const read = importVocabulary(start, BUILTIN, file);
    assert.deepEqual(read.vocabulary, { builtin: true, terms: ["猫丸=ねこ", "黒猫", "Midnight Rooftop=みっどないと", "Friends+=ふれぷら"],
        removed: ["Vket", "Quest"] });
    // The built-in VRChat as it ships adds nothing, and Friends+ with other readings changes the
    // built-in term's readings. Vket was taken out already; Midnight Rooftop is not a built-in term
    // to take out.
    assert.deepEqual([read.added, read.changed, read.removed, read.invalid, read.over, read.notBuiltin], [1, 2, 1, 2, 0, 1]);
    // What the file says already, read again, changes nothing.
    const again = importVocabulary(read.vocabulary, BUILTIN, file);
    assert.deepEqual(again.vocabulary, read.vocabulary);
    assert.deepEqual([again.added, again.changed, again.removed], [0, 0, 0]);
    // A full dictionary leaves the new terms out and counts them.
    const full = { terms: Array.from({ length: MAX_USER_TERMS }, (_, index) => `t${index}`) };
    const over = importVocabulary(full, BUILTIN, "黒猫\nt1=てぃー\n");
    assert.deepEqual([over.added, over.changed, over.over], [0, 1, 1]);
});
