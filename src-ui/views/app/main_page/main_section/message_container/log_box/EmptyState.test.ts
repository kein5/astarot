import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { createElement } from "react";
import type { ReactNode } from "react";
import { hooks, loadModule, find, unchecked, fieldOf } from "../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../logics/test/hookHarness.ts";
import * as needsLogic from "../../../../../../logics/main/setupNeeds.ts";
import * as setupLogic from "../../../../../../logics/setup/firstRunSetup.ts";
import { localeAt, readLocale } from "../../../../../../logics/test/locales.ts";

type EmptyStateModule = typeof import("./EmptyState.tsx");
interface EmptySetup {
    needs?: unknown[];
    // Whether the main window hands its line about VRChat down (MainPage does; the VR panel does not).
    hint?: boolean;
    vr?: boolean;
    startup?: ReactNode;
    settings?: Record<string, unknown>;
    recognition?: string;
    // FIRST_RUN_SETUP_PENDING: whether the setup is still suggested.
    notice?: boolean | null;
}

// node?.props?.[key], for a rendered node of any kind.
const propOf = (node: unknown, key: string): unknown => fieldOf(node, "props", key);

// Draw the nested component too, so the whole screen can be searched.
const draw = (node: unknown): unknown => {
    if (!node || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map(draw);
    const type: unknown = Reflect.get(node, "type"), props: unknown = Reflect.get(node, "props");
    return typeof type === "function" ? draw(type(props))
        : { ...node, props: { ...Object(props), children: draw(propOf(node, "children")) } };
};
const texts = (node: unknown): string[] => !node || typeof node !== "object" ? (typeof node === "string" ? [node] : [])
    : Array.isArray(node) ? node.flatMap(texts) : texts(propOf(node, "children"));

// The main window's line about VRChat, as a part that draws one line (VrchatOscHint decides when).
const VrchatLine = ({ className }: { className?: string }) => createElement("p", { className }, "the line about VRChat");

async function setup({ needs = [], hint = true, vr = false, startup = null, settings = {}, recognition = "ready", notice = true }: EmptySetup = {}) {
    const runtime = hooks(), started: string[] = [], read: string[] = [];
    const { EmptyState } = await loadModule<EmptyStateModule>(new URL("./EmptyState.tsx", import.meta.url), runtime, {
        "@store": { store: { is_vr_panel: vr } },
        "@logics_configs": { useSettingValue: (name: string) => { read.push(name); return settings[name] ?? { data: undefined }; } },
        "../../../../../../logics/main/useSetupNeeds": { useSetupNeeds: () => ({ needs, start: (id: string) => started.push(id) }) },
        "../../../../../../logics/setup/useRecognitionState": { useRecognitionState: () => ({ state: recognition }) },
        "../../../../../../logics/setup/useFirstRunSetup": { useFirstRunSetup: () => ({ notice, openSetup: () => started.push("first_run") }) },
        "../../../../../../logics/setup/firstRunSetup.ts": setupLogic,
        "../../../../../../logics/main/setupNeeds": needsLogic,
        "../../../startupContext": { useStartupPlaceholder: () => startup },
        "../../../vrchatHintContext": { useVrchatHint: () => hint ? VrchatLine : null },
    });
    const tree = draw(runtime.render(EmptyState));
    return { tree, started, read, texts: texts(tree) };
}

// The greeting's block: the one that holds the heading and nothing else.
const isGreeting = (node: TreeNode) => node.props?.children?.type === "h1";
const greetingIn = (tree: unknown) => {
    const greeting = find(tree, isGreeting);
    assert.ok(greeting);
    return greeting;
};

test("the empty conversation lists what the selected engines still need, each with the step that provides it", async () => {
    const s = await setup({ needs: [{ id: "translation", weight: { id: "small" }, action: "review" },
        { id: "transcription", weight: { id: "base" }, action: "review" }] });
    const list = find(s.tree, node => node.type === "ul");
    assert.ok(list);
    assert.equal(list.props["aria-label"], "studio.setup_label");
    assert.deepEqual(s.texts.filter(text => text.startsWith("studio.setup_")), ["studio.setup_translation", "studio.setup_transcription"]);
    const buttons: TreeNode[] = [];
    find(s.tree, node => { if (node.type === "button") buttons.push(node); return false; });
    assert.deepEqual(buttons.map(button => button.props.children), ["model_downloads.review", "model_downloads.review"]);
    buttons[1].props.onClick();
    assert.deepEqual(s.started, ["transcription"], "the button opens the review; it does not download");
});

test("the local speech recognition's models are set in its settings: the button opens them, it does not download", async () => {
    const s = await setup({ needs: [{ id: "transcription", weight: null, action: "settings" }] });
    assert.deepEqual(s.texts.filter(text => text.startsWith("studio.setup_")), ["studio.setup_transcription", "studio.setup_open_settings"]);
    const button = find(s.tree, node => node.type === "button");
    assert.ok(button);
    assert.equal(button.props.children, "studio.setup_open_settings");
    button.props.onClick();
    assert.deepEqual(s.started, ["transcription"]);
});

test("a model on its way shows its progress instead of the button", async () => {
    const s = await setup({ needs: [{ id: "translation", weight: { id: "small", is_pending: true, progress: null } },
        { id: "transcription", weight: { id: "base", is_pending: true, progress: 41.7 } }] });
    assert.equal(find(s.tree, node => node.type === "button"), null);
    const status: unknown[] = [];
    find(s.tree, node => { if (node.props?.role === "status") status.push(node.props.children); return false; });
    assert.deepEqual(status, ["studio.setup_preparing", "studio.setup_downloading"]);
});

test("a recognition not set up yet offers the first-run setup in place of the other needs", async () => {
    const s = await setup({ recognition: "needs_setup", needs: [{ id: "transcription", weight: null, action: "settings" }] });
    assert.deepEqual(s.texts.filter(text => text.startsWith("studio.setup_")), ["studio.setup_first_run", "studio.setup_first_run_open"]);
    const button = find(s.tree, node => node.type === "button");
    assert.ok(button);
    button.props.onClick();
    assert.deepEqual(s.started, ["first_run"], "the button opens the setup; it does not download");
    for (const recognition of ["ready", "cloud", "own_server", "unknown"]) {
        assert.ok(!(await setup({ recognition })).texts.includes("studio.setup_first_run"), recognition);
    }
});

// #935: the setup does not open by itself. While it is still suggested, its line leads the first
// screen (a lilac frame, the lilac button); once done or no longer wanted, the line is a plain one.
test("while the setup is still suggested, its line stands out; afterwards it is a plain line", async () => {
    const line = async (notice: boolean | null) => {
        const item = find((await setup({ recognition: "needs_setup", notice })).tree, node => node.type === "li");
        assert.ok(item);
        return item.props["data-lead"];
    };
    assert.equal(await line(true), true);
    assert.equal(await line(false), undefined);
    assert.equal(await line(null), undefined, "not known yet: nothing stands out");
    const css = (await import("node:fs")).readFileSync(new URL("./LogBox.module.scss", import.meta.url), "utf8");
    assert.match(css, /\.setup li\[data-lead\] \{[^}]*border: \.1rem solid var\(--primary_600_color\)[^}]*background: var\(--vox_highlight_tint\)/);
    assert.match(css, /\.setup li\[data-lead\] button \{[^}]*background: var\(--primary_600_color\); color: var\(--vox_on_primary\)/);
});

test("the greeting is the heading alone: where to type is left to the composer under it", async () => {
    const s = await setup({ hint: false });
    assert.equal(find(s.tree, node => node.type === "ul"), null);
    assert.deepEqual(s.texts, ["studio.empty_title"]);
    assert.equal(greetingIn(s.tree).props.children.type, "h1");
    // The sentence about where to type is gone from both languages, not only from this screen.
    for (const language of ["en", "ja"]) assert.equal(localeAt(readLocale(language), "studio.empty_description"), undefined, language);
});

test("under the list stands the main window's line about VRChat, which decides by itself when it has something to say", async () => {
    const s = await setup({ needs: [{ id: "translation", weight: { id: "small" }, action: "review" }] });
    assert.deepEqual(s.texts, ["studio.empty_title", "studio.setup_translation", "model_downloads.review", "the line about VRChat"]);
    const line = find(s.tree, node => node.type === "p" && node.props.children === "the line about VRChat");
    assert.ok(line);
    assert.equal(line.props.className, "hint", "drawn in the hint's place and look");
    // The first screen no longer reads whether messages are sent: the line's own part does.
    assert.deepEqual(s.read, ["UiScaling", "UiLanguage"]);
    // Without that part (no main window around it) nothing stands there.
    assert.deepEqual((await setup({ hint: false })).texts, ["studio.empty_title"]);
});

test("the VR panel keeps the greeting alone", async () => {
    const s = await setup({ vr: true, needs: [{ id: "translation", weight: { id: "small" } }] });
    assert.deepEqual(s.texts, ["studio.empty_title"]);
});

test("the greeting keeps its room but is drawn only once the saved UI size and language are in place", async () => {
    const pending = { state: "pending", data: 100 };
    const waiting = await setup({ settings: { UiScaling: pending } });
    assert.equal(greetingIn(waiting.tree).props["data-waiting"], true);
    assert.equal(greetingIn(waiting.tree).props["aria-hidden"], true);
    assert.ok(waiting.texts.includes("studio.empty_title"), "its room is kept");
    const ready = await setup({ settings: { UiScaling: { state: "ok", data: 100 }, UiLanguage: { state: "ok", data: "ja" } } });
    assert.equal(greetingIn(ready.tree).props["data-waiting"], undefined);
    // The VR panel gets its settings from the main window: it never waits.
    const vr = await setup({ vr: true, settings: { UiScaling: pending } });
    assert.equal(greetingIn(vr.tree).props["data-waiting"], undefined);
});

test("the greeting waits for the language and the narrow layout that the saved settings bring", async () => {
    const { greetingWaits } = await loadModule<EmptyStateModule>(new URL("./EmptyState.tsx", import.meta.url), hooks(), {
        "@store": { store: {} },
        "@logics_configs": { useSettingValue: () => null },
        "../../../../../../logics/main/useSetupNeeds": { useSetupNeeds: () => ({ needs: [] }) },
        "../../../../../../logics/setup/useRecognitionState": { useRecognitionState: () => ({ state: "ready" }) },
        "../../../../../../logics/setup/useFirstRunSetup": { useFirstRunSetup: () => ({ openSetup: () => {} }) },
        "../../../../../../logics/setup/firstRunSetup.ts": setupLogic,
        "../../../../../../logics/main/setupNeeds": needsLogic,
        "../../../startupContext": { useStartupPlaceholder: () => null },
        "../../../vrchatHintContext": { useVrchatHint: () => null },
    });
    const ok = <T>(data: T) => ({ state: "ok" as const, data });
    const base = { scaling: ok(100), language: ok("ja"), shownLanguage: "ja", width: 871, narrow: false };
    assert.equal(greetingWaits(base), null);
    assert.equal(greetingWaits({ ...base, scaling: { state: "pending", data: 100 } }), "settings");
    assert.equal(greetingWaits({ ...base, language: { state: "pending", data: "en" } }), "settings");
    assert.equal(greetingWaits({ ...base, shownLanguage: "en" }), "language", "the saved language is not shown yet");
    // At 120% an 871 px window is narrow (at most 960 px): wait until the layout says so.
    assert.equal(greetingWaits({ ...base, scaling: ok(120) }), "layout");
    assert.equal(greetingWaits({ ...base, scaling: ok(120), narrow: true }), null);
    // Within a pixel of the edge either layout counts.
    assert.equal(greetingWaits({ ...base, width: 800.5, narrow: false }), null);
    assert.equal(greetingWaits({ ...base, width: 800.5, narrow: true }), null);
    // On purpose: no width read yet, where the type says a number.
    assert.equal(greetingWaits({ ...base, width: unchecked<number>(undefined) }), null);
});

test("a language or layout that does not follow holds the greeting back for a second at most", async context => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const runtime = hooks();
    const { EmptyState, GREETING_FOLLOW_MS } = await loadModule<EmptyStateModule>(new URL("./EmptyState.tsx", import.meta.url), runtime, {
        "@store": { store: {} },
        "@logics_configs": { useSettingValue: (name: string) => name === "UiScaling" ? { state: "ok", data: 120 }
            : name === "UiLanguage" ? { state: "ok", data: "ja" } : { data: undefined } },
        "../../../../../../logics/main/useSetupNeeds": { useSetupNeeds: () => ({ needs: [] }) },
        "../../../../../../logics/setup/useRecognitionState": { useRecognitionState: () => ({ state: "ready" }) },
        "../../../../../../logics/setup/useFirstRunSetup": { useFirstRunSetup: () => ({ openSetup: () => {} }) },
        "../../../../../../logics/setup/firstRunSetup.ts": setupLogic,
        "../../../../../../logics/main/setupNeeds": needsLogic,
        "../../../startupContext": { useStartupPlaceholder: () => null },
        "../../../vrchatHintContext": { useVrchatHint: () => null },
    });
    const stub = { innerWidth: 871, document: { documentElement: { hasAttribute: () => false } } };
    const saved = Object.fromEntries(Object.keys(stub).map(key => [key, Reflect.get(globalThis, key)]));
    Object.assign(globalThis, stub);
    context.onTestFinished(() => { Object.assign(globalThis, saved); });
    const greeting = () => greetingIn(runtime.render(EmptyState));
    assert.equal(greeting().props["data-waiting"], true, "871 px at 120% is narrow, the root is not marked yet");
    vi.advanceTimersByTime(GREETING_FOLLOW_MS);
    assert.equal(greeting().props["data-waiting"], undefined, "drawn after a second all the same");
    runtime.unmount();
});

test("while the engine starts, the main page's startup list takes the setup list's place", async () => {
    const StartupProgress = () => createElement("p", null, "startup");
    const s = await setup({ startup: createElement(StartupProgress), needs: [{ id: "translation", weight: { id: "small" } }] });
    // The line about VRChat is not drawn either, so VRChat is not asked about before the engine is up.
    assert.deepEqual(s.texts, ["studio.empty_title", "startup"]);
    assert.equal(find(s.tree, node => node.type === "button"), null);
    // The VR panel never shows it.
    assert.deepEqual((await setup({ vr: true, startup: createElement(StartupProgress) })).texts,
        ["studio.empty_title"]);
});
