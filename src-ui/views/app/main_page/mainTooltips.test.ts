import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "vitest";

// #766: the main screen's tooltips open on keyboard focus too (DESIGN.md "Principles"), so its
// controls carry no `title` attribute, which only the pointer opens. They are wrapped in the
// common Tooltip instead.

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
// The .tsx sources under a folder (tests left out).
const sources = (folder: string): string[] => readdirSync(new URL(folder, import.meta.url), { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? sources(`${folder}${entry.name}/`) : /\.tsx$/.test(entry.name) ? [`${folder}${entry.name}`] : []);

// The rail, both top bars' stop actions, the top bar, the composer and the title bar. The log
// (message_container/log_box) is left out here: its two title attributes are words of the log
// itself (speaker names, readings) and change with the log.
const FOLDERS = ["./sidebar_section/", "./main_section/top_bar/", "./main_section/message_container/message_input_box/",
    "../others/stop_actions/", "../others/window_title_bar/"];

test("no control of the main screen keeps a title attribute", () => {
    const left: string[] = [];
    for (const file of FOLDERS.flatMap(sources)) {
        const source = read(file);
        for (const match of source.matchAll(/\btitle=/g)) {
            // The tag the attribute belongs to: the last one opened before it. A component (capital
            // letter) takes `title` as a prop of its own; an element would get the attribute.
            const tag = [...source.slice(0, match.index).matchAll(/<([A-Za-z][\w.]*)/g)].at(-1)?.[1] ?? "";
            if (/^[a-z]/.test(tag)) left.push(`${file}: <${tag} title=…>`);
        }
    }
    assert.deepEqual(left, []);
});

test("the icons of the rail, the top bar, the composer and the title bar are named by a tooltip", () => {
    const tooltip = (file: string, side: string, words: string) => assert.match(read(file),
        new RegExp(`<Tooltip bare placement="${side}" title=\\{${words.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\}>`), `${file}: ${words}`);
    // Beside the rail, so a bubble covers neither the switch above nor the one below.
    tooltip("./sidebar_section/open_settings/OpenSettings.tsx", "right", 't("studio.open_settings")');
    tooltip("./sidebar_section/SidebarSection.tsx", "right", 't("studio.close_sidebar")');
    // A feature's icon sits at the start of its row: its tooltip opens beside the rail too, not over the switch's name.
    assert.match(read("./sidebar_section/main_function_switch/MainFunctionSwitch.tsx"),
        /<Tooltip bare placement="right" beside=\{`\.\$\{styles\.switch_row\}`\} title=\{label\}>/);
    // Under the top bar and over the composer.
    tooltip("./main_section/top_bar/right_side_components/RightSideComponents.tsx", "bottom", 't("main_page.help_link")');
    tooltip("./main_section/top_bar/right_side_components/RightSideComponents.tsx", "bottom", 't("main_page.quick_settings")');
    tooltip("./main_section/message_container/message_input_box/MessageInputBox.tsx", "top", 't("studio.send_message")');
});
