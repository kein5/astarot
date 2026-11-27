// The chosen theme from the very first paint (#1259). The app's shell reads the saved theme before
// a window's page loads and hands it to the page (src-tauri/src/startup_theme.rs), which puts it
// in place before its first render. Here the page is the main window in a browser, with the
// script the shell would add, and a recorder that notes the window's background colour each time
// the page's content or the root's style changes, and on each frame, from the first content on.
import { test, expect } from "./fixtures";

// A theme other than the default, as the settings save it.
const MIDNIGHT = { preset: "midnight", custom: { base: "#14203a", accent: "#6ea8fe" } };
// The window's background, a colour each theme sets (App.css.ts container: dark_888_color).
const TOKEN = "--dark_888_color";

test.use({ settings: { THEME: MIDNIGHT } });

// What the page's window background was, from the first moment it had content.
const recordFrames = (token: string) => {
    const seen: string[] = [];
    Reflect.set(window, "__themeFrames", seen);
    const note = () => {
        const root = document.getElementById("root");
        if (!root?.firstElementChild) return;
        const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
        if (seen.at(-1) !== value) seen.push(value);
    };
    new MutationObserver(note).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["style"] });
    const frame = () => { note(); requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
};

test("a chosen theme is in place from the first paint of the main window, and stays", async ({ app, page }) => {
    // The script the shell adds to every window's page, with the saved theme.
    await page.addInitScript(theme => { Reflect.set(window, "__ASTAROT_STARTUP_THEME__", theme); }, MIDNIGHT);
    await page.addInitScript(recordFrames, TOKEN);
    await app.restart();
    const frames = await page.evaluate(() => Reflect.get(window, "__themeFrames") as string[]);
    // The stylesheet's own value: the default theme's.
    const defaultValue = await page.evaluate(token => {
        const style = document.documentElement.style, set = style.getPropertyValue(token);
        style.removeProperty(token);
        const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
        style.setProperty(token, set);
        return value;
    }, TOKEN);
    const themed = frames.at(-1);
    expect(themed, "the chosen theme is in place").not.toBe(defaultValue);
    expect(frames, "no frame of the default theme").toEqual([themed]);
});

// The default theme: the shell hands it over too, and nothing changes on the page.
test.describe("on the default theme", () => {
    test.use({ settings: { THEME: { preset: "dark_plum", custom: { base: "#261633", accent: "#a47af5" } } } });
    test("the page draws the stylesheet's colours from the first paint, as before", async ({ app, page }) => {
        await page.addInitScript(theme => { Reflect.set(window, "__ASTAROT_STARTUP_THEME__", theme); },
            { preset: "dark_plum", custom: { base: "#261633", accent: "#a47af5" } });
        await page.addInitScript(recordFrames, TOKEN);
        await app.restart();
        const frames = await page.evaluate(() => Reflect.get(window, "__themeFrames") as string[]);
        expect(frames).toHaveLength(1);
        expect(await page.evaluate(token => document.documentElement.style.getPropertyValue(token), TOKEN), "no colour set over the stylesheet").toBe("");
    });
});
