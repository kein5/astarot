import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'vitest';
import type { TestContext } from 'vitest';
import { hooks, loadModule, eventTarget, stubGlobals, unchecked, findIn, setRef } from '../../logics/test/hookHarness.ts';
import { deferred, flush } from '../../logics/test/bridgeHarness.ts';
import * as chatboxLength from '../../logics/common/chatboxLength.ts';
import * as themes from '../../logics/theme/themes.ts';
import type { ThemeSetting } from '../../logics/theme/themes.ts';
import type { QuickChatBridge } from './QuickChat.tsx';

// A callback the window registers; calling it before that stops with a TypeError.
const notYet = async (_event?: unknown): Promise<void> => { throw new TypeError('the window has not registered this callback'); };

async function setup(testContext: TestContext) {
    const runtime = hooks(), properties = new Map<string, string>(), removals: string[] = [], submissions: unknown[] = [];
    const callbacks: { open: (event?: unknown) => unknown; context: (event?: unknown) => unknown } = { open: notYet, context: notYet };
    let context: { language: string; enter_to_send: boolean; clear_on_send: boolean; ui_scaling: number; font_family: string; theme?: ThemeSetting | null } = {
        language: 'ja', enter_to_send: true, clear_on_send: true, ui_scaling: 150, font_family: 'Noto Sans JP', theme: null,
    };
    let focusCount = 0, hideCount = 0, contextRead: () => Promise<unknown> = () => Promise.resolve(context);
    const field = { focus: () => focusCount++ };
    const i18n = { changeLanguage: async () => {} };
    const window = eventTarget();
    stubGlobals(testContext, { window, document: { documentElement: { style: {
        setProperty: (key: string, value: string) => properties.set(key, value),
        removeProperty: (key: string) => properties.delete(key),
    } } } });
    const fake = {
        context: () => contextRead(),
        onOpen: async (callback: (event?: unknown) => unknown) => { callbacks.open = callback; return () => removals.push('open'); },
        onContextChanged: async (callback: (event?: unknown) => unknown) => { callbacks.context = callback; return () => removals.push('context'); },
        hide: async () => { hideCount++; },
        submit: (request: unknown): Promise<boolean> => { submissions.push(request); return fake.handoff.promise; },
        handoff: deferred<boolean>(),
    };
    // On purpose: the test calls the window's open and context callbacks with or without an event;
    // the bridge's declared callbacks always take one. The contexts carry only the settings the
    // window applies.
    const bridge = unchecked<QuickChatBridge>(fake);
    const { QuickChat } = await loadModule<typeof import('./QuickChat.tsx')>(new URL('./QuickChat.tsx', import.meta.url), runtime, {
        '@useI18n': { useI18n: () => ({ t: (key: string) => key, i18n }) },
        '../../logics/quickChat/bridge': { quickChatBridge: bridge },
        '../../logics/common/chatboxLength': chatboxLength,
        '../../logics/theme/themes.ts': themes,
    });
    const render = () => runtime.render(QuickChat, { bridge }, tree => {
        setRef(tree, {});
        setRef(findIn(tree, node => node.type === 'textarea'), field);
    });
    render(); await flush(); render();
    return { runtime, render, properties, callbacks, removals, bridge: fake, submissions,
        setContext: (next: Partial<typeof context>) => { context = { ...context, ...next }; },
        setRead: (read: () => Promise<unknown>) => { contextRead = read; },
        get focusCount() { return focusCount; }, get hideCount() { return hideCount; },
        field: () => findIn(render(), node => node.type === 'textarea').props,
    };
}

test('Quick Chat applies saved scale and a literal local font, then updates without stealing focus or changing the draft', async t => {
    const subject = await setup(t);
    assert.equal(subject.properties.get('font-size'), '93.75%');
    assert.equal(subject.properties.get('--font_family'), '"Noto Sans JP"');
    subject.field().onChange({ target: { value: '書きかけの日本語' } });
    const before = subject.focusCount;
    const font = 'Local "Quoted" \\ Font';
    subject.setContext({ ui_scaling: 200, font_family: font });
    await subject.callbacks.context({ payload: { ui_scaling: 40, font_family: 'ignored' } });
    subject.render();
    assert.equal(subject.properties.get('font-size'), '125%');
    assert.equal(subject.properties.get('--font_family'), JSON.stringify(font));
    assert.equal(subject.field().value, '書きかけの日本語');
    assert.equal(subject.focusCount, before);
    await subject.callbacks.open();
    assert.equal(subject.focusCount, before + 1);
    subject.runtime.unmount(); await flush();
    assert.deepEqual(subject.removals.sort(), ['context', 'open']);
});

test('an older context read cannot overwrite a later settings update', async t => {
    const subject = await setup(t), older = deferred();
    const before = subject.focusCount;
    subject.setRead(() => older.promise);
    const opening = subject.callbacks.open();
    subject.setRead(async () => ({ language: 'ja', ui_scaling: 180, font_family: 'New font' }));
    await subject.callbacks.context();
    older.resolve({ language: 'en', ui_scaling: 100, font_family: 'Old font' });
    await opening;
    subject.render();
    assert.equal(subject.properties.get('font-size'), '112.5%');
    assert.equal(subject.properties.get('--font_family'), '"New font"');
    assert.equal(subject.focusCount, before + 1); // The outstanding open still focuses once.
    subject.runtime.unmount();
});

test('appearance updates preserve Quick Chat IME, repeat, pending and failed-handoff draft guards', async t => {
    const subject = await setup(t);
    subject.field().onChange({ target: { value: 'こんにちは' } });
    const enter = (extra?: object) => subject.field().onKeyDown({ key: 'Enter', nativeEvent: {}, preventDefault() {}, ...extra });
    subject.field().onCompositionStart(); enter(); subject.field().onCompositionEnd();
    enter({ nativeEvent: { isComposing: true } }); enter({ keyCode: 229 }); enter({ repeat: true }); enter({ shiftKey: true });
    assert.equal(subject.submissions.length, 0);
    enter(); enter();
    assert.equal(subject.submissions.length, 1);
    subject.setContext({ ui_scaling: 160 }); await subject.callbacks.context();
    subject.render().props.onKeyDown({ key: 'Escape', nativeEvent: {}, preventDefault() {} });
    assert.equal(subject.hideCount, 1);
    assert.equal(subject.field().value, 'こんにちは');
    subject.bridge.handoff.resolve(false); await flush();
    assert.equal(subject.field().value, 'こんにちは');
    assert.equal(subject.submissions.length, 1);
    subject.runtime.unmount();
});

test('minimum-size layout keeps scrollable overflow, wrapping actions and nonshrinking status text', async () => {
    const css = await readFile(new URL('./QuickChat.css.ts', import.meta.url), 'utf8');
    assert.match(css, /height: "100%",[^\n]*overflow: "auto"/);
    assert.match(css, /textarea`, \{\s*flex: 1, minHeight: "3rem"/);
    assert.match(css, /export const actions = style\(\{\s*display: "flex", flexWrap: "wrap", flexShrink: 0/);
    assert.match(css, /export const length_warning = style\(\{\s*display: "flex", flexWrap: "wrap", flexShrink: 0/);
    assert.doesNotMatch(css, /https?:|fontFace/);
});

test('Quick Chat follows the selected preset and custom theme, and resets to the default theme without stealing focus', async t => {
    const subject = await setup(t);
    assert.equal(subject.properties.has('--vox_canvas'), false);
    const before = subject.focusCount;
    subject.field().onChange({ target: { value: '下書き' } });
    subject.setContext({ theme: { preset: 'forest', custom: { base: '#261633', accent: '#a47af5' } } });
    await subject.callbacks.context();
    subject.render();
    const forest = themes.deriveTokens(themes.PRESETS.find(preset => preset.id === 'forest')?.colors ?? themes.PRESETS[0].colors);
    assert.equal(subject.properties.get('--vox_canvas'), forest['--vox_canvas']);
    assert.equal(subject.properties.get('--primary_600_color'), forest['--primary_600_color']);
    assert.equal(subject.field().value, '下書き');
    assert.equal(subject.focusCount, before);
    // Custom colours while the window stays open.
    subject.setContext({ theme: { preset: 'custom', custom: { base: '#10272b', accent: '#3fc8c2' } } });
    await subject.callbacks.context();
    subject.render();
    const custom = themes.deriveTokens({ base: '#10272b', accent: '#3fc8c2' });
    assert.equal(subject.properties.get('--vox_canvas'), custom['--vox_canvas']);
    // Back to Dark Plum: theme overrides are cleared while scale and font remain.
    subject.setContext({ theme: { preset: 'dark_plum', custom: { base: '#10272b', accent: '#3fc8c2' } } });
    await subject.callbacks.context();
    subject.render();
    assert.equal(subject.properties.has('--vox_canvas'), false);
    assert.equal(subject.properties.get('font-size'), '93.75%');
    assert.equal(subject.properties.get('--font_family'), '"Noto Sans JP"');
    subject.runtime.unmount(); await flush();
});

test('main publishes saved appearance on initial configuration and later changes', async () => {
    const runtime = hooks(), contexts: { ui_scaling: number; font_family: string; theme: ThemeSetting | null }[] = [];
    let scale = 150, font = 'Noto Sans JP';
    let theme: ThemeSetting = { preset: 'midnight', custom: { base: '#261633', accent: '#a47af5' } };
    const { QuickChatController } = await loadModule<typeof import('../app/_app_controllers/QuickChatController.tsx')>(new URL('../app/_app_controllers/QuickChatController.tsx', import.meta.url), runtime, {
        '@tauri-apps/api/core': { invoke: async (name: string, args: { context: { ui_scaling: number; font_family: string; theme: ThemeSetting | null } }) => { if (name === 'quick_chat_configure') contexts.push(args.context); } },
        '@tauri-apps/api/event': { listen: async () => () => {} },
        '@useI18n': { useI18n: () => ({ i18n: { language: 'ja' } }) },
        '../../../logics/common/useMessage': { useMessage: () => ({ sendMessage() { assert.fail('configuration must not send'); } }) },
        '../../../logics/theme/themes.ts': themes,
        '@logics_common': {
            useIsBackendReady: () => ({ currentIsBackendReady: { data: true } }),
            useIsOpenedConfigPage: () => ({ currentIsOpenedConfigPage: { data: false } }),
            useIsSoftwareUpdating: () => ({ currentIsSoftwareUpdating: { data: false } }),
        },
        '@logics_configs': {
            useAppearance: () => ({ currentSendMessageButtonType: { data: 'show' }, currentUiScaling: { data: scale }, currentSelectedFontFamily: { data: font }, currentTheme: { data: theme } }),
            useOthers: () => ({ currentEnableAutoClearMessageInputBox: { data: true } }),
        },
    });
    runtime.render(QuickChatController); await flush();
    assert.equal(contexts[0].ui_scaling, 150);
    assert.equal(contexts[0].font_family, 'Noto Sans JP');
    assert.deepEqual(contexts[0].theme, theme);
    scale = 200; font = 'Local font';
    theme = { preset: 'custom', custom: { base: '#15261c', accent: '#62c98c' } };
    runtime.render(QuickChatController); await flush();
    assert.equal(contexts.at(-1)?.ui_scaling, 200);
    assert.equal(contexts.at(-1)?.font_family, 'Local font');
    assert.deepEqual(contexts.at(-1)?.theme, theme);
    runtime.unmount();
});

test('the Quick Chat box shows the same hint as the main window composer while it is empty', async t => {
    const subject = await setup(t);
    assert.equal(subject.field().placeholder, 'studio.message_placeholder');
    assert.equal(subject.field()['aria-label'], 'quick_chat.message');
    subject.runtime.unmount(); await flush();
});
