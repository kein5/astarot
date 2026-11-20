import assert from "node:assert/strict";
import { test, vi } from "vitest";
import i18next from "i18next";
import type { TOptions } from "i18next";
import type { TestContext } from "vitest";
import { hooks, loadModule, find, findIn, unchecked } from "../test/hookHarness.ts";
import type { TreeNode } from "../test/hookHarness.ts";
import { readLocale } from "../test/locales.ts";
import type { DownloadButtonProps, DownloadOption } from "../../views/app/config_page/setting_section/setting_box/_components/_atoms/_download_button/_DownloadButton.tsx";

async function fixture(context: TestContext, language = "en", name = "ctranslate2_weight_type") {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: 0 });
    const runtime = hooks(), messages: string[] = [];
    const translations = i18next.createInstance();
    const resource = readLocale(language);
    await translations.init({ lng: language, resources: { [language]: { translation: resource } } });
    const t = (key: string, values?: TOptions) => { messages.push(key); return translations.t(key, values); };
    const statusHook = await loadModule(new URL("./useLegacyDownloadStatus.ts", import.meta.url), runtime);
    const { CircularProgress } = await loadModule<typeof import("../../views/common_components/circular_progress/CircularProgress.tsx")>(new URL("../../views/common_components/circular_progress/CircularProgress.tsx", import.meta.url), runtime);
    const { _DownloadButton } = await loadModule<typeof import("../../views/app/config_page/setting_section/setting_box/_components/_atoms/_download_button/_DownloadButton.tsx")>(new URL("../../views/app/config_page/setting_section/setting_box/_components/_atoms/_download_button/_DownloadButton.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t }) }, "@common_components": { CircularProgress },
        "../../../../../../../../logics/common/useLegacyDownloadStatus": statusHook,
    });
    const option: DownloadOption = { id: "base", label: "base", progress: null, is_pending: false, is_downloaded: false };
    // The row also passes its setting's name, which the button does not read.
    const props: DownloadButtonProps & { name: string } = { option, name, downloadStartFunction: () => assert.fail("no automatic download") };
    const render = () => { runtime.render(_DownloadButton, props); return runtime.render(_DownloadButton, props); };
    context.onTestFinished(() => runtime.unmount());
    return { option, render, runtime, messages,
        progress: (tree: TreeNode) => {
            const node = find(tree, node => node.type === CircularProgress);
            return node && CircularProgress(node.props).props;
        },
        status: (tree: TreeNode) => findIn(tree, node => node.props?.role === "status").props };
}

// The built-in downloads are the local translation weights; the Whisper ones went with the engine (#288).
for (const language of ["en", "ja"]) for (const kind of ["ctranslate2"]) {
    test(`${language} ${kind}: named progress exposes exact values and keeps pending/finalizing indeterminate`, async context => {
        const s = await fixture(context, language, `${kind}_weight_type`);
        assert.equal(s.status(s.render()).children, "");
        s.option.is_pending = true;
        let tree = s.render();
        let bar = s.progress(tree);
        // The row's own name: the engine's old name is not shown (#565).
        const model = "base";
        assert.equal(bar["aria-label"], language === "en" ? `${model} download` : `${model} のダウンロード`);
        assert.equal(bar["aria-valuenow"], undefined);
        assert.equal(bar["aria-valuemin"], undefined);
        assert.equal(s.status(tree)["aria-live"], "polite");
        assert.equal(s.status(tree)["aria-atomic"], "true");
        assert.ok(s.status(tree).children.includes(model));
        s.option.progress = 42.7;
        tree = s.render(); bar = s.progress(tree);
        assert.equal(bar["aria-valuenow"], 42.7);
        assert.equal(bar["aria-valuemin"], 0);
        assert.equal(bar["aria-valuemax"], 100);
        assert.ok(s.status(tree).children.includes("40%"));
        s.option.progress = 100;
        tree = s.render(); bar = s.progress(tree);
        assert.equal(bar["aria-valuenow"], undefined);
        assert.equal(bar["aria-valuemax"], undefined);
        assert.ok(!s.status(tree).children.includes("100%"));
        const finishing = s.status(tree).children;
        s.option.progress = null; s.option.is_pending = false; s.option.is_downloaded = true;
        tree = s.render();
        assert.equal(s.progress(tree), null);
        assert.notEqual(s.status(tree).children, finishing);
        assert.ok(s.status(tree).children.includes(model));
    });
}

test("percent announcements are bucketed and throttled, with a trailing update and immediate phases", async context => {
    const s = await fixture(context);
    s.option.progress = 0;
    let last = s.status(s.render()).children;
    for (let percent = 1; percent <= 29; percent++) {
        vi.advanceTimersByTime(20);
        s.option.progress = percent;
        assert.equal(s.status(s.render()).children, last);
        assert.equal(s.progress(s.render())["aria-valuenow"], percent);
    }
    vi.advanceTimersByTime(419); // 999ms
    assert.equal(s.status(s.render()).children, last);
    vi.advanceTimersByTime(1);
    last = s.status(s.render()).children;
    assert.ok(last.includes("20%"));
    s.option.progress = 30; s.render();
    vi.advanceTimersByTime(100);
    s.option.progress = 100;
    const finishing = s.status(s.render()).children;
    assert.notEqual(finishing, last);
    vi.advanceTimersByTime(2000);
    assert.equal(s.status(s.render()).children, finishing, "stale percentage is cancelled on phase change");
    s.option.progress = null; s.option.is_pending = false;
    assert.equal(s.status(s.render()).children, "base download stopped.");
});

test("an already installed model stays quiet; unmount cancels pending announcements", async context => {
    const s = await fixture(context);
    s.option.is_downloaded = true;
    assert.equal(s.status(s.render()).children, "");
    s.option.progress = 0; s.render();
    s.option.progress = 10; s.render();
    s.runtime.unmount();
    const count = s.messages.length;
    vi.advanceTimersByTime(2000);
    assert.equal(s.messages.length, count);
});

test("shared circular progress clamps determinate values and omits unknown values", async () => {
    const { CircularProgress } = await loadModule<typeof import("../../views/common_components/circular_progress/CircularProgress.tsx")>(new URL("../../views/common_components/circular_progress/CircularProgress.tsx", import.meta.url), hooks());
    const cases: [number | null, number | undefined][] = [[-5, 0], [108, 100], [NaN, undefined], [null, undefined]];
    for (const [value, expected] of cases) {
        // On purpose: null, a value the backend has not sent.
        const tree = CircularProgress({ variant: "determinate", value: unchecked<number>(value), "aria-label": "Test download" });
        assert.equal(tree.props["aria-valuenow"], expected);
        const svg = find(tree, node => node.type === "svg");
        assert.ok(svg);
        assert.equal(svg.props["aria-hidden"], "true");
    }
});
