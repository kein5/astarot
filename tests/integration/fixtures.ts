// The app's main window in the browser, its own core behind it (native/browser-core-bridge) on
// a settings folder of the test's own, and what every test checks at its end: no page error, and
// no Tauri command the stand-ins have no answer for (app/tauriStandIns.ts).
import { test as base, expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BRIDGE = process.env.ASTAROT_INTEGRATION_BRIDGE ?? path.join(ROOT, "native/browser-core-bridge/target/debug",
    process.platform === "win32" ? "vrct-browser-core-bridge.exe" : "vrct-browser-core-bridge");

// What every test starts with: past the first-run setup, in English, sending nothing anywhere.
const INITIAL = {
    AUTO_DOWNLOAD_MODELS: false, ENABLE_TELEMETRY: false, TELEMETRY_NOTICE: 1, FIRST_RUN_SETUP_PENDING: false,
    AUTO_MIC_SELECT: false, AUTO_SPEAKER_SELECT: false, SEND_MESSAGE_TO_VRC: false, VRC_MIC_MUTE_SYNC: false,
    OSC_IP_ADDRESS: "127.0.0.1", WEBSOCKET_SERVER: false, UI_LANGUAGE: "en",
};

/** One run of the core's host. */
class Core {
    private process: ChildProcess | null = null;
    private readonly state: string;
    private readonly log: string;
    url = "";

    constructor(state: string, log: string) {
        this.state = state;
        this.log = log;
    }

    async start() {
        const child = spawn(BRIDGE, ["--state", this.state], { stdio: ["pipe", "pipe", "pipe"] });
        this.process = child;
        child.stderr?.on("data", data => writeFileSync(this.log, data, { flag: "a" }));
        this.url = await new Promise<string>((resolve, reject) => {
            child.once("error", reject);
            child.once("exit", code => reject(new Error(`the core's host ended (${code}) before it listened; see ${this.log}`)));
            child.stdout?.once("data", data => resolve(String(data).trim()));
        });
    }

    /** Asks the host to stop the run, which saves its settings, and waits for it to end. */
    async stop() {
        const child = this.process;
        this.process = null;
        if (!child || child.exitCode !== null) return;
        const ended = new Promise(resolve => child.once("exit", resolve));
        child.stdin?.end();
        const late = setTimeout(() => child.kill(), 20_000);
        await ended;
        clearTimeout(late);
    }
}

export class App {
    readonly core: Core;
    readonly page: Page;
    readonly state: string;

    constructor(page: Page, state: string, log: string) {
        this.page = page;
        this.state = state;
        this.core = new Core(state, log);
    }

    /** The saved settings (config.json of the settings folder). */
    settings(): Record<string, unknown> {
        return this.json("config.json") ?? {};
    }

    /** A JSON file of the settings folder, or null while there is none. */
    json(name: string): Record<string, unknown> | null {
        const file = path.join(this.state, name);
        return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
    }

    /** Everything the core wrote in the settings folder (settings, lists, logs), as text. */
    written(): string {
        return readdirSync(this.state, { recursive: true, withFileTypes: true })
            .filter(entry => entry.isFile())
            .map(entry => readFileSync(path.join(entry.parentPath, entry.name), "utf8"))
            .join("\n");
    }

    /** The main window, once it takes input: the core has started and the settings are applied. */
    async open() {
        if (!this.core.url) await this.core.start();
        await this.page.goto(`/index.html?core=${encodeURIComponent(this.core.url)}`);
        await expect(this.page.locator("textarea[class*=message_box_input_area]")).toBeVisible();
        await expect.poll(() => this.page.evaluate(() =>
            document.querySelector("textarea[class*=message_box_input_area]")?.closest("[aria-busy=true]") === null)).toBe(true);
    }

    /** The app quits and starts again on the same settings folder, with a new core. */
    async restart() {
        await this.page.goto("about:blank");
        await this.core.stop();
        this.core.url = "";
        await this.open();
    }

    /** The app quits, the given settings are written over the saved ones, and it starts again:
     *  for settings that name what a test starts after the app (a stand-in's address). */
    async restartWith(values: Record<string, unknown>) {
        await this.page.goto("about:blank");
        await this.core.stop();
        this.core.url = "";
        writeFileSync(path.join(this.state, "config.json"), JSON.stringify({ ...this.settings(), ...values }));
        await this.open();
    }

    /** Turns a switch of the main window on or off with one press, as a user would, and waits
     *  until the core reports it so. A press the app declines fails the test: it is not pressed
     *  again. */
    async setSwitch(name: string, on = true) {
        const control = this.page.getByRole("switch", { name, exact: true });
        // A switch that is still changing takes no press.
        await expect(control).not.toHaveAttribute("aria-busy", "true");
        if ((await control.getAttribute("aria-checked")) !== String(on)) await control.click();
        await expect(control).toHaveAttribute("aria-checked", String(on), { timeout: 15_000 });
    }

    /** Opens the folds around a control (More settings, a setup section), outermost first, as a
     *  user would (#554). */
    async unfold(control: Locator) {
        // The page may still be changing: the control is there before its folds are counted.
        await control.waitFor({ state: "attached" });
        const folds = control.locator("xpath=ancestor::details");
        for (let i = 0; i < await folds.count(); i++) {
            const fold = folds.nth(i);
            if (!(await fold.evaluate(element => (element as HTMLDetailsElement).open))) await fold.locator(":scope > summary").click();
            await expect(fold).toHaveJSProperty("open", true);
        }
        await expect(control).toBeVisible();
    }

    /** Holds what the core sends until releaseCore: the page as it is before its answers. */
    async holdCore() {
        await this.page.evaluate(() => window.__holdCoreLines?.());
    }

    /** Lets what the core sent while held reach the page, in order. */
    async releaseCore() {
        await this.page.evaluate(() => window.__releaseCoreLines?.());
    }

    /** Leaves Settings for the main window. */
    async closeSettings() {
        await this.page.getByRole("button", { name: "Go back" }).click();
        await expect(this.page.locator("[data-main-page][data-showing=main]")).toBeVisible();
    }

    /** Opens Settings and one of its pages, by the name the side menu shows. */
    async openSettings(pageName: string) {
        await this.page.locator("[data-open-settings]").click();
        await this.page.getByRole("button", { name: pageName, exact: true }).first().click();
    }
}

export const test = base.extend<{ app: App; settings: Record<string, unknown> }>({
    settings: [{}, { option: true }],
    app: async ({ page, settings }, use, testInfo) => {
        const state = testInfo.outputPath("state");
        mkdirSync(state, { recursive: true });
        writeFileSync(path.join(state, "config.json"), JSON.stringify({ ...INITIAL, ...settings }));
        const errors: string[] = [];
        page.on("pageerror", error => errors.push(String(error)));
        const app = new App(page, state, testInfo.outputPath("core.log"));
        await app.open();
        await use(app);
        const record = await page.evaluate(() => window.__integration).catch(() => null);
        await page.goto("about:blank");
        await app.core.stop();
        expect(errors, "errors on the page").toEqual([]);
        expect(record?.unknown ?? [], "Tauri commands without a stand-in answer (tests/integration/app/tauriStandIns.ts)").toEqual([]);
    },
});

export { expect };
