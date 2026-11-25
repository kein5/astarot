import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { find, findIn, hooks, kitStandIns, loadModule, nodesIn, treeNode } from "../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../logics/test/hookHarness.ts";

// The setup of a voice engine's runtime (VcRuntimeSetup.tsx): what the section says about the
// runtime, its download and its job, and the review that starts it. The runtimes hook is a stand-in
// that holds the catalog and the jobs the test gives and records what the section sends; the kit's
// Button and Badge are the elements they stand for, with the props the section gives them, and its
// Progress the harness's stand-in.

// useVcRuntimes.ts's list: that module is not loaded here, for its own imports.
const activeSetupPhases = ["queued", "tools", "python", "packages", "engine", "libraries", "assets", "verifying", "cancelling"];
// A runtime may word some things its own way (`<key>_<notice>`); these are the ones it does here.
const OWN = new Set(["vc_runtime.phase_engine_rvc_gpu", "vc_runtime.no_start_rvc_gpu", "vc_runtime.errors.disk_full_rvc_gpu"]);
const t = (key: string, variables?: Record<string, unknown>) => {
    const { defaultValue, ...values } = variables ?? {};
    const missing = ((key.endsWith("_rvc_gpu") || key.endsWith("_plain")) && !OWN.has(key) && defaultValue !== undefined) || key.includes("absent");
    if (missing) return String(defaultValue ?? key);
    return Object.keys(values).length ? `${key} ${JSON.stringify(values)}` : key;
};
const entry = { id: "rvc", name: "RVC", version: "3", license: "MIT", licenses: ["https://example.com/license", "https://example.com/notice"], notice: "rvc_gpu",
    download_bytes: 1.2e9, disk_bytes: 2.5e9, destination: "C:/state/vc_runtimes/rvc", gpu_ready: true, requires_gpu: false, device: "cuda" };
type Job = Record<string, unknown>;
interface Runtimes { catalog: unknown; state: { observation_id: string; jobs: Record<string, Job>; installed: Record<string, string> }; error: string | null; pending: boolean }

async function runtimeSetup(context: TestContext, given: Partial<Runtimes> = {}, options: { hints?: boolean; tauri?: boolean; openUrl?: (url: string) => Promise<void> } = {}) {
    const runtime = hooks(), sent: unknown[][] = [], opened: string[] = [], consent = { asked: [] as unknown[][], closed: 0 };
    context.onTestFinished(() => runtime.unmount());
    const runtimes: Runtimes = { catalog: { runtimes: [entry] }, state: { observation_id: "1", jobs: {}, installed: {} }, error: null, pending: false, ...given };
    const hook = { send: (...args: unknown[]) => { sent.push(args); } };
    const module = await loadModule<typeof import("./VcRuntimeSetup.tsx")>(new URL("./VcRuntimeSetup.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t }) },
        "@tauri-apps/api/core": { isTauri: () => options.tauri ?? false },
        "@tauri-apps/plugin-opener": { openUrl: options.openUrl ?? (async (url: string) => { opened.push(url); }) },
        "../../../../../../logics/voice/useVcRuntimes": { activeSetupPhases, useVcRuntimes: () => ({ ...runtimes, send: hook.send }) },
        "../../../../../../logics/common/useConsentDialog": { useConsentDialog: (...args: unknown[]) => { consent.asked.push(args); return { dialog: "dialog", close: () => { consent.closed++; } }; } },
        "../_components/env_readout/EnvReadout": { EnvReadout: "readout" },
        "../_components/hint/Hint": { Hint: "hint", useHintDescriptions: () => options.hints ?? false },
        "../../../../../kit/index.ts": { Button: "button", Badge: "badge", Progress: kitStandIns.Progress },
    });
    let props: Record<string, unknown> = { engine: "rvc" };
    const drawOrNothing = (next: Record<string, unknown> = {}) => {
        props = { ...props, ...next };
        return runtime.render(module.VcRuntimeSetup, { engine: "rvc", ...props });
    };
    // The section, which a test that draws it expects to be there.
    const draw = (next: Record<string, unknown> = {}): TreeNode => {
        const tree = drawOrNothing(next);
        assert.ok(tree, "the section");
        return tree;
    };
    return { runtimes, hook, sent, opened, consent, draw, drawOrNothing };
}

// The words a part of the tree shows.
const textOf = (value: unknown): string => {
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (Array.isArray(value)) return value.map(textOf).join("");
    const node = treeNode(value);
    return node ? textOf(node.props.children) : "";
};
const lines = (tree: unknown) => nodesIn(tree).filter(node => node.type === "p").map(node => [node.props.role, textOf(node)]);
const buttonNamed = (tree: unknown, words: string) => findIn(tree, node => node.type === "button" && textOf(node) === words, `the button ${words}`);
const buttons = (tree: unknown) => nodesIn(tree).filter(node => node.type === "button").map(node => [textOf(node), node.props.disabled, node.props.tone]);
const SIZE = `vc_runtime.size {"download":"1.2 GB","disk":"2.5 GB"}`;

test("the section is there only for a runtime the catalog offers, and asks for the catalog and the state, and again on a new connection", async context => {
    const r = await runtimeSetup(context, { catalog: null });
    assert.equal(r.drawOrNothing(), null);
    assert.deepEqual(r.sent, [["/get/data/vc_runtime_catalog"], ["/get/data/vc_runtime_state"]]);
    r.drawOrNothing();
    assert.equal(r.sent.length, 2);
    r.hook.send = (...args: unknown[]) => { r.sent.push(["new", ...args]); };
    r.drawOrNothing();
    assert.deepEqual(r.sent.slice(2), [["new", "/get/data/vc_runtime_catalog"], ["new", "/get/data/vc_runtime_state"]]);
    r.runtimes.catalog = { runtimes: [entry] };
    assert.equal(r.drawOrNothing({ engine: "seed-vc" }), null, "another engine's runtime");
    r.runtimes.catalog = {};
    assert.equal(r.drawOrNothing({ engine: "rvc" }), null, "a catalog without runtimes");
});

test("a runtime not yet set up names itself, says what it holds, its size and license, and offers its review", async context => {
    const r = await runtimeSetup(context);
    const tree = r.draw();
    assert.deepEqual([tree.type, tree.props.tabIndex, tree.props["aria-label"], tree.props["data-fit"], tree.props["aria-describedby"]],
        ["section", -1, `vc_runtime.title {"name":"RVC"}`, undefined, undefined]);
    assert.deepEqual(nodesIn(tree).filter(node => node.type === "strong").map(textOf), [`vc_runtime.title {"name":"RVC"}`]);
    assert.deepEqual(lines(tree), [[undefined, "vc_runtime.help_rvc_gpu"], [undefined, `${SIZE} · MIT`]]);
    assert.deepEqual(buttons(tree), [["vc_runtime.review", false, "plain"]]);
    assert.equal(find(tree, node => node.type === "readout"), null);
});

test("on a page that shows descriptions as hints, what the runtime holds is its title's hint", async context => {
    const r = await runtimeSetup(context, {}, { hints: true });
    const tree = r.draw();
    const host = findIn(tree, node => node.props?.["data-hint-host"] === true);
    const hint = findIn(host, node => node.type === "hint").props;
    assert.deepEqual([textOf(findIn(host, node => node.type === "strong")), hint.text, hint.focusable, tree.props["aria-describedby"]],
        [`vc_runtime.title {"name":"RVC"}`, "vc_runtime.help_rvc_gpu", true, hint.id]);
    assert.deepEqual(lines(tree), [[undefined, `${SIZE} · MIT`]]);
});

test("one of a pair of builds says whether it fits the GPU; the one that fits leads, the one not needed has no help and no download", async context => {
    const r = await runtimeSetup(context, {}, { hints: true });
    let tree = r.draw({ fit: "fits" });
    assert.equal(tree.props["data-fit"], "fits");
    // The accent tone for the build that fits.
    const badge = (node: TreeNode) => findIn(node, item => item.type === "badge" && textOf(item).startsWith("vc_runtime.fit_"));
    assert.deepEqual([badge(tree).props.tone, textOf(badge(tree))], ["accent", "vc_runtime.fit_fits"]);
    assert.deepEqual(buttons(tree), [["vc_runtime.review", false, "primary"]]);
    tree = r.draw({ fit: "unneeded" });
    assert.deepEqual([badge(tree).props.tone, textOf(badge(tree)), tree.props["aria-describedby"]], ["neutral", "vc_runtime.fit_unneeded", undefined]);
    assert.equal(find(tree, node => node.type === "hint"), null);
    assert.deepEqual(buttons(tree), []);
    const plain = await runtimeSetup(context);
    assert.deepEqual(lines(plain.draw({ fit: "unneeded" })), [[undefined, `${SIZE} · MIT`]], "no help either where descriptions stay in sight");
});

test("the section warns about an outdated saved folder, a missing NVIDIA GPU, and says what the CPU runtime means", async context => {
    const r = await runtimeSetup(context);
    assert.deepEqual(lines(r.draw({ current: entry.destination }))[1], ["alert", "vc_runtime.outdated"]);
    assert.equal(lines(r.draw({ current: "D:/other" })).some(([, words]) => words === "vc_runtime.outdated"), false);
    r.runtimes.catalog = { runtimes: [{ ...entry, requires_gpu: true, gpu_ready: false }] };
    let tree = r.draw();
    assert.ok(lines(tree).some(([role, words]) => role === "alert" && words === "vc_runtime.gpu_missing"));
    assert.deepEqual(buttons(tree), [["vc_runtime.review", true, "plain"]], "without the GPU it needs, no review");
    r.runtimes.catalog = { runtimes: [{ ...entry, requires_gpu: undefined, gpu_ready: false }] };
    assert.ok(lines(r.draw()).some(([, words]) => words === "vc_runtime.gpu_missing"), "a GPU is needed unless the catalog says otherwise");
    r.runtimes.catalog = { runtimes: [{ ...entry, requires_gpu: undefined, gpu_ready: true }] };
    assert.deepEqual(buttons(r.draw()), [["vc_runtime.review", false, "plain"]], "a GPU that is ready lets it be reviewed");
    r.runtimes.catalog = { runtimes: [{ ...entry, device: "cpu", gpu_ready: false }] };
    tree = r.draw();
    assert.deepEqual(lines(tree).slice(1), [[undefined, `${SIZE} · MIT`], [undefined, "vc_runtime.cpu_only"]]);
    assert.deepEqual(buttons(tree), [["vc_runtime.review", false, "plain"]], "a CPU runtime needs no GPU");
    // Once installed, none of these.
    r.runtimes.state = { observation_id: "2", jobs: {}, installed: { rvc: "C:/rvc" } };
    r.runtimes.catalog = { runtimes: [{ ...entry, device: "cpu", requires_gpu: true, gpu_ready: false }] };
    assert.deepEqual(lines(r.draw({ current: entry.destination })).slice(1), [[undefined, "vc_runtime.installed: C:/rvc"]]);
});

test("a setup that runs reads out its step and progress, can be cancelled, and keeps every review closed", async context => {
    const r = await runtimeSetup(context, { state: { observation_id: "1", jobs: { rvc: { job_id: "j", phase: "packages", step: 2, steps: 5, received_bytes: 3, total_bytes: 9 } }, installed: {} } });
    let tree = r.draw();
    const readout = () => findIn(r.draw(), node => node.type === "readout");
    assert.deepEqual([readout().props.tone, readout().props.progress, textOf(readout())], ["neutral", "working", "vc_runtime.phase_packages · 2 / 5"]);
    const bar = findIn(tree, node => node.type === kitStandIns.Progress).props;
    assert.deepEqual([bar["aria-label"], bar.value, bar.max], ["vc_runtime.progress", 3, 9]);
    assert.deepEqual(buttons(tree), [["vc_runtime.cancel", false, undefined]]);
    buttonNamed(tree, "vc_runtime.cancel").props.onClick();
    assert.deepEqual(r.sent.at(-1), ["/run/cancel_vc_runtime_setup", { id: "rvc", job_id: "j" }]);
    assert.equal(lines(tree).some(([, words]) => words.startsWith("vc_runtime.size")), true, "not installed yet");
    // A step without a download counts steps; the first step says no count; a runtime's own words for a phase.
    r.runtimes.state = { observation_id: "2", jobs: { rvc: { job_id: "j", phase: "engine", step: 0, steps: 5, received_bytes: 0, total_bytes: 0 } }, installed: {} };
    tree = r.draw();
    assert.equal(textOf(readout()), "vc_runtime.phase_engine_rvc_gpu");
    r.runtimes.state = { observation_id: "3", jobs: { rvc: { job_id: "j", phase: "libraries", step: 3, steps: 5, received_bytes: 7, total_bytes: 0 } }, installed: {} };
    const counted = findIn(r.draw(), node => node.type === kitStandIns.Progress).props;
    assert.deepEqual([counted.value, counted.max], [3, 5], "nothing downloaded in this step: its steps are counted");
    // Cancelling: no progress shown as working, no second cancel; another request waiting: no cancel either.
    r.runtimes.state = { observation_id: "3", jobs: { rvc: { job_id: "j", phase: "cancelling", step: 3, steps: 5, received_bytes: 0, total_bytes: 0 } }, installed: {} };
    assert.deepEqual([readout().props.progress, buttons(r.draw())], [undefined, [["vc_runtime.cancel", true, undefined]]]);
    r.runtimes.state = { observation_id: "4", jobs: { rvc: { job_id: "j", phase: "verifying", step: 4, steps: 5, received_bytes: 0, total_bytes: 0 } }, installed: {} };
    r.runtimes.pending = true;
    assert.deepEqual(buttons(r.draw()), [["vc_runtime.cancel", true, undefined]]);
    // Another runtime's setup keeps this one's review closed.
    const other = await runtimeSetup(context, { state: { observation_id: "1", jobs: { "seed-vc": { job_id: "k", phase: "assets", step: 1, steps: 2, received_bytes: 0, total_bytes: 0 } }, installed: {} } });
    assert.deepEqual(buttons(other.draw()), [["vc_runtime.review", true, "plain"]]);
    const waiting = await runtimeSetup(context, { pending: true });
    assert.deepEqual(buttons(waiting.draw()), [["vc_runtime.review", true, "plain"]]);
});

test("a setup that ended says how: ready, failed with its reason, waiting for a restart, or installed with a warning", async context => {
    const job = (extra: Job) => ({ job_id: "j", step: 5, steps: 5, received_bytes: 0, total_bytes: 0, ...extra });
    const view = async (extra: Job, installed: Record<string, string> = {}, given: Partial<Runtimes> = {}) => {
        const r = await runtimeSetup(context, { state: { observation_id: "1", jobs: { rvc: job(extra) }, installed }, ...given });
        const tree = r.draw();
        const readout = findIn(tree, node => node.type === "readout");
        return { tone: readout.props.tone, progress: readout.props.progress, words: textOf(readout), lines: lines(tree), buttons: buttons(tree), bar: find(tree, node => node.type === kitStandIns.Progress) };
    };
    const ready = await view({ phase: "ready" }, { rvc: "C:/rvc" });
    assert.deepEqual([ready.tone, ready.progress, ready.words, ready.bar], ["active", "done", "vc_runtime.phase_ready", null]);
    const failed = await view({ phase: "failed", error_code: "download_failed" });
    assert.deepEqual([failed.tone, failed.progress, failed.lines.filter(([role]) => role === "alert")], ["failed", undefined, [["alert", "vc_runtime.errors.download_failed"]]]);
    assert.deepEqual(failed.buttons, [["vc_runtime.resume", false, "plain"]], "a failed setup can be resumed");
    assert.deepEqual((await view({ phase: "failed", error_code: "disk_full" })).lines.filter(([role]) => role === "alert"), [["alert", "vc_runtime.errors.disk_full_rvc_gpu"]],
        "in the runtime's own words");
    assert.deepEqual((await view({ phase: "failed", error_code: "absent_code" })).lines.filter(([role]) => role === "alert"), [["alert", "vc_runtime.errors.vc_runtime_failed"]]);
    const restart = await view({ phase: "restart_required" });
    assert.deepEqual([restart.tone, restart.words, restart.buttons], ["neutral", "vc_runtime.phase_restart_required", []], "starting again would only wait again");
    const warned = await view({ phase: "ready", warning_code: "gpu_check_failed" }, { rvc: "C:/rvc" });
    assert.ok(warned.lines.some(([role, words]) => role === "status" && words === "vc_runtime.warnings.gpu_check_failed"));
    // An error of the setup's requests, said under the readout.
    const refused = await view({ phase: "failed" }, {}, { error: "absent_request" });
    assert.ok(refused.lines.some(([role, words]) => role === "alert" && words === "vc_runtime.errors.vc_runtime_failed"));
});

test("an installed runtime says where it is and offers to use it in the form unless the form holds it already", async context => {
    const used: string[] = [];
    const r = await runtimeSetup(context, { state: { observation_id: "1", jobs: {}, installed: { rvc: "C:/state/rvc" } } });
    let tree = r.draw({ onUse: (path: string) => { used.push(path); }, current: "D:/old" });
    const where = findIn(tree, node => node.type === "code");
    assert.deepEqual([textOf(where), where.props.style], ["C:/state/rvc", { overflowWrap: "anywhere" }]);
    assert.deepEqual(buttons(tree), [["vc_runtime.use", undefined, undefined]]);
    buttonNamed(tree, "vc_runtime.use").props.onClick();
    assert.deepEqual(used, ["C:/state/rvc"]);
    assert.equal(buttonNamed(r.draw({ disabled: true }), "vc_runtime.use").props.disabled, true);
    tree = r.draw({ current: "C:/state/rvc", disabled: false });
    assert.deepEqual(buttons(tree), []);
    assert.deepEqual(buttons(r.draw({ onUse: undefined, current: "D:/old" })), [], "the translation's runtimes are chosen elsewhere");
});

test("the review says what will be fetched and from where, and starts only once the consent is ticked", async context => {
    const r = await runtimeSetup(context);
    let tree = r.draw();
    assert.deepEqual(r.consent.asked.at(-1), [false, tree.props.ref]);
    buttonNamed(tree, "vc_runtime.review").props.onClick();
    tree = r.draw();
    assert.deepEqual(r.consent.asked.at(-1), [true, tree.props.ref]);
    const dialog = findIn(tree, node => node.type === "dialog");
    assert.deepEqual([dialog.props.ref, dialog.props["aria-label"]], ["dialog", "vc_runtime.warning_title"]);
    assert.deepEqual(nodesIn(dialog).filter(node => node.type === "h3").map(textOf), ["vc_runtime.warning_title"]);
    assert.deepEqual(lines(findIn(dialog, node => node.type === "div")).map(([, words]) => words), ["vc_runtime.notice_rvc_gpu", SIZE, "vc_runtime.connection_notice_rvc_gpu",
        "vc_runtime.no_start_rvc_gpu", "model_downloads.license_links:  https://example.com/license  https://example.com/notice ", "model_downloads.destination: C:/state/vc_runtimes/rvc"]);
    assert.deepEqual(nodesIn(dialog).filter(node => node.type === "a").map(link => [link.props.href, link.props.target, link.props.rel, link.props.style]),
        entry.licenses.map(url => [url, "_blank", "noreferrer", { overflowWrap: "anywhere" }]));
    assert.deepEqual(nodesIn(dialog).filter(node => node.type === "code").map(code => [textOf(code), code.props.style]), [[entry.destination, { overflowWrap: "anywhere" }]]);
    const start = () => buttonNamed(findIn(r.draw(), node => node.type === "dialog"), "vc_runtime.start");
    assert.equal(start().props.disabled, true);
    start().props.onClick();
    assert.equal(r.sent.some(call => call[0] === "/run/start_vc_runtime_setup"), false);
    const box = findIn(dialog, node => node.type === "input");
    assert.deepEqual([box.props.type, box.props.checked], ["checkbox", false]);
    assert.equal(textOf(findIn(dialog, node => node.type === "label")), "vc_runtime.consent");
    box.props.onChange({ target: { checked: true } });
    assert.equal(start().props.disabled, false);
    r.runtimes.pending = true;
    assert.equal(start().props.disabled, true, "not while another request waits");
    start().props.onClick();
    assert.equal(r.sent.some(call => call[0] === "/run/start_vc_runtime_setup"), false);
    r.runtimes.pending = false;
    start().props.onClick();
    assert.deepEqual(r.sent.at(-1), ["/run/start_vc_runtime_setup", { id: "rvc", consent: true, version: "3" }]);
    assert.equal(r.consent.closed, 1);
    assert.equal(find(r.draw(), node => node.type === "dialog"), null);
    // Opened again, nothing is ticked; Back and Escape close it.
    buttonNamed(r.draw(), "vc_runtime.review").props.onClick();
    assert.equal(findIn(r.draw(), node => node.type === "input").props.checked, false);
    const back = buttonNamed(findIn(r.draw(), node => node.type === "dialog"), "model_downloads.back");
    assert.equal(back.props.autoFocus, true);
    back.props.onClick();
    assert.equal(find(r.draw(), node => node.type === "dialog"), null);
    buttonNamed(r.draw(), "vc_runtime.review").props.onClick();
    let prevented = 0;
    findIn(r.draw(), node => node.type === "dialog").props.onCancel({ preventDefault: () => { prevented++; } });
    assert.deepEqual([prevented, find(r.draw(), node => node.type === "dialog"), r.consent.closed], [1, null, 3]);
});

test("the review's license links open in the system browser in the app, and one that fails to open is shown to copy", async context => {
    const click = async (options: Parameters<typeof runtimeSetup>[2], index: number) => {
        const r = await runtimeSetup(context, {}, options);
        buttonNamed(r.draw(), "vc_runtime.review").props.onClick();
        let prevented = 0;
        await nodesIn(findIn(r.draw(), node => node.type === "dialog")).filter(node => node.type === "a")[index].props.onClick({ preventDefault: () => { prevented++; } });
        const alert = find(findIn(r.draw(), node => node.type === "dialog"), node => node.props?.role === "alert");
        return { r, prevented, opened: r.opened, alert: alert && [lines(alert).map(([, words]) => words), textOf(findIn(alert, node => node.type === "code")), findIn(alert, node => node.type === "code").props.style] };
    };
    assert.deepEqual((await click({}, 0)).prevented, 0, "outside the app the page's own link opens");
    const app = await click({ tauri: true }, 1);
    assert.deepEqual([app.prevented, app.opened, app.alert], [1, ["https://example.com/notice"], null]);
    let fail = true;
    const failing = await click({ tauri: true, openUrl: async () => { if (fail) throw new Error("no browser"); } }, 0);
    assert.deepEqual(failing.alert, [["model_downloads.link_error"], "https://example.com/license", { overflowWrap: "anywhere" }]);
    fail = false;
    await nodesIn(findIn(failing.r.draw(), node => node.type === "dialog")).filter(node => node.type === "a")[0].props.onClick({ preventDefault() {} });
    assert.equal(find(findIn(failing.r.draw(), node => node.type === "dialog"), node => node.props?.role === "alert"), null, "one that opens clears it");
    fail = true;
    await nodesIn(findIn(failing.r.draw(), node => node.type === "dialog")).filter(node => node.type === "a")[0].props.onClick({ preventDefault() {} });
    buttonNamed(findIn(failing.r.draw(), node => node.type === "dialog"), "model_downloads.back").props.onClick();
    buttonNamed(failing.r.draw(), "vc_runtime.review").props.onClick();
    assert.equal(find(findIn(failing.r.draw(), node => node.type === "dialog"), node => node.props?.role === "alert"), null, "closing clears it too");
});

test("a runtime without words of its own for a step says the common ones", async context => {
    const r = await runtimeSetup(context, { catalog: { runtimes: [{ ...entry, notice: "plain" }] } });
    buttonNamed(r.draw(), "vc_runtime.review").props.onClick();
    const said = lines(findIn(findIn(r.draw(), node => node.type === "dialog"), node => node.type === "div")).map(([, words]) => words);
    assert.deepEqual(said.slice(0, 4), ["vc_runtime.notice_plain", SIZE, "vc_runtime.connection_notice_plain", "vc_runtime.no_start"]);
});
