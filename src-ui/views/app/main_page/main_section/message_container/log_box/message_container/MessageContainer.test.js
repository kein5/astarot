import assert from "node:assert/strict";
import { test } from "vitest";
import { readFile } from "node:fs/promises";
import { hooks, loadModule, find } from "../../../../../../../logics/test/hookHarness.ts";
import { applyRealtimeCaption } from "../../../../../../../logics/transcription/realtimeCaptionState.ts";
import { encodeLogUpdate, decodeLogUpdate } from "../../../../../../../logics/common/vrPanelWire.ts";
import * as speakerNamesLogic from "../../../../../../../logics/common/speakerNames.ts";

// The row with the speakers' part it draws (#447): SpeakerNames.tsx as it is. `t` answers the
// key alone unless a test words it.
const load = async (runtime, store, t = key => key) => {
    const i18n = { "@useI18n": { useI18n: () => ({ t }) } };
    const speakerNames = await loadModule(new URL("./SpeakerNames.tsx", import.meta.url), runtime, {
        "../../../../../../../logics/common/speakerNames.ts": speakerNamesLogic, ...i18n,
    });
    const row = await loadModule(new URL("./MessageContainer.tsx", import.meta.url), runtime, {
        "@store": { store }, "./message_sub_menu_container/MessageSubMenuContainer": {}, "./SpeakerNames.tsx": speakerNames, ...i18n,
    });
    return { ...row, speakerNames };
};

// The Japanese words of the speakers' part, enough to read the rows.
const japanese = (key, options = {}) => ({
    "main_page.message_log.speakers": `話者${options.speakers}`,
    "main_page.message_log.speakers_separator": "・",
    "main_page.message_log.speaker_label": `話者${options.label}`,
    "main_page.message_log.speaker_names_edit": `${options.speakers}に名前を付ける`,
}[key] ?? key);

const heard = (extra = {}) => ({ id: "heard", category: "received", status: "ok", created_at: "12:00", source: "realtime_speaker",
    realtime: { source: "speaker", namespace: "session", generation: 4, item_id: "one", revision: 3, state: "translated" },
    speakers: ["A", "B"], messages: { original: { message: "やあ", transliteration: [] }, translations: [] }, ...extra });

test("the voices are written with the names given, and the main window names them from the row", async () => {
    const runtime = hooks(), store = { is_vr_panel: false };
    const { MessageContainer, speakerNames } = await load(runtime, store, japanese);
    const named = [];
    const nameSpeakers = (namespace, names) => named.push([namespace, names]);
    const who = tree => find(tree, node => node.type === "button");
    // Without names the label stays as before.
    assert.equal(who(runtime.render(MessageContainer.type, heard({ nameSpeakers }))).props.children, "話者A・B");
    const row = heard({ speaker_names: { A: "ミカ" }, nameSpeakers });
    let tree = runtime.render(MessageContainer.type, row);
    assert.equal(who(tree).props.children, "ミカ・話者B");
    assert.equal(who(tree).props["aria-label"], "ミカ・話者Bに名前を付ける");
    assert.equal(who(tree).props["aria-expanded"], false);
    assert.equal(find(tree, node => node.type === speakerNames.SpeakerNamesEditor), null);
    who(tree).props.onClick();
    tree = runtime.render(MessageContainer.type, row);
    const editor = find(tree, node => node.type === speakerNames.SpeakerNamesEditor);
    assert.deepEqual(editor.props.labels, ["A", "B"]);
    assert.deepEqual(editor.props.names, { A: "ミカ" });
    editor.props.onSave({ A: "ミカ", B: "ユウ" });
    assert.deepEqual(named, [["session", { A: "ミカ", B: "ユウ" }]]);
    // The VR panel and a window that cannot name them show the words only.
    for (const [isVr, props] of [[true, row], [false, heard({ speaker_names: { A: "ミカ" } })]]) {
        store.is_vr_panel = isVr;
        tree = runtime.render(MessageContainer.type, props);
        assert.equal(who(tree), null);
        assert.ok(find(tree, node => node.type === "p" && node.props.children === "ミカ・話者B"));
    }
});

test("a row that goes on with the same voices shows its time and keeps who spoke for screen readers", async () => {
    const runtime = hooks(), store = { is_vr_panel: false };
    const { MessageContainer } = await load(runtime, store, japanese);
    const tree = runtime.render(MessageContainer.type, heard({ continues: true, nameSpeakers() {} }));
    assert.ok(find(tree, node => node.props?.children === "12:00"));
    assert.equal(find(tree, node => node.props?.children === "main_page.message_log.received"), null);
    assert.equal(find(tree, node => node.type === "button"), null);
    assert.equal(find(tree, node => node.type === "span" && node.props.children === "話者A・B").props.className, "hidden");
    assert.match(find(tree, node => typeof node.props?.className === "string" && node.props.className.includes("message_wrapper")).props.className, /continues/);
});

test("the naming form keeps each name within what the core takes and closes on Escape", async () => {
    const runtime = hooks();
    const { speakerNames } = await load(runtime, { is_vr_panel: false });
    const saved = [], closed = [];
    const props = { labels: ["A", "B"], names: { A: "ミカ" }, onSave: names => saved.push(names), onClose: () => closed.push(true) };
    let form = runtime.render(speakerNames.SpeakerNamesEditor, props);
    const inputs = () => {
        const found = [];
        find(form, node => { if (node.type === "input") found.push(node); return false; });
        return found;
    };
    assert.deepEqual(inputs().map(input => input.props.value), ["ミカ", ""]);
    assert.equal(inputs()[0].props.maxLength, 32);
    inputs()[1].props.onChange({ target: { value: "  ユウ   さん " } });
    form = runtime.render(speakerNames.SpeakerNamesEditor, props);
    form.props.onSubmit({ preventDefault() {} });
    assert.deepEqual(saved, [{ A: "ミカ", B: "ユウ さん" }]);
    assert.equal(closed.length, 1);
    // A control character cannot be saved.
    inputs()[0].props.onChange({ target: { value: "a\u0007b" } });
    form = runtime.render(speakerNames.SpeakerNamesEditor, props);
    assert.equal(find(form, node => node.type === "button" && node.props.type === "submit").props.disabled, true);
    form.props.onKeyDown({ key: "Escape", preventDefault() {}, stopPropagation() {} });
    assert.equal(closed.length, 2);
    assert.equal(saved.length, 1);
});

test("realtime outcomes render the same row and labels in desktop and VR log mirrors", async () => {
    const runtime = hooks(), store = { is_vr_panel: false };
    const { MessageContainer } = await load(runtime, store);
    for (const source of ["mic", "speaker"]) {
        const event = { source, generation: 4, namespace: "session", item_id: "one", revision: 1, state: "final", text: "認識した文" };
        const owner = { [source]: { generation: 4, namespace: "session", requested: true } };
        const pending = applyRealtimeCaption({ rows: [], retired: [] }, event, owner);
        const encoded = encodeLogUpdate(null, { state: "ok", data: pending.rows });
        const mirror = decodeLogUpdate(null, encoded.message);
        for (const isVr of [false, true]) {
            store.is_vr_panel = isVr;
            const node = runtime.render(MessageContainer.type, (isVr ? mirror.rows : pending.rows)[0]);
            assert.ok(find(node, n => n.props.children === `main_page.message_log.${source === "mic" ? "sending" : "processing"}`));
            assert.equal(Boolean(find(node, n => n.props.className === "loader")), !isVr);
        }
        for (const [outcome, reason, micLabel, speakerLabel] of [
            ["delivered", null, "sent", "received"],
            ["delivered", "vrchat_off", "sent_vrchat_off", "received"],
            ["not_delivered", "expired", "not_sent_expired", "processing_stopped"],
            ["not_delivered", "revoked", "not_sent_revoked", "processing_stopped"],
            ["not_delivered", "superseded", "not_sent_superseded", "processing_stopped"],
            ["not_delivered", "filtered", "not_sent_filtered", "processing_stopped"],
            ["failed", "processing_failed", "send_unconfirmed", "processing_failed"],
        ]) {
            const settled = applyRealtimeCaption(pending, { ...event, revision: 3, state: "outcome", outcome, reason }, {});
            const update = encodeLogUpdate(encoded.sent, { state: "ok", data: settled.rows });
            const mirrored = decodeLogUpdate(mirror, update.message);
            assert.deepEqual(mirrored.rows, settled.rows);
            for (const isVr of [false, true]) {
                store.is_vr_panel = isVr;
                const node = runtime.render(MessageContainer.type, (isVr ? mirrored.rows : settled.rows)[0]);
                const label = find(node, n => n.props.children === `main_page.message_log.${source === "mic" ? micLabel : speakerLabel}`);
                assert.ok(label);
                assert.equal(find(node, n => n.props.className === "loader"), null);
                if (outcome === "failed") assert.match(label.props.className, /failed/);
                if (outcome === "not_delivered") assert.match(label.props.className, /not_sent/);
                assert.equal(/vrchat_off/.test(label.props.className), reason === "vrchat_off" && source === "mic");
            }
        }
    }
});

test("VR pending label is static; only the desktop renders the animated loader", async () => {
    const runtime = hooks(), store = { is_vr_panel: true };
    const { MessageContainer } = await load(runtime, store);
    const props = { id: "pending", category: "sent", status: "pending", created_at: "12:00",
        messages: { original: { message: "Hello", transliteration: [] }, translations: [] } };
    const vr = runtime.render(MessageContainer.type, props);
    assert.equal(find(vr, node => node.props.className === "loader"), null);
    const label = find(vr, node => node.props.children === "main_page.message_log.sending");
    assert.ok(label);
    assert.equal(label.props.className, "category sent_message");
    const css = await readFile(new URL("./MessageContainer.module.scss", import.meta.url), "utf8");
    assert.doesNotMatch(css.slice(css.indexOf(".category {")), /animation:|@include loader/);
    store.is_vr_panel = false;
    const desktop = runtime.render(MessageContainer.type, props);
    assert.ok(find(desktop, node => node.props.className === "loader"));
    assert.match(css, /\.loader\s*\{\s*@include loader/);
    for (const isVr of [false, true]) {
        store.is_vr_panel = isVr;
        const failed = runtime.render(MessageContainer.type, { ...props, status: "failed" });
        const failure = find(failed, node => node.props.children === "main_page.message_log.send_unconfirmed");
        assert.match(failure.props.className, /failed/);
        assert.equal(find(failed, node => node.props.className === "loader"), null);
        assert.equal(find(failed, node => node.props.children === "main_page.message_log.sent"), null);
    }
});

test("a heard caption names its speakers beside its state, in the desktop log and the VR mirror", async () => {
    const runtime = hooks(), store = { is_vr_panel: false };
    const { MessageContainer } = await load(runtime, store);
    const event = { source: "speaker", generation: 4, namespace: "session", item_id: "one", revision: 1, state: "final",
        text: "こんばんは。こんばんは。", speakers: ["A", "B"] };
    const owner = { speaker: { generation: 4, namespace: "session", requested: true } };
    const state = applyRealtimeCaption({ rows: [], retired: [] }, event, owner);
    const mirror = decodeLogUpdate(null, encodeLogUpdate(null, { state: "ok", data: state.rows }).message);
    const labels = node => {
        const found = [];
        find(node, n => { if (typeof n.props?.children === "string" && n.props.children.startsWith("main_page.message_log.")) found.push(n.props.children); return false; });
        return found;
    };
    for (const isVr of [false, true]) {
        store.is_vr_panel = isVr;
        // The harness's t() answers the key alone.
        const shown = labels(runtime.render(MessageContainer.type, (isVr ? mirror.rows : state.rows)[0]));
        assert.equal(shown.length, 2);
        assert.equal(shown[0], "main_page.message_log.processing");
        assert.match(shown[1], /^main_page\.message_log\.speakers/);
    }
    store.is_vr_panel = false;
    const plain = applyRealtimeCaption({ rows: [], retired: [] }, { ...event, speakers: [] }, owner).rows[0];
    assert.deepEqual(labels(runtime.render(MessageContainer.type, plain)), ["main_page.message_log.processing"]);
    // The user's own row never shows speakers, whatever it carries.
    const own = { id: "typed", category: "sent", status: "ok", created_at: "12:00", speakers: ["A"],
        messages: { original: { message: "Hello", transliteration: [] }, translations: [] } };
    assert.deepEqual(labels(runtime.render(MessageContainer.type, own)), ["main_page.message_log.sent"]);
});

test("a typed message kept out of the chatbox by the setting says so, quietly and only once settled", async () => {
    const runtime = hooks();
    const { MessageContainer } = await load(runtime, { is_vr_panel: false });
    const row = { id: "typed", category: "sent", created_at: "12:00",
        messages: { original: { message: "Hello", transliteration: [] }, translations: [] } };
    const label = props => find(runtime.render(MessageContainer.type, { ...row, ...props }),
        node => typeof node.props?.children === "string" && node.props.children.startsWith("main_page.message_log."));
    const off = label({ status: "ok", delivery_reason: "vrchat_off" });
    assert.equal(off.props.children, "main_page.message_log.sent_vrchat_off");
    assert.match(off.props.className, /vrchat_off/);
    assert.doesNotMatch(off.props.className, /failed|not_sent/, "the user's own setting is not a fault");
    assert.equal(label({ status: "ok" }).props.children, "main_page.message_log.sent");
    assert.equal(label({ status: "pending", delivery_reason: "vrchat_off" }).props.children, "main_page.message_log.sending");
    assert.equal(label({ status: "failed", delivery_reason: "vrchat_off" }).props.children, "main_page.message_log.send_unconfirmed");
    assert.equal(label({ status: "ok", category: "received", delivery_reason: "vrchat_off" }).props.children, "main_page.message_log.received");
});
