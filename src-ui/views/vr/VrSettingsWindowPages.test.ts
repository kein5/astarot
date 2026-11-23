import assert from "node:assert/strict";
import { test } from "vitest";
import { componentName, draw, find, findIn, hooks, loadModule, nodesIn, setRef, treeNode } from "../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../logics/test/hookHarness.ts";
import * as languageNames from "../../logics/common/languageNames.ts";
import * as computeDeviceOptions from "../app/config_page/setting_section/setting_box/_components/compute_device/computeDeviceOptions.ts";
import * as cloudTranscription from "../../logics/configs/cloudTranscription.ts";
import * as translationCatalog from "../../logics/translation/translationCatalog.ts";
import * as ctranslate2License from "../../logics/configs/ctranslate2License.ts";
import * as featureLabel from "../../logics/common/featureLabel.ts";
import { ui_configs } from "../../logics/ui_configs.ts";

// The VR settings window, drawn with the real logic it shares with the desktop settings (language
// names, compute devices, the cloud engines, the license rule for translation models) and with
// its rows as stand-ins that keep their props (VrSettingsRows.test.ts draws the rows). The window
// is a settings page: while it is open the main functions stop, and its rows wait until the
// main window says the page is open.

const t = (key: string, variables?: object) => variables ? `${key} ${JSON.stringify(variables)}` : key;
type Setting = { state: string; data: unknown };
const ok = (data: unknown): Setting => ({ state: "ok", data });
const pending = (data: unknown): Setting => ({ state: "pending", data });

// A stand-in element of the page: a button with the focus it was given, or the list holding the rows.
interface FakeButton { name: string; disabled?: boolean; fold?: FakeButton | null; focused: unknown[]; closest: (selector: string) => unknown;
    querySelector: (selector: string) => unknown; focus: (options: unknown) => void }
function fakeButton(name: string, { disabled = false, fold = null }: { disabled?: boolean; fold?: FakeButton | null } = {}): FakeButton {
    const button: FakeButton = { name, disabled, fold, focused: [],
        closest: selector => selector === "button" ? button : selector === ".disclosure" && button.fold ? { querySelector: (inner: string) => inner === ".disclosure_toggle" ? button.fold : null } : null,
        querySelector: () => null,
        focus: options => { button.focused.push(options); },
    };
    return button;
}

async function settingsWindow(values: Record<string, unknown> = {}, { ready = true, osc = true } = {}) {
    const runtime = hooks(), calls: unknown[][] = [], i18n = { language: "en" };
    // The words in the UI's language: as the keys in English, marked with the language otherwise.
    const translate = (key: string, variables?: object) => i18n.language === "en" ? t(key, variables) : `${t(key, variables)} [${i18n.language}]`;
    let configOpen: unknown = ready;
    // Every setting the pages read: the given value, or nothing yet. Every action records its call.
    const hook = () => () => new Proxy({}, { get: (_, key) => {
        const name = String(key);
        if (name in values) return values[name];
        if (name.startsWith("current")) return ok(null);
        return (...args: unknown[]) => { calls.push([name, ...args]); };
    } });
    const { VrSettingsWindow } = await loadModule<typeof import("./VrSettingsWindow.tsx")>(new URL("./VrSettingsWindow.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t: translate, i18n }) },
        "../../logics/common/languageNames.ts": languageNames,
        "@logics_common": { useIsOpenedConfigPage: () => ({ currentIsOpenedConfigPage: { data: configOpen } }),
            useIsOscAvailable: () => ({ currentIsOscAvailable: { data: osc }, oscUnavailableLabelKey: "config_page.others.osc_unavailable" }),
            useVolume: hook() },
        "@logics_configs": { useAppearance: hook(), useDevice: hook(), useOcr: hook(), useOthers: hook(), useTranscription: hook(), useTranslation: hook(), useVr: hook() },
        "@store": { useStore_MicVolume: hook(), useStore_SelectableFontFamilyList: hook(), useStore_SpeakerVolume: hook() },
        "@ui_configs": { ui_configs },
        "./VrWindow": { VrWindow: "window" },
        "./VrHandIcon": { VrHandIcon: "hand" },
        "./VrSettingsRows": { Disclosure: "disclosure", Picker: "picker", SectionLabel: "section-label", SegmentRow: "segment-row",
            SelectRow: "select-row", StepperRow: "stepper-row", ThresholdRow: "threshold-row", ToggleRow: "toggle-row" },
        "../app/config_page/setting_section/setting_box/_components/compute_device/computeDeviceOptions": computeDeviceOptions,
        "../../logics/configs/cloudTranscription": cloudTranscription,
        "../../logics/configs/ctranslate2License": ctranslate2License,
        "../../logics/translation/translationCatalog.ts": translationCatalog,
        "../../logics/common/featureLabel.ts": featureLabel,
    });
    // The list of rows and the picker as the page holds them.
    const list = { scrollTop: 0, rows: new Set<FakeButton>(), contains: (element: FakeButton) => list.rows.has(element),
        querySelector: (selector: string) => selector === "button:not(:disabled)" ? [...list.rows].find(row => !row.disabled) ?? null : null };
    const firstChoice = fakeButton("first choice");
    const picker = { querySelector: (selector: string) => selector === "button" ? firstChoice : null };
    let tree: TreeNode | undefined;
    const render = () => {
        tree = runtime.render(VrSettingsWindow, { onClose: () => { calls.push(["close"]); } }, drawn => {
            const rows = find(drawn, node => node.props["data-vr-settings-list"] === "settings");
            if (rows) setRef(rows, list);
            const choices = find(drawn, node => node.props["data-vr-settings-list"] === "picker");
            if (choices) setRef(choices, picker);
        });
        return tree;
    };
    render();
    const current = () => { assert.ok(tree); return tree; };
    // The rows of the category on show: the category's page drawn down to its rows.
    const rowsOf = (tree: TreeNode = current()) => {
        const category = findIn(tree, node => componentName(node) === "Category", "the category");
        const content = draw(category);
        return content ? nodesIn(draw(content)) : [];
    };
    // The side bar's buttons, as the window draws them (with their own keys).
    const categoryButtons = (tree: TreeNode = current()): TreeNode[] => findIn(tree, node => node.type === "fieldset").props.children[0].props.children;
    return { runtime, calls, i18n, list, picker, firstChoice, render, rowsOf, categoryButtons,
        get tree() { return current(); },
        setReady: (value: unknown) => { configOpen = value; },
        // Shows a category, as its button in the side bar does.
        show: (id: string) => {
            const button = categoryButtons().find(node => node.key === id);
            assert.ok(button, id);
            button.props.onClick();
            return render();
        },
        // The list open in place of the rows, as the window draws it.
        pickerOf: (tree: TreeNode = current()) => findIn(tree, node => node.type === "picker", "the picker").props,
    };
}
type Window = Awaited<ReturnType<typeof settingsWindow>>;

// The words a part of the tree shows.
const textOf = (value: unknown): string => {
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (Array.isArray(value)) return value.map(textOf).join("");
    const node = treeNode(value);
    return node ? textOf(node.props.children) : "";
};
const classesOf = (node: TreeNode) => String(node.props.className ?? "").split(" ").filter(Boolean);
const rowNamed = (rows: TreeNode[], label: string) => {
    const row = rows.find(node => node.props.label === label);
    assert.ok(row, `the row ${label}`);
    return row;
};
// A row of a stand-in type, drawn when it is one of the window's own parts.
const drawnRow = (rows: TreeNode[], name: string) => draw(findIn({ props: { children: rows } }, node => componentName(node) === name, name));
// Opens a row's list and reads it back.
function openList(w: Window, row: TreeNode) {
    row.props.onOpen();
    return w.pickerOf(w.render());
}

test("the window is the settings page: it names itself so, cannot be covered, and says the functions are paused", async () => {
    const w = await settingsWindow();
    const frame = w.tree;
    assert.equal(frame.type, "window");
    assert.deepEqual([frame.props.title, frame.props.close_label, frame.props.is_lockable], ["vr_panel.window_settings", "vr_panel.settings.close", false]);
    frame.props.onClose();
    assert.deepEqual(w.calls, [["close"]]);
    const banner = findIn(frame, node => node.type === "p", "the banner");
    assert.equal(textOf(banner), "vr_panel.paused_while_settings");
    assert.equal(findIn(banner, node => typeof node.type === "function").props["aria-hidden"], "true");
    const body = findIn(frame, node => node.type === "fieldset");
    assert.deepEqual([body.props.disabled, body.props["aria-busy"], body.props["aria-label"], classesOf(body).includes("is_waiting")],
        [false, false, "vr_panel.window_settings", false]);
});

test("until the main window has opened the settings page, the rows wait", async () => {
    for (const state of [false, null, "true"]) {
        const w = await settingsWindow({}, { ready: false });
        w.setReady(state);
        const body = findIn(w.render(), node => node.type === "fieldset");
        assert.deepEqual([body.props.disabled, body.props["aria-busy"], classesOf(body).includes("is_waiting")], [true, true, true], String(state));
    }
});

test("the categories are the desktop's, in its order, with VR named as such; the one on show is pressed", async () => {
    const w = await settingsWindow();
    const buttons = w.categoryButtons();
    assert.deepEqual(buttons.map(button => [button.key, button.props["aria-pressed"], findIn(button, node => componentName(node) === "CategoryName").props.text]), [
        ["device", true, "config_page.side_menu_labels.device"],
        ["appearance", false, "config_page.side_menu_labels.appearance"],
        ["translation", false, "config_page.side_menu_labels.translation"],
        ["transcription", false, "config_page.side_menu_labels.transcription"],
        ["vrchat", false, "config_page.side_menu_labels.vrchat"],
        ["vr", false, "VR"],
    ]);
    assert.ok(buttons.every(button => findIn(button, node => typeof node.type === "function" && componentName(node) !== "CategoryName").props["aria-hidden"] === "true"));
    assert.equal(new Set(buttons.map(button => findIn(button, node => typeof node.type === "function" && componentName(node) !== "CategoryName").type)).size, 6,
        "each category has its own icon");
    assert.deepEqual(buttons.map(button => classesOf(button).includes("is_selected")), [true, false, false, false, false, false]);
    const tree = w.show("translation");
    assert.deepEqual(w.categoryButtons(tree).map(button => button.props["aria-pressed"]), [false, false, true, false, false, false]);
    const rows: TreeNode = findIn(tree, node => node.type === "fieldset").props.children[1];
    assert.equal(rows.props["data-vr-settings-list"], "settings");
    assert.equal(rows.key, "translation", "a new category starts at its own top");
    assert.equal(findIn(rows, node => componentName(node) === "Category").props.id, "translation");
});

test("a long category name breaks before its short name in brackets", async () => {
    const w = await settingsWindow();
    const name = w.categoryButtons().map(button => findIn(button, node => componentName(node) === "CategoryName"))[3];
    const split = draw(name, { text: "Speech recognition (ASR)" });
    assert.deepEqual([textOf(split.props.children[0]), textOf(split.props.children[1])], ["Speech recognition", "(ASR)"]);
    assert.equal(treeNode(split.props.children[1])?.type, "span");
    const plain = draw(name, { text: "Device" });
    assert.deepEqual(plain.props.children, ["Device", null]);
});

test("a category the window does not know draws nothing", async () => {
    const w = await settingsWindow();
    const category = findIn(w.tree, node => componentName(node) === "Category");
    assert.equal(draw(category, { ...category.props, id: "elsewhere" }), null);
});

test("a row's list opens in place of the rows, titled with its category, and picking closes it", async () => {
    const w = await settingsWindow({ currentSelectedFontFamily: ok("Noto Sans"), currentSelectableFontFamilyList: ok({ "Noto Sans": "Noto Sans", Inter: "Inter" }) });
    w.show("appearance");
    const fonts = rowNamed(w.rowsOf(), "config_page.appearance.font_family.label");
    const picker = openList(w, fonts);
    assert.deepEqual([picker.title, picker.back_label, picker.selected_id], ["config_page.side_menu_labels.appearance › config_page.appearance.font_family.label",
        "common.go_back_button_label", "Noto Sans"]);
    assert.deepEqual(picker.options, [{ id: "Noto Sans", label: "Noto Sans" }, { id: "Inter", label: "Inter" }]);
    const rows = findIn(w.tree, node => node.props["data-vr-settings-list"] === "settings");
    assert.equal(rows.props.hidden, true);
    assert.equal(picker.scrollRef.current, w.picker, "the picker scrolls its own list");
    picker.onPick("Inter");
    const closed = w.render();
    assert.deepEqual(w.calls, [["setSelectedFontFamily", "Inter"]]);
    assert.equal(find(closed, node => node.type === "picker"), null);
    assert.equal(findIn(closed, node => node.props["data-vr-settings-list"] === "settings").props.hidden, false);
});

test("back and Escape close the list without changing anything; other keys do not", async () => {
    const w = await settingsWindow({ currentSelectableFontFamilyList: ok({ Inter: "Inter" }) });
    w.show("appearance");
    const fonts = () => rowNamed(w.rowsOf(), "config_page.appearance.font_family.label");
    openList(w, fonts()).onBack();
    assert.equal(find(w.render(), node => node.type === "picker"), null);
    openList(w, fonts());
    const holder = () => findIn(w.tree, node => node.props["data-vr-settings-list"] === "picker", "the picker's list");
    holder().props.onKeyDown({ key: "Enter" });
    assert.ok(find(w.render(), node => node.type === "picker"));
    holder().props.onKeyDown({ key: "Escape" });
    assert.equal(find(w.render(), node => node.type === "picker"), null);
    assert.deepEqual(w.calls, []);
});

test("the list takes the focus when it opens; closing it brings back the rows' scroll and the pressed row's focus", async () => {
    const w = await settingsWindow({ currentSelectableFontFamilyList: ok({ Inter: "Inter" }) });
    w.show("appearance");
    const first = fakeButton("first row"), fonts = fakeButton("fonts");
    w.list.rows.add(first).add(fonts);
    w.list.scrollTop = 140;
    findIn(w.tree, node => node.props["data-vr-settings-list"] === "settings").props.onClickCapture({ target: fonts });
    openList(w, rowNamed(w.rowsOf(), "config_page.appearance.font_family.label"));
    assert.deepEqual(w.firstChoice.focused, [{ preventScroll: true }]);
    // The list scrolled the rows' element away; closing brings back where the rows were.
    w.list.scrollTop = 0;
    w.pickerOf().onBack();
    w.render();
    assert.equal(w.list.scrollTop, 140);
    assert.deepEqual([fonts.focused, first.focused], [[{ preventScroll: true }], []]);
    // Drawn again with nothing changed: the focus is not moved again.
    w.render();
    assert.equal(fonts.focused.length, 1);
});

test("when the pressed row cannot take the focus back, its fold's toggle or the first row that can takes it", async () => {
    const restore = async (setup: (w: Window, toggle: FakeButton, first: FakeButton) => FakeButton) => {
        const w = await settingsWindow({ currentSelectableFontFamilyList: ok({ Inter: "Inter" }) });
        w.show("appearance");
        const toggle = fakeButton("fold"), first = fakeButton("first row");
        const pressed = setup(w, toggle, first);
        findIn(w.tree, node => node.props["data-vr-settings-list"] === "settings").props.onClickCapture({ target: pressed });
        openList(w, rowNamed(w.rowsOf(), "config_page.appearance.font_family.label")).onBack();
        w.render();
        return [pressed, toggle, first].map(button => button.focused.length);
    };
    // The row became unavailable while the list was open: its fold's toggle.
    assert.deepEqual(await restore((w, toggle, first) => {
        const row = fakeButton("row", { disabled: true, fold: toggle });
        w.list.rows.add(first).add(toggle).add(row);
        return row;
    }), [0, 1, 0]);
    // A fold's toggle that is disabled, or no longer in the rows: the first row that can take the focus.
    assert.deepEqual(await restore((w, toggle, first) => {
        toggle.disabled = true;
        const row = fakeButton("row", { disabled: true, fold: toggle });
        w.list.rows.add(fakeButton("disabled", { disabled: true })).add(first).add(toggle).add(row);
        return row;
    }), [0, 0, 1]);
    assert.deepEqual(await restore((w, toggle, first) => {
        const row = fakeButton("row", { fold: toggle });
        w.list.rows.add(first);
        return row;
    }), [0, 0, 1]);
    // A row outside any fold that has gone.
    assert.deepEqual(await restore((w, _toggle, first) => {
        w.list.rows.add(first);
        return fakeButton("row");
    }), [0, 0, 1]);
    // Nothing can take it: nothing is focused.
    assert.deepEqual(await restore(() => fakeButton("row", { disabled: true })), [0, 0, 0]);
});

test("a click that is not on a row's button leaves no row to give the focus back to", async () => {
    const w = await settingsWindow({ currentSelectableFontFamilyList: ok({ Inter: "Inter" }) });
    w.show("appearance");
    const first = fakeButton("first row");
    w.list.rows.add(first);
    const capture = findIn(w.tree, node => node.props["data-vr-settings-list"] === "settings").props.onClickCapture;
    // A click on the rows' padding, then a list opened from elsewhere (a stand-in for a keyboard press).
    capture({ target: { closest: () => null } });
    openList(w, rowNamed(w.rowsOf(), "config_page.appearance.font_family.label")).onBack();
    w.render();
    capture({ target: null });
    openList(w, rowNamed(w.rowsOf(), "config_page.appearance.font_family.label")).onBack();
    w.render();
    // A target that is not an element (a text node has no closest).
    capture({ target: {} });
    openList(w, rowNamed(w.rowsOf(), "config_page.appearance.font_family.label")).onBack();
    w.render();
    assert.equal(first.focused.length, 0);
});

test("another category closes the list and starts at the top, without moving the focus", async () => {
    const w = await settingsWindow({ currentSelectableFontFamilyList: ok({ Inter: "Inter" }) });
    w.show("appearance");
    const fonts = fakeButton("fonts");
    w.list.rows.add(fonts);
    w.list.scrollTop = 140;
    findIn(w.tree, node => node.props["data-vr-settings-list"] === "settings").props.onClickCapture({ target: fonts });
    openList(w, rowNamed(w.rowsOf(), "config_page.appearance.font_family.label"));
    const tree = w.show("vr");
    assert.equal(find(tree, node => node.type === "picker"), null);
    assert.equal(w.list.scrollTop, 0);
    assert.equal(fonts.focused.length, 0);
});

test("the UI language's list names each language in the UI's language and in itself, and follows a change of the UI's language", async () => {
    const w = await settingsWindow({ currentUiLanguage: ok("ja") });
    w.show("appearance");
    const row = rowNamed(w.rowsOf(), "config_page.appearance.ui_language.label");
    assert.equal(row.props.value, "Japanese / 日本語");
    assert.equal(row.props.is_pending, false);
    const picker = openList(w, row);
    assert.equal(picker.title, "config_page.side_menu_labels.appearance › config_page.appearance.ui_language.label");
    assert.deepEqual(picker.options, [{ id: "en", label: "English" }, { id: "ja", label: "Japanese / 日本語" }]);
    assert.equal(picker.selected_id, "ja");
    w.i18n.language = "ja";
    const japanese = w.pickerOf(w.render());
    assert.deepEqual(japanese.options, [{ id: "en", label: "英語 / English" }, { id: "ja", label: "日本語" }]);
    assert.equal(japanese.title, "config_page.side_menu_labels.appearance [ja] › config_page.appearance.ui_language.label [ja]");
    w.pickerOf().onPick("en");
    assert.deepEqual(w.calls, [["setUiLanguage", "en"]]);
    // A language the list does not know is shown as it is saved.
    const other = await settingsWindow({ currentUiLanguage: pending("xx") });
    other.show("appearance");
    const unknown = rowNamed(other.rowsOf(), "config_page.appearance.ui_language.label");
    assert.deepEqual([unknown.props.value, unknown.props.is_pending], ["xx", true]);
});

test("the appearance page: the font list waits for the fonts, and the reading aids switch", async () => {
    const w = await settingsWindow({ currentSelectedFontFamily: ok("Inter"), currentSelectableFontFamilyList: pending({}),
        currentConvertMessageToHiragana: ok(true), currentConvertMessageToRomaji: ok(false) });
    w.show("appearance");
    const rows = w.rowsOf();
    assert.deepEqual(rows.filter(row => row.type === "section-label").map(row => row.props.label),
        ["config_page.appearance.section_label_display", "config_page.others.section_label_reading_aids"]);
    const fonts = rowNamed(rows, "config_page.appearance.font_family.label");
    assert.deepEqual([fonts.props.value, fonts.props.is_pending, fonts.props.is_disabled, fonts.props.disabled_reason],
        ["Inter", true, true, "vr_panel.settings.fonts_unavailable"]);
    const hiragana = rowNamed(rows, "config_page.others.convert_message_to_hiragana.label");
    const romaji = rowNamed(rows, "config_page.others.convert_message_to_romaji.label");
    assert.deepEqual([hiragana.props.variable, romaji.props.variable], [ok(true), ok(false)]);
    hiragana.props.onToggle();
    romaji.props.onToggle();
    assert.deepEqual(w.calls, [["toggleConvertMessageToHiragana"], ["toggleConvertMessageToRomaji"]]);
    const settled = await settingsWindow({ currentSelectedFontFamily: pending("Inter"), currentSelectableFontFamilyList: ok({ Inter: "Inter" }) });
    settled.show("appearance");
    const choosing = rowNamed(settled.rowsOf(), "config_page.appearance.font_family.label");
    assert.deepEqual([choosing.props.is_pending, choosing.props.is_disabled], [true, false]);
    const idle = await settingsWindow({ currentSelectableFontFamilyList: ok({ Inter: "Inter" }) });
    idle.show("appearance");
    assert.equal(rowNamed(idle.rowsOf(), "config_page.appearance.font_family.label").props.is_pending, false);
});

// The device page's rows, in order.
async function devicePage(values: Record<string, unknown>, options?: { osc?: boolean }) {
    const w = await settingsWindow(values, options);
    const rows = w.rowsOf();
    return { w, rows, selects: rows.filter(row => row.type === "select-row"), thresholds: rows.filter(row => row.type === "threshold-row") };
}

test("the device page: the microphone's host and device, its threshold and mute sync, then the speaker's", async () => {
    const { rows } = await devicePage({});
    assert.deepEqual(rows.filter(row => typeof row.type === "string").map(row => [row.type, row.props.label]), [
        ["section-label", "config_page.device.mic_host_device.label"],
        ["toggle-row", "config_page.device.label_auto_select"],
        ["select-row", "config_page.device.label_host"],
        ["select-row", "config_page.device.label_device"],
        ["threshold-row", "vr_panel.mic_threshold"],
        ["section-label", "config_page.device.speaker_device.label"],
        ["toggle-row", "config_page.device.label_auto_select"],
        ["select-row", "config_page.device.label_device"],
        ["threshold-row", "vr_panel.speaker_threshold"],
    ]);
    assert.equal(rows.findIndex(row => componentName(row) === "VrcMicMuteSyncRow"), rows.findIndex(row => row.type === "threshold-row") + 1);
});

test("a device is shown by its name, and chosen from the list of the ones there are", async () => {
    const { w, selects } = await devicePage({
        currentMicHostList: ok({ MME: "MME", WASAPI: "Windows WASAPI" }), currentSelectedMicHost: ok("WASAPI"),
        currentMicDeviceOptions: ok({ "mic-1": "Headset", "mic-2": 2 }), currentSelectedMicDeviceId: ok("gone"),
        currentSpeakerDeviceOptions: ok({ "out-1": "Speakers" }), currentSelectedSpeakerDeviceId: ok("out-1"),
        currentEnableAutoMicSelect: ok(false), currentEnableAutoSpeakerSelect: ok(false) });
    const [host, mic, speaker] = selects;
    // A device no longer listed is shown by what is saved.
    assert.deepEqual([host.props.value, mic.props.value, speaker.props.value], ["Windows WASAPI", "gone", "Speakers"]);
    assert.ok(selects.every(row => row.props.is_pending === false && row.props.is_disabled === false));
    const list = openList(w, host);
    assert.deepEqual([list.options, list.selected_id, list.title], [[{ id: "MME", label: "MME" }, { id: "WASAPI", label: "Windows WASAPI" }], "WASAPI",
        "config_page.side_menu_labels.device › config_page.device.label_host"]);
    list.onPick("MME");
    const devices = openList(w, w.rowsOf().filter(row => row.type === "select-row")[1]);
    assert.deepEqual(devices.options, [{ id: "mic-1", label: "Headset" }, { id: "mic-2", label: "2" }]);
    devices.onPick("mic-2");
    openList(w, w.rowsOf().filter(row => row.type === "select-row")[2]).onPick("out-1");
    assert.deepEqual(w.calls, [["setSelectedMicHost", "MME"], ["setSelectedMicDeviceId", "mic-2"], ["setSelectedSpeakerDeviceId", "out-1"]]);
});

test("a device cannot be chosen while it is chosen automatically, or when there is none, and says which", async () => {
    const auto = await devicePage({ currentEnableAutoMicSelect: ok(true), currentMicHostList: ok({ MME: "MME" }), currentEnableAutoSpeakerSelect: ok(false),
        currentSpeakerDeviceOptions: ok({}) });
    const [host, mic, speaker] = auto.selects;
    assert.deepEqual([host.props.is_disabled, host.props.disabled_reason], [true, "vr_panel.settings.auto_device"]);
    assert.deepEqual([mic.props.is_disabled, mic.props.disabled_reason], [true, "vr_panel.settings.auto_device"]);
    assert.deepEqual([speaker.props.is_disabled, speaker.props.disabled_reason], [true, "vr_panel.settings.unavailable"]);
    // A list that is not a list of devices has none.
    const broken = await devicePage({ currentEnableAutoMicSelect: ok("true"), currentMicHostList: ok("MME") });
    assert.deepEqual([broken.selects[0].props.is_disabled, broken.selects[0].props.disabled_reason], [true, "vr_panel.settings.unavailable"]);
    const toggles = auto.rows.filter(row => row.type === "toggle-row");
    toggles[0].props.onToggle();
    toggles[1].props.onToggle();
    assert.deepEqual(auto.w.calls, [["toggleEnableAutoMicSelect"], ["toggleEnableAutoSpeakerSelect"]]);
    assert.deepEqual(toggles.map(row => row.props.variable), [ok(true), ok(false)]);
});

test("a device row waits while the device, the automatic choice or the list is changing", async () => {
    for (const changing of [{ currentSelectedMicHost: pending("MME") }, { currentEnableAutoMicSelect: pending(false) }, { currentMicHostList: pending({ MME: "MME" }) }]) {
        const { selects } = await devicePage({ currentMicHostList: ok({ MME: "MME" }), ...changing });
        assert.equal(selects[0].props.is_pending, true, Object.keys(changing)[0]);
        assert.equal(selects[2].props.is_pending, false);
    }
});

test("the thresholds change the microphone's and the speaker's own settings, in steps of 50 within the app's range", async () => {
    const { w, thresholds } = await devicePage({ currentMicThreshold: ok(300), currentSpeakerThreshold: ok(700), currentMicVolume: ok(120), currentSpeakerVolume: ok(40),
        currentEnableAutomaticMicThreshold: ok(true), currentMicThresholdCheckStatus: ok(false), currentSpeakerThresholdCheckStatus: ok(true) });
    const [mic, speaker] = thresholds;
    assert.deepEqual([mic.props.threshold, mic.props.automatic, mic.props.check_status, mic.props.volume], [ok(300), ok(true), ok(false), 120]);
    assert.deepEqual([speaker.props.threshold, speaker.props.check_status, speaker.props.volume], [ok(700), ok(true), 40]);
    for (const row of thresholds) {
        assert.deepEqual([row.props.automatic_label, row.props.min, row.props.max, row.props.step], ["vr_panel.automatic", 0, 2000, 50]);
        row.props.setThreshold(350);
        row.props.toggleAutomatic();
        row.props.startCheck();
        row.props.stopCheck();
    }
    assert.notEqual(mic.props.CheckIcon, speaker.props.CheckIcon, "a microphone and headphones");
    assert.deepEqual(w.calls, [["setMicThreshold", 350], ["toggleEnableAutomaticMicThreshold"], ["volumeCheckStart_Mic"], ["volumeCheckStop_Mic"],
        ["setSpeakerThreshold", 350], ["toggleEnableAutomaticSpeakerThreshold"], ["volumeCheckStart_Speaker"], ["volumeCheckStop_Speaker"]]);
});

test("the mute sync with VRChat switches, unless VRChat's OSC cannot be reached", async () => {
    const reachable = await devicePage({ currentEnableVrcMicMuteSync: ok(true) });
    const row = drawnRow(reachable.rows, "VrcMicMuteSyncRow");
    assert.deepEqual([row.type, row.props.label, row.props.variable, row.props.is_disabled, row.props.disabled_reason],
        ["toggle-row", "config_page.others.vrc_mic_mute_sync.label", ok(true), false, "config_page.others.osc_unavailable"]);
    row.props.onToggle();
    assert.deepEqual(reachable.w.calls, [["toggleEnableVrcMicMuteSync"]]);
    const unreachable = await devicePage({}, { osc: false });
    assert.equal(drawnRow(unreachable.rows, "VrcMicMuteSyncRow").props.is_disabled, true);
});

// The translation page: its rows, the processing fold drawn, and the fold's own rows.
async function translationPage(values: Record<string, unknown>) {
    const w = await settingsWindow(values);
    w.show("translation");
    const rows = w.rowsOf();
    const fold = drawnRow(rows, "ComputeSettings");
    return { w, rows, fold, foldRows: nodesIn(fold).filter(row => row.type === "select-row") };
}
const weights = [
    { id: "m2m100_418M-ct2-int8", capacity: "418MB", license: "MIT", non_commercial: false, is_downloaded: true },
    { id: "m2m100_1.2B-ct2-int8", capacity: "1.2GB", license: "MIT", non_commercial: false, is_downloaded: false },
    { id: "nllb-200-distilled-600M-ct2-int8", capacity: "600MB", license: "CC-BY-NC-4.0", non_commercial: true, is_downloaded: true },
];

test("the local translation model is chosen from the downloaded ones; a non-commercial one only when it is already in use", async () => {
    const page = await translationPage({ currentCTranslate2WeightTypeStatus: ok(weights), currentSelectedCTranslate2WeightType: ok("m2m100_418M-ct2-int8") });
    const model = rowNamed(page.rows, "config_page.translation.ctranslate2_weight_type.label");
    assert.deepEqual([model.props.value, model.props.is_pending, model.props.is_disabled, model.props.disabled_reason],
        ["M2M100 418M · int8", false, false, "vr_panel.settings.prepare_model"]);
    const list = openList(page.w, model);
    assert.deepEqual(list.options, [{ id: "m2m100_418M-ct2-int8", label: "M2M100 418M · int8 (418MB)" }]);
    list.onPick("m2m100_418M-ct2-int8");
    assert.deepEqual(page.w.calls, [["setSelectedCTranslate2WeightType", "m2m100_418M-ct2-int8"]]);
    // The non-commercial model in use stays listed, with its license.
    const nllb = await translationPage({ currentCTranslate2WeightTypeStatus: ok(weights), currentSelectedCTranslate2WeightType: pending("nllb-200-distilled-600M-ct2-int8") });
    const inUse = rowNamed(nllb.rows, "config_page.translation.ctranslate2_weight_type.label");
    assert.equal(inUse.props.is_pending, true);
    assert.deepEqual(openList(nllb.w, inUse).options.map((option: { label: string }) => option.label),
        ["M2M100 418M · int8 (418MB)", "NLLB-200 distilled 600M · int8 (600MB, CC-BY-NC-4.0)"]);
    // Nothing downloaded: nothing to choose, and the row says to prepare a model on the PC.
    const none = await translationPage({ currentCTranslate2WeightTypeStatus: ok(weights.map(weight => ({ ...weight, is_downloaded: false }))) });
    assert.equal(rowNamed(none.rows, "config_page.translation.ctranslate2_weight_type.label").props.is_disabled, true);
    const unknown = await translationPage({});
    assert.equal(rowNamed(unknown.rows, "config_page.translation.ctranslate2_weight_type.label").props.is_disabled, true);
});

const devices = { 0: { device: "cpu", device_index: 0, device_name: "cpu", compute_types: ["auto", "int8", "float32"] },
    1: { device: "cuda", device_index: 0, device_name: "RTX 4070", compute_types: ["auto", "int8", "float16"] } };

test("the processing fold says the device and precision in use, and chooses each from the device's own", async () => {
    const page = await translationPage({ currentSelectableTranslationComputeDeviceList: ok(devices), currentSelectedTranslationComputeDevice: ok(devices[1]),
        currentSelectedTranslationComputeType: ok("float16") });
    assert.deepEqual([page.fold.type, page.fold.props.label, page.fold.props.summary, page.fold.props.is_pending],
        ["disclosure", "vr_panel.settings.processing", 'RTX 4070 · config_page.common.compute_device.type_template_high {"type_name":"float16"}', false]);
    const [device, type] = page.foldRows;
    assert.deepEqual([device.props.label, device.props.value, device.props.is_disabled, device.props.disabled_reason],
        ["config_page.common.compute_device.label_device", "RTX 4070", false, "vr_panel.settings.devices_unavailable"]);
    assert.deepEqual([type.props.label, type.props.value, type.props.is_disabled, type.props.disabled_reason],
        ["config_page.common.compute_device.label_type", 'config_page.common.compute_device.type_template_high {"type_name":"float16"}', false, "vr_panel.settings.types_unavailable"]);
    const deviceList = openList(page.w, device);
    assert.deepEqual([deviceList.options, deviceList.selected_id], [[{ id: "0", label: "CPU" }, { id: "1", label: "RTX 4070" }], "1"]);
    deviceList.onPick("0");
    // A device the list no longer has is not sent.
    openList(page.w, drawnRow(page.w.rowsOf(), "ComputeSettings").props.children[0]).onPick("7");
    const typeList = openList(page.w, nodesIn(drawnRow(page.w.rowsOf(), "ComputeSettings")).filter(row => row.type === "select-row")[1]);
    assert.deepEqual([typeList.options.map((option: { id: string }) => option.id), typeList.selected_id], [["auto", "int8", "float16"], "float16"]);
    typeList.onPick("int8");
    assert.deepEqual(page.w.calls, [["setSelectedTranslationComputeDevice", devices[0]], ["setSelectedTranslationComputeType", "int8"]]);
});

test("the processing fold falls back to the saved names, and waits while any part of it changes", async () => {
    // A saved device the list does not have: its name, and the saved precision as it is.
    const saved = await translationPage({ currentSelectableTranslationComputeDeviceList: ok(devices),
        currentSelectedTranslationComputeDevice: ok({ device: "cuda", device_index: 1, device_name: "Old GPU" }), currentSelectedTranslationComputeType: ok("int8") });
    assert.deepEqual([saved.foldRows[0].props.value, saved.foldRows[1].props.value, saved.fold.props.summary], ["Old GPU", "int8", "Old GPU · int8"]);
    assert.deepEqual([saved.foldRows[1].props.is_disabled], [true], "no precisions for a device the list does not have");
    // Nothing known yet: an empty summary, nothing to choose.
    const empty = await translationPage({});
    assert.deepEqual([empty.fold.props.summary, empty.foldRows[0].props.value, empty.foldRows[0].props.is_disabled], ["", undefined, true]);
    for (const changing of ["currentSelectableTranslationComputeDeviceList", "currentSelectedTranslationComputeDevice", "currentSelectedTranslationComputeType"]) {
        const page = await translationPage({ currentSelectableTranslationComputeDeviceList: ok(devices), currentSelectedTranslationComputeDevice: ok(devices[0]),
            currentSelectedTranslationComputeType: ok("int8"), [changing]: pending(changing === "currentSelectedTranslationComputeType" ? "int8" : changing.includes("List") ? devices : devices[0]) });
        assert.deepEqual([page.fold.props.is_pending, ...page.foldRows.map(row => row.props.is_pending)], [true, true, true], changing);
    }
    const settled = await translationPage({ currentSelectableTranslationComputeDeviceList: ok(devices), currentSelectedTranslationComputeDevice: ok(devices[0]) });
    assert.deepEqual([settled.fold.props.is_pending, ...settled.foldRows.map(row => row.props.is_pending)], [false, false, false]);
});

const PROVIDERS = [
    ["plamo", "Plamo", "Plamo"], ["gemini", "Gemini", "Gemini"], ["openai", "OpenAI", "OpenAI"], ["groq", "Groq", "Groq"],
    ["openrouter", "OpenRouter", "OpenRouter"], ["lmstudio", "LMStudio", "LMStudio"], ["openai_compatible", "OpenAICompatible", "OpenAICompatible"], ["ollama", "Ollama", "Ollama"],
] as const;

test("each connected AI translator's model is chosen from its own list; a translator without one is not shown", async () => {
    const values: Record<string, unknown> = {};
    for (const [, name] of PROVIDERS) {
        values[`currentSelectable${name}ModelList`] = ok({ [`${name}-a`]: `${name} A`, [`${name}-b`]: `${name} B` });
        values[`currentSelected${name}Model`] = ok(`${name}-a`);
    }
    const page = await translationPage(values);
    const rows = PROVIDERS.map(([i18n]) => rowNamed(page.rows, `config_page.translation.select_${i18n}_model.label`));
    // Keyed by the translator (the search through the tree prefixes the keys it meets).
    assert.deepEqual(rows.map(row => String(row.key).split("$").at(-1)), PROVIDERS.map(([i18n]) => i18n));
    assert.deepEqual(rows.map(row => [row.props.value, row.props.is_pending]), PROVIDERS.map(([, name]) => [`${name}-a`, false]));
    for (const [index, [, name]] of PROVIDERS.entries()) {
        const list = openList(page.w, page.w.rowsOf().filter(row => row.type === "select-row")[1 + index]);
        assert.deepEqual([list.options, list.selected_id], [[{ id: `${name}-a`, label: `${name} A` }, { id: `${name}-b`, label: `${name} B` }], `${name}-a`]);
        list.onPick(`${name}-b`);
    }
    assert.deepEqual(page.w.calls, PROVIDERS.map(([, , setter]) => [`setSelected${setter}Model`, `${setter}-b`]));
    // Only the ones with a list of models; a choice that is not a model name shows nothing; a choice on its way waits.
    const some = await translationPage({ currentSelectableGeminiModelList: ok({ g: "g" }), currentSelectedGeminiModel: pending(3), currentSelectableOllamaModelList: ok({}) });
    const shown = some.rows.filter(row => String(row.props.label).startsWith("config_page.translation.select_"));
    assert.deepEqual(shown.map(row => [row.props.label, row.props.value, row.props.is_pending]),
        [["config_page.translation.select_gemini_model.label", undefined, true]]);
});

test("the transcription page: the local engine and the cloud engines whose key is registered", async () => {
    const values = { currentSelectableTranscriptionEngines: ok(["Deepgram", "Groq_Whisper", "Other"]), currentSelectedTranscriptionEngine: ok("Deepgram") };
    const w = await settingsWindow(values);
    w.show("transcription");
    const engine = rowNamed(w.rowsOf(), "config_page.transcription.select_transcription_engine.label");
    assert.deepEqual([engine.props.value, engine.props.is_pending], ["config_page.transcription.select_transcription_engine.engines.deepgram", false]);
    const list = openList(w, engine);
    assert.deepEqual(list.options, [
        { id: "SpeechCpp", label: "config_page.transcription.select_transcription_engine.engines.speechcpp" },
        { id: "Groq_Whisper", label: "config_page.transcription.select_transcription_engine.engines.groq_whisper" },
        { id: "Deepgram", label: "config_page.transcription.select_transcription_engine.engines.deepgram" },
    ]);
    assert.equal(list.selected_id, "Deepgram");
    list.onPick("SpeechCpp");
    assert.deepEqual(w.calls, [["setSelectedTranscriptionEngine", "SpeechCpp"]]);
    // Nothing registered yet; a saved engine the list does not have is shown by its name.
    const bare = await settingsWindow({ currentSelectedTranscriptionEngine: pending("Custom_Whisper") });
    bare.show("transcription");
    const saved = rowNamed(bare.rowsOf(), "config_page.transcription.select_transcription_engine.label");
    assert.deepEqual([saved.props.value, saved.props.is_pending], ["Custom_Whisper", true]);
    assert.deepEqual(openList(bare, saved).options.map((option: { id: string }) => option.id), ["SpeechCpp"]);
});

test("the timeouts keep the recording limit at or below the silence that ends a phrase, and each sets its own source's", async () => {
    const w = await settingsWindow({ currentMicRecordTimeout: ok(3), currentMicPhraseTimeout: ok(40), currentMicMaxWords: ok(10),
        currentSpeakerRecordTimeout: ok(5), currentSpeakerPhraseTimeout: ok(8), currentSpeakerMaxWords: ok(20) });
    w.show("transcription");
    const rows = w.rowsOf();
    const fold = rows.find(row => row.type === "disclosure");
    assert.ok(fold);
    const steppers = rows.filter(row => row.type === "stepper-row");
    assert.equal(rows.filter(row => row.type === "section-label").map(row => row.props.label).join(), "config_page.transcription.section_label_mic,config_page.transcription.section_label_speaker");
    assert.deepEqual(steppers.map(row => [row.props.label, row.props.min, row.props.max, row.props.step]), [
        ["config_page.transcription.mic_record_timeout.label", 0, 30, 1],
        ["config_page.transcription.mic_phrase_timeout.label", 3, 30, 1],
        ["config_page.transcription.mic_max_phrase.label", 0, 30, 1],
        ["config_page.transcription.speaker_record_timeout.label", 0, 8, 1],
        ["config_page.transcription.speaker_phrase_timeout.label", 5, 30, 1],
        ["config_page.transcription.speaker_max_phrase.label", 0, 60, 1],
    ]);
    assert.deepEqual(steppers.map(row => row.props.variable.data), [3, 40, 10, 5, 8, 20]);
    steppers.forEach((row, index) => { row.props.setValue(index); });
    assert.deepEqual(w.calls, [["setMicRecordTimeout", 0], ["setMicPhraseTimeout", 1], ["setMicMaxWords", 2],
        ["setSpeakerRecordTimeout", 3], ["setSpeakerPhraseTimeout", 4], ["setSpeakerMaxWords", 5]]);
    for (const name of ["currentSpeakerRecordTimeout", "currentSpeakerMaxWords"]) {
        const changing = await settingsWindow({ [name]: pending(1) });
        changing.show("transcription");
        assert.equal(changing.rowsOf().find(row => row.type === "disclosure")?.props.is_pending, true, name);
    }
});

test("the VRChat page: the chatbox switches, the mute sync and the chat reading's settings", async () => {
    const w = await settingsWindow({ currentEnableSendMessageToVrc: ok(true), currentOcrSourceLanguage: ok("Japanese"),
        currentSelectableOcrSourceLanguageList: ok({ auto: "Auto", Japanese: "Japanese", English: "English" }) });
    w.show("vrchat");
    const rows = w.rowsOf();
    assert.deepEqual(rows.filter(row => row.type === "section-label").map(row => row.props.label), ["config_page.vrchat.section_label_chatbox", "config_page.ocr.section_title"]);
    const toggles = rows.filter(row => row.type === "toggle-row");
    assert.deepEqual(toggles.map(row => row.props.label), ["send_message_to_vrc", "send_only_translated_messages", "notification_vrc_sfx", "send_received_message_to_vrc"]
        .map(key => `config_page.others.${key}.label`));
    assert.deepEqual(toggles[0].props.variable, ok(true));
    toggles.forEach(row => { row.props.onToggle(); });
    assert.deepEqual(w.calls.splice(0), [["toggleEnableSendMessageToVrc"], ["toggleEnableSendOnlyTranslatedMessages"], ["toggleEnableNotificationVrcSfx"],
        ["toggleEnableSendReceivedMessageToVrc"]]);
    assert.equal(drawnRow(rows, "VrcMicMuteSyncRow").props.label, "config_page.others.vrc_mic_mute_sync.label");
    // The chat reading: its language by name in the UI's language, its timing, its confidence and the shortest text it reads.
    const ocr = nodesIn(drawnRow(rows, "OcrSettings"));
    const language = rowNamed(ocr, "config_page.ocr.source_language.label");
    assert.deepEqual([language.props.value, language.props.is_pending], ["Japanese", false]);
    const list = openList(w, language);
    assert.equal(list.title, "config_page.side_menu_labels.vrchat › config_page.ocr.source_language.label");
    assert.deepEqual(list.options, [{ id: "auto", label: "config_page.ocr.source_language.auto" }, { id: "Japanese", label: "Japanese" }, { id: "English", label: "English" }]);
    w.i18n.language = "ja";
    const japanese = w.pickerOf(w.render());
    assert.deepEqual(japanese.options.map((option: { label: string }) => option.label), ["config_page.ocr.source_language.auto [ja]", "日本語", "英語"]);
    assert.equal(japanese.title, "config_page.side_menu_labels.vrchat [ja] › config_page.ocr.source_language.label [ja]");
    w.pickerOf().onPick("auto");
    assert.deepEqual(w.calls.splice(0), [["setOcrSourceLanguage", "auto"]]);
    const steppers = ocr.filter(row => row.type === "stepper-row");
    assert.deepEqual(steppers.map(row => [row.props.label, row.props.min, row.props.max, row.props.step, row.props.format?.(0.5)]), [
        ["config_page.ocr.poll_interval_ms.label", 100, 5000, 50, "0.5 ms"],
        ["config_page.ocr.min_confidence.label", 0.1, 0.99, 0.01, "0.50"],
        ["config_page.ocr.bubble_min_text_length.label", 1, 50, 1, undefined],
    ]);
    steppers.forEach((row, index) => { row.props.setValue(index); });
    assert.deepEqual(w.calls, [["setOcrPollIntervalMs", 0], ["setOcrMinConfidence", 1], ["setOcrBubbleMinTextLength", 2]]);
});

test("the chat reading's language says automatic for auto, and waits while it changes", async () => {
    const w = await settingsWindow({ currentOcrSourceLanguage: pending("auto") });
    w.show("vrchat");
    const language = rowNamed(nodesIn(drawnRow(w.rowsOf(), "OcrSettings")), "config_page.ocr.source_language.label");
    assert.deepEqual([language.props.value, language.props.is_pending], ["config_page.ocr.source_language.auto", true]);
    assert.deepEqual(openList(w, language).options, [], "no list yet: nothing to choose");
});

test("the VR page: the log's opacity in percent, the subtitle overlays, and the launcher", async () => {
    const w = await settingsWindow({ currentOverlayVrPanelOpacity: ok(0.6) });
    w.show("vr");
    const rows = w.rowsOf();
    assert.deepEqual(rows.filter(row => row.type === "section-label").map(row => row.props.label),
        ["vr_panel.settings.ui_log", "vr_panel.settings.subtitle_overlay", "vr_panel.launcher"]);
    const opacity = rowNamed(rows, "vr_panel.log_opacity");
    assert.deepEqual([opacity.props.variable, opacity.props.min, opacity.props.max, opacity.props.step, opacity.props.format(0.555)], [ok(0.6), 0.2, 1, 0.1, "56%"]);
    opacity.props.setValue(0.7);
    const toggles = rows.filter(row => row.type === "toggle-row");
    assert.deepEqual(toggles.map(row => row.props.label), ["vr_panel.overlay_small_log", "vr_panel.overlay_large_log",
        "config_page.vr.overlay_show_only_translated_messages.label", "vr_panel.launcher_auto_hide", "vr_panel.tooltip_enabled"]);
    toggles.forEach(row => { row.props.onToggle(); });
    rowNamed(rows, "vr_panel.launcher_hand").props.onSelect("RightHand");
    assert.deepEqual(w.calls, [["setOverlayVrPanelOpacity", 0.7], ["toggleIsEnabledOverlaySmallLog"], ["toggleIsEnabledOverlayLargeLog"],
        ["toggleOverlayShowOnlyTranslatedMessages"], ["toggleOverlayVrLauncherAutoHide"], ["toggleOverlayVrTooltip"], ["setOverlayVrLauncherHand", "RightHand"]]);
});
