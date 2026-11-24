import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { styleOf } from "../../../logics/test/styleSource.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
// The first group of a pattern that has to be in the text.
const group = (pattern: RegExp, text: string) => {
    const match = pattern.exec(text);
    assert.ok(match, `${pattern} is in the text`);
    return match[1];
};
const variables = Object.fromEntries([...read("../_index_css/variables.css").matchAll(/(--[\w-]+):\s*([^;]+);/g)]
    .map(([, key, value]) => [key, value.trim()]));
const color = (token: string): string => {
    const value = variables[token] ?? token;
    const alias = /^var\((--[\w-]+)\)$/.exec(value);
    return alias ? color(alias[1]) : value;
};
const luminance = (token: string) => {
    const channels = color(token).slice(1).match(/../g);
    assert.ok(channels, `${token} is a hex colour`);
    const rgb = channels.map(channel => parseInt(channel, 16) / 255)
        .map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
};
const contrast = (foreground: string, background: string) => {
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (values[0] + .05) / (values[1] + .05);
};
const box = "setting_section/setting_box/";

// Baselines are the audited full-opacity sRGB pairs. Each actual new pair is
// resolved through variables.css, including the semantic hover alias.
const pairs = [
    ["save failure", "--error_bc_color", "--dark_900_color", "--vox_state_failed", "--dark_900_color", 4.5],
    ["secondary voice hover", "--dark_200_color", "--dark_600_color", "--dark_200_color", "--vox_secondary_hover", 4.5],
    ["OCR reset/refresh hover", "--dark_200_color", "--dark_600_color", "--dark_200_color", "--vox_secondary_hover", 4.5],
    ["word Add hover", "--dark_200_color", "--primary_500_color", "--vox_on_primary", "--primary_650_color", 4.5],
    ["delete resting", "--error_bc_color", "--dark_800_color", "--vox_state_failed", "--dark_800_color", 3],
    ["delete hover", "--error_bc_color", "--dark_750_color", "--vox_state_failed", "--dark_825_color", 3],
    ["delete pressed", "--error_bc_color", "--dark_850_color", "--vox_state_failed", "--dark_850_color", 3],
] as const;
for (const [name, oldFg, oldBg, fg, bg, minimum] of pairs) {
    test(`${name}: changed CSS pair meets ${minimum}:1 and improves the audited ratio`, () => {
        assert.ok(contrast(fg, bg) >= minimum, `${name}: ${contrast(fg, bg)}`);
        assert.ok(contrast(fg, bg) >= contrast(oldFg, oldBg));
    });
}

test("the repaired selectors use the measured tokens; shared token values are the brand palette's", () => {
    assert.match(styleOf(read("topbar/Topbar.css.ts"), "state"), /\[`&\.\$\{is_failed\}`\]: \{ color: vars\.vox_state_failed \}/);
    assert.match(read(box + "advanced_settings/VoiceSettings.css.ts"), /inForm\("button:hover:enabled"\), \{ background: vars\.vox_secondary_hover \}/);
    assert.equal((read(box + "ocr/Ocr.css.ts").match(/background: vars\.vox_secondary_hover/g) ?? []).length, 2);
    // The word filter's delete and Add are the kit's danger and primary Buttons: red words, and
    // Dark Plum words on Lilac.
    const kitButton = read("../../kit/Button.css.ts");
    assert.match(kitButton, /danger: \{[^}]*color: vars\.vox_state_failed,/);
    assert.match(kitButton, /primary: \{\s*background: vars\.primary_600_color,\s*color: vars\.vox_on_primary,/);
    for (const [token, expected] of Object.entries({
        "--error_bc_color": "#bb4448", "--vox_state_failed": "#e4938e",
        "--dark_200_color": "#eeebf1", "--dark_600_color": "#988ba5", "--dark_800_color": "#4e3d5d",
        "--dark_825_color": "#463655", "--primary_500_color": "#b08bf6", "--primary_650_color": "#9f75ef",
    })) assert.equal(color(token), expected, token);
    // Inherited secondary text is also safe on the new hover; Lilac primary
    // actions carry Dark Plum text, which keeps AA contrast on their hover.
    assert.ok(contrast("--vox_secondary_text", "--vox_secondary_hover") >= 4.5);
    assert.ok(contrast("--vox_on_primary", "--primary_550_color") >= 4.5);
});

test("NLLB consent restores a native checkbox and visible keyboard focus", () => {
    const page = read(box + "translation/Translation.css.ts");
    const css = page.slice(page.indexOf("export const license_check"), page.indexOf("export const license_actions"));
    assert.match(css, /appearance: "auto"/);
    assert.match(css, /WebkitAppearance: "checkbox"/);
    assert.match(css, /input:focus-visible`, \{ outline: `\.2rem solid \$\{vars\.primary_200_color\}`/);
    assert.match(css, /flexShrink: 0/);
});

test("available-width breakpoints stack rows at 400px/100% and 800px/200%, including fieldset padding", () => {
    const voice = read(box + "advanced_settings/VoiceSettings.css.ts");
    const row = read(box + "_components/form_row/FormRow.css.ts");
    const legacy = read(box + "_templates/Templates.css.ts");
    // The container width a row stacks under: the first `"(max-width: …rem)"` of the .css.ts.
    const breakpoint = (css: string) => Number(group(/"\(max-width: ([\d.]+)rem\)/, css));
    assert.equal(breakpoint(voice), 16 + 18 + 1.6);
    assert.equal(breakpoint(row), breakpoint(voice));
    // The legacy row has no side padding, so its label starts on the heading's edge. It has the
    // form rows' columns and gap (#567), and stacks once a 16rem label and a 24rem field do not fit.
    assert.equal(breakpoint(legacy), 16 + 24 + 1.6);
    assert.match(legacy, /gridTemplateColumns: "minmax\(0, 1fr\) minmax\(0, 1\.6fr\)"/);
    assert.match(styleOf(legacy, "container"), /padding: "2rem 0",/);
    assert.match(styleOf(read("setting_section/SettingSection.css.ts"), "container"), /containerType: "inline-size"/);
    assert.match(voice, /inForm\("form", "fieldset"\), \{[^}]*containerType: "inline-size"/);
    assert.match(voice, /gridTemplateColumns: "minmax\(0, 1fr\)"/);
    assert.match(voice, /overflowWrap: "anywhere"/);
    assert.ok(voice.includes('const NARROW_WINDOW = "(max-width: 700px)";'), "preserve DESIGN.md's narrow-window stacking");
    assert.match(row, /const stackedRow = \{ gridTemplateColumns: "minmax\(0, 1fr\)"/);
    assert.match(styleOf(row, "row"), /overflowWrap: "anywhere"/);
    assert.match(row, /const NARROW_WINDOW = "\(max-width: 700px\)";/, "preserve DESIGN.md's narrow-window stacking");
    assert.match(styleOf(row, "row"), /"@media": \{ \[NARROW_WINDOW\]: stackedRow \}/);
    assert.match(legacy, /const stacked = \{ gridTemplateColumns: "minmax\(0, 1fr\)", alignItems: "stretch" \}/);
    assert.match(styleOf(legacy, "container"), /"@container": \{ "\(max-width: 41\.6rem\)": stacked \}/);
    for (const [width, scale] of [[400, 1], [800, 2]]) {
        const rem = 10 * scale; // root.css: 62.5% of the default 16px, then UI scale.
        const available = width - (5.6 + 2 * 1.6) * rem;
        const fieldset = available - (2 * 1.6 + 2 * .1) * rem;
        const legacyContent = available;
        assert.equal(available, 312 * scale);
        assert.equal(fieldset, 278 * scale);
        assert.equal(legacyContent, 312 * scale);
        assert.ok(available < breakpoint(voice) * rem);
        assert.ok(fieldset < breakpoint(row) * rem);
        assert.ok(available < breakpoint(legacy) * rem);
        assert.ok(24 * rem <= legacyContent, "24rem URL/key fits after stacking");
        assert.ok(legacyContent - (3.6 + 1) * rem > 0, "color swatch leaves room for a shrinking input");
    }
});

test("legacy fixed-width inputs are capped by their row and can shrink beside the color swatch", () => {
    const entry = read(box + "_components/_atoms/_entry/_Entry.css.ts");
    assert.match(styleOf(entry, "entry_container"), /minWidth: 0,\s*maxWidth: "100%"/);
    assert.match(styleOf(entry, "entry_input_area"), /minWidth: 0/);
    for (const path of ["entry_with_save_button/EntryWithSaveButton", "auth_key/AuthKey", "color_entry_with_save_button/ColorEntryWithSaveButton"]) {
        assert.match(styleOf(read(box + "_components/" + path + ".css.ts"), "container"), /minWidth: 0,\s*maxWidth: "100%",\s*flexShrink: 1/, path);
    }
    assert.match(styleOf(read(box + "_components/auth_key/AuthKey.css.ts"), "entry_section_wrapper"), /maxWidth: "100%"/);
    assert.match(read(box + "_components/label_component/LabelComponent.css.ts"), /overflowWrap: "anywhere"/);
});

test("legacy model information wraps above its action inside the padded row, including Japanese button text", () => {
    const radio = read(box + "_components/radio_button/RadioButton.css.ts");
    // The rules of a column of options (\`.container.column ...\`), in the order they are written.
    const column = radio.slice(radio.indexOf("globalStyle(`$" + "{container}.$" + "{column}`"), radio.indexOf("globalStyle(`$" + "{container}.$" + "{has_desc}"));
    const download = read(box + "_components/_atoms/_download_button/_DownloadButton.css.ts");
    assert.match(column, /width: "100%", minWidth: 0/);
    assert.match(column, /\$\{radio_button_container\}`, \{[^}]*flexWrap: "wrap"/);
    assert.match(column, /\$\{radio_button_wrapper\}`, \{ flex: "1 1 24rem", minWidth: 0, maxWidth: "100%" \}/);
    assert.match(column, /\$\{label_heading_wrapper\}`, \{ flexWrap: "wrap" \}/);
    assert.match(column, /\$\{radio_button_label\}`, \{[^}]*flexShrink: 1, overflowWrap: "anywhere"/);
    assert.match(column, /\$\{radio_button_desc\}`, \{ overflowWrap: "anywhere" \}/);
    assert.match(styleOf(download, "download_container"), /width: "10\.4rem",[\s\S]*minWidth: 0,\s*maxWidth: "100%"/);
    assert.match(styleOf(download, "download_button_label"), /whiteSpace: "normal",\s*overflowWrap: "anywhere"/);
    const labelBasis = Number(group(/flex: "1 1 ([\d.]+)rem"/, column));
    const actionWidth = Number(group(/width: "([\d.]+)rem"/, styleOf(download, "download_container")));
    const gap = Number(group(/gap: "([\d.]+)rem"/, radio.split("globalStyle(radio_button_container, {")[1]));
    assert.equal(Math.round((labelBasis + actionWidth + gap) * 10) / 10, 35.6);
    assert.ok(actionWidth >= 7 * 1.2 + 2 * .8, "取得内容を確認 and its padding fit the action");
    // The reviewer measured a 672px scroller at 800px / 200%. The other
    // case uses the existing 5.6rem compact rail at 400px / 100%.
    for (const [scroller, rem] of [[672, 20], [344, 10]]) {
        const section = scroller - 2 * 1.6 * rem;
        const row = section - 2 * 2 * rem;
        assert.ok(section < (labelBasis + actionWidth + gap) * rem);
        assert.ok(row < (labelBasis + actionWidth + gap) * rem);
        assert.ok(actionWidth * rem <= row);
        assert.ok(row - (2 * .8 + 2 + 1) * rem > 0, "model text retains space after label padding, radio and gap");
    }
});

test("word-filter input/Add and export controls wrap within the actual available width", () => {
    const word = read(box + "_components/word_filter/WordFilter.css.ts");
    const entry = styleOf(word, "entry_section_wrapper");
    assert.match(entry, /flexWrap: "wrap"/);
    assert.match(entry, /width: "100%",\s*minWidth: 0/);
    assert.match(word, /globalStyle\(`\$\{entry_section_wrapper\} > :first-child`, \{ flex: "1 1 18rem", minWidth: 0, maxWidth: "30rem" \}\)/);
    // Add keeps its width beside the entry; the kit's Button wraps long words inside itself.
    assert.match(styleOf(word, "add_button"), /flexShrink: 0/);
    assert.match(read("../../kit/Button.css.ts"), /maxWidth: "100%",[\s\S]*?overflowWrap: "anywhere",/);
    const shared = read(box + "shared_items/SharedItems.css.ts");
    const sharedRules = styleOf(shared, "auto_export_message_logs_container");
    assert.match(sharedRules, /gridTemplateColumns: "minmax\(0, 1fr\) minmax\(0, 1\.6fr\)"/);
    assert.match(sharedRules, /"@container": \{ "\(max-width: 41\.6rem\)": stacked \}/);
    assert.match(sharedRules, /"@media": \{ "\(max-width: 700px\)": stacked \}/);
    assert.match(sharedRules, /minWidth: 0/);
    assert.match(shared, /globalStyle\(`\$\{auto_export_message_logs_container\} > \*`, \{ minWidth: 0, maxWidth: "100%" \}\)/);
    const switchRules = styleOf(shared, "auto_export_message_logs_switch_section_container");
    assert.match(switchRules, /flexWrap: "wrap"/);
    assert.match(switchRules, /justifyContent: "flex-end"/);
    assert.match(switchRules, /minWidth: 0/);
    assert.match(switchRules, /maxWidth: "100%"/);
    for (const [scroller, rem] of [[672, 20], [344, 10]]) {
        const row = scroller - (3.2 + 4) * rem;
        const add = (2 * 1.4 + 2 * 1.2) * rem; // 追加 + button padding.
        assert.ok(18 * rem + 2 * rem + add <= row, "input yields space to Add");
        assert.ok(30 * rem + 2 * rem + add > row, "old fixed preference would overflow");
        const exportActions = (2.4 + 4 + 2.8 + 4 + 1.2) * rem;
        assert.ok(exportActions <= row);
        assert.ok(16 * rem + 2 * rem + exportActions > row, "export actions must wrap below their label");
    }
});

test("search and every top-bar action occupy disjoint shared-grid areas with automatically reserved height", () => {
    const page = read("ConfigPage.css.ts"), top = read("topbar/Topbar.css.ts");
    const search = read("search_bar/SearchBar.css.ts"), sidebar = read("sidebar_section/SidebarSection.css.ts");
    assert.match(styleOf(page, "content_wrapper"), /display: "contents"/);
    assert.match(styleOf(top, "container"), /display: "contents"/);
    assert.match(styleOf(search, "search_wrapper"), /gridArea: "search",\s*position: "relative"/);
    assert.match(styleOf(search, "search_wrapper"), /\[`&\.\$\{is_small\}`\]: \{/, "retain the class used by the unchanged SearchBar JSX");
    assert.match(sidebar, /gridArea: "sidebar"/);
    assert.match(styleOf(page, "main_container"), /gridArea: "main",\s*minWidth: 0,\s*minHeight: 0/);
    assert.ok(!page.includes("paddingTop:"), "content starts below intrinsic header rows, not a fixed estimate");
    assert.match(styleOf(sidebar, "scroll_container"), /paddingTop: 0/);
    assert.match(styleOf(page, "container"), /gridTemplateRows: "auto minmax\(0, 1fr\)"/);
    // The narrow grid, for a narrow window and for the UI-size-aware breakpoint alike.
    assert.match(page.slice(page.indexOf("const NARROW_GRID")), /^[^;]*gridTemplateRows: "auto auto minmax\(0, 1fr\)"/);
    assert.match(styleOf(page, "container"), /"@media": \{ "\(max-width: 800px\)": NARROW_GRID \}/);
    assert.match(styleOf(page, "container"), /selectors: \{ "html\[data-narrow\] &": NARROW_GRID \}/);
    const areas = [...page.matchAll(/gridTemplateAreas: '((?:"[^"]+"\s*)+)'/g)]
        .map(([, value]) => [...value.matchAll(/"([^"]+)"/g)].map(([, row]) => row.split(" ")));
    assert.deepEqual(areas, [
        [["search", "search", "stop", "stop"], [".", "save", "save", "back"], ["sidebar", "main", "main", "main"]],
        [["search", "stop", "save", "back"], ["sidebar", "main", "main", "main"]],
    ]);
    for (const grid of areas) {
        for (const area of ["search", "stop", "save", "back", "sidebar", "main"]) {
            const cells = grid.flatMap((row, y) => row.flatMap((name, x) => name === area ? [[x, y]] : []));
            const xs = cells.map(([x]) => x), ys = cells.map(([, y]) => y);
            for (let y = Math.min(...ys); y <= Math.max(...ys); y++) {
                for (let x = Math.min(...xs); x <= Math.max(...xs); x++) {
                    assert.equal(grid[y][x], area, "every area is rectangular and shares no cells");
                }
            }
        }
    }
    for (const [selector, area] of [["stop_actions", "stop"], ["save_slot", "save"], ["back", "back"]]) {
        assert.match(styleOf(top, selector), new RegExp(`style\\(\\{\\s*gridArea: "${area}"`));
    }
    assert.match(styleOf(top, "save_bar"), /minWidth: 0,[^}]*flexWrap: "wrap"/);
    assert.match(styleOf(top, "summary"), /minWidth: 0,[^}]*flexWrap: "wrap"/);
    assert.match(styleOf(top, "stop"), /flexWrap: "wrap",[\s\S]*maxWidth: "100%",[\s\S]*whiteSpace: "normal"/);
    assert.match(styleOf(top, "stop_actions"), /flexWrap: "wrap"/);
    // The narrow header, for a narrow window and for the UI-size-aware breakpoint alike.
    assert.match(top.slice(top.indexOf("const stopActionsNarrow")), /^[^;]*maxWidth: "24rem"/);
    assert.match(styleOf(top, "stop_actions"), /selectors: \{ \[`\$\{NARROW_PAGE\} &`\]: stopActionsNarrow \}/);
    assert.match(styleOf(top, "stop_actions"), /"@media": \{ \[NARROW\]: stopActionsNarrow \}/);
    assert.match(top, /const NARROW = "\(max-width: 800px\)";/);
    assert.match(top, /const NARROW_PAGE = "html\[data-narrow\]";/);
});

test("header width budgets leave search usable even with queued/muted actions at both requested scales", () => {
    // Budgets use Japanese full-width glyphs as 1em. CSS still wraps for fonts,
    // counts or translations wider than these estimates; these are not screenshots.
    const stop = 6 * 1.4 + 2 * 1.2 + 2 * .1;
    const mute = 4 * 1.4 + 2 * 1.2 + 2 * .1;
    const searchChrome = 2 * .8 + 2 * .1 + 1.5 + 2 * .7 + 1.2 + 2 * .2;
    for (const [pageWidth, rem] of [[800, 20], [784, 20], [400, 10], [392, 10]]) {
        for (const stopWidth of [stop + mute + .8, 24]) {
            const stopArea = (stopWidth + 1.6) * rem; // Includes its right margin.
            const searchArea = pageWidth - stopArea;
            const searchWidth = searchArea - 2 * 1.6 * rem;
            assert.ok(searchWidth > searchChrome * rem, "input remains wider than its icon/clear/padding");
            const searchRight = searchArea - 1.6 * rem;
            const stopLeft = searchArea;
            const stopRight = stopLeft + stopWidth * rem;
            assert.ok(searchRight + .8 * rem <= stopLeft, "focus outlines fit the gap");
            assert.ok(stopRight <= pageWidth - 1.6 * rem);
        }
        const saveWidth = pageWidth - (5.6 + 5 + 1.6 + 1.6 + .8) * rem;
        assert.ok(saveWidth > (2 * (2 * 1.4 + 2 * 1.4) + .8 + 2) * rem,
            "save/discard fit; state/count can wrap into their own line");
    }
    // At 1200px/100%, search is back in the 20.8rem rail; all controls use
    // the single header row, including the longer Japanese stop/mute labels.
    const wideStop = (7 * 1.4 + 2.6) + (9 * 1.4 + 2.6) + .8;
    const wideBack = 2 * 1.4 + .8 + 1.8 + 2 * 1.6;
    const wideSave = 120 - 20.8 - (wideStop + .8) - (wideBack + 1.6) - .8;
    assert.ok(20.8 - 3.2 > searchChrome);
    assert.ok(wideSave > 10 + 2 * (5 * 1.4 + 2 * 1.4) + 1.6 + 2);
});

test("the forms' primary action is Lilac: the plain class name primary is matched globally", () => {
    const css = read(box + "advanced_settings/VoiceSettings.css.ts");
    // The forms write className="primary", so the rule names the plain class: a style() class
    // would be given a generated name and never match.
    assert.doesNotMatch(css, /export const primary\b/);
    assert.match(css, /inForm\("button\.primary"\), \{ background: "var\(--primary_600_color/);
    const downloads = read(box + "advanced_settings/ModelDownloads.tsx");
    assert.match(downloads, /className="primary" disabled=\{!agreed \|\| busy\}/, "agreeing to a download is the primary action");
});

test("a guide link reads as a link wherever it sits", () => {
    const css = read(box + "_components/custom_model_link/CustomModelLink.css.ts");
    assert.match(css, /globalStyle\(`\$\{container\} a`, \{ color: vars\.primary_300_color, textDecoration: "underline" \}\)/);
});
test("the saved chat reading language is named like the list's entries, so auto never shows raw", () => {
    const source = read(box + "ocr/Ocr.tsx");
    assert.match(source, /list\[currentOcrSourceLanguage\.data\] = label\(currentOcrSourceLanguage\.data\)/);
    assert.match(source, /const label = \(id: string\) => id === "auto" \? t\("config_page\.ocr\.source_language\.auto"\)/);
});
test("#436: the legacy dropdown is the same field as the forms' select, so an empty one still shows", () => {
    const legacy = read(box + "_components/_atoms/_dropdown_menu/_DropdownMenu.css.ts");
    const field = styleOf(legacy, "dropdown_toggle_button");
    const form = read(box + "advanced_settings/VoiceSettings.css.ts");
    assert.match(form, /inForm\("input", "select", "textarea"\), \{\s*width: "100%",\s*minWidth: 0,\s*background: "var\(--vox_surface, #18253b\)",\s*border: "\.1rem solid var\(--vox_field_border, #5e6570\)",\s*\}\);/);
    assert.match(field, /backgroundColor: "var\(--vox_surface, #18253b\)"/);
    assert.match(field, /border: "0\.1rem solid var\(--vox_field_border, #5e6570\)"/);
    assert.match(field, /borderRadius: "var\(--vox_radius, 0\.8rem\)"/);
    assert.match(field, /minHeight: "4rem"/, "the field keeps its height without a value");
    assert.match(field, /"&:focus-visible": \{ outline: `0\.2rem solid \$\{vars\.primary_200_color\}`/);
    const list = styleOf(legacy, "dropdown_content");
    assert.match(list, /backgroundColor: "var\(--vox_surface, #18253b\)"/);
    assert.match(list, /borderRadius: "var\(--vox_radius, 0\.8rem\)"/);
});
test("the settings text entry is the same field as the kit's text field and the forms' inputs", () => {
    // docs/design/components/shadcn-alignment.md: _Entry takes the kit's fill, border, radius and
    // height, and names its input as shadcn/ui's Input does.
    const entry = read(box + "_components/_atoms/_entry/_Entry.css.ts");
    const field = styleOf(entry, "entry_wrapper");
    assert.match(field, /minHeight: "4rem"/, "the field keeps its height without a value");
    assert.match(field, /backgroundColor: vars\.vox_surface/);
    assert.match(field, /border: `0\.1rem solid \$\{vars\.vox_field_border\}`/);
    assert.match(field, /borderRadius: vars\.vox_radius/);
    assert.ok(contrast("--vox_field_border", "--vox_surface") >= 3.5, "the field's edge is visible on its fill");
    // The input fills the box, so a click anywhere in it reaches the input.
    assert.match(styleOf(entry, "entry_input_area"), /flex: "1 1 auto"/);
    assert.match(read(box + "_components/_atoms/_entry/_Entry.tsx"), /<input\s+data-slot="input"/);
    // The API key's edit cover lies over the field, so it has the field's corners.
    assert.match(styleOf(read(box + "_components/auth_key/AuthKey.css.ts"), "entry_edit_cover"), /borderRadius: vars\.vox_radius/);
});
test("the settings search is the same field as the other inputs, with InputGroup's parts", () => {
    // docs/design/components/shadcn-alignment.md, Combobox, Command and InputGroup.
    const css = read("search_bar/SearchBar.css.ts");
    const field = styleOf(css, "search_input_container");
    assert.match(field, /backgroundColor: vars\.vox_surface/);
    assert.match(field, /border: `0\.1rem solid \$\{vars\.vox_field_border\}`/);
    assert.match(field, /borderRadius: vars\.vox_radius/);
    // Hover makes the edge lighter, never darker than the field border.
    assert.match(field, /"&:hover": \{ borderColor: vars\.dark_550_color \}/);
    const jsx = read("search_bar/SearchBar.tsx");
    assert.match(jsx, /className=\{styles\.search_input_container\} data-slot="input-group"/);
    assert.match(jsx, /data-slot="input-group-control"/);
    assert.equal((jsx.match(/data-slot="input-group-addon"/g) ?? []).length, 2, "the icon and the clear button");
    // The results open on the surface, like the other lists that drop from a field.
    assert.match(styleOf(css, "dropdown_results"), /backgroundColor: vars\.vox_surface/);
    // A search that finds nothing says so in shadcn/ui's Empty, inside the status the list becomes.
    assert.match(jsx, /<Empty>\s*<EmptyDescription>\{t\("config_page\.search\.no_results"\)\}<\/EmptyDescription>\s*<\/Empty>/);
    assert.doesNotMatch(css, /no_results/);
});
test("the slider draws its filled part on a .6rem groove, as shadcn/ui's Slider does", () => {
    const css = read(box + "_components/slider/Slider.css.ts");
    const rule = (name: string) => styleOf(css, name);
    // The filled part (shadcn/ui's Range) is drawn in the primary colour.
    assert.match(rule("track"), /\n {4}backgroundColor: vars\.primary_600_color,/);
    // The groove and its filled part are .6rem (h-1.5), across or along.
    for (const name of ["rail", "track"]) {
        assert.match(rule(name), /height: "0\.6rem"/, name);
        assert.match(rule(name), /width: "0\.6rem"/, name);
    }
    // The pointer still reaches 3rem around the groove.
    assert.match(rule("sliderRoot"), /height: "0\.6rem", padding: "1\.2rem 0"/);
    assert.match(rule("sliderRoot"), /width: "0\.6rem", padding: "0 1\.2rem"/);
    // A disabled slider is half as strong (data-[disabled]:opacity-50), as the other controls are.
    assert.match(rule("sliderRoot"), /"&\[data-disabled\]": \{ opacity: 0\.5,/);
    // The forms' range control looks the same: a .6rem groove painted up to --range-fill, which
    // the monitor volume sets to its value's share.
    const form = read(box + "advanced_settings/VoiceSettings.css.ts");
    assert.match(form, /input\[type="range"\]::-webkit-slider-runnable-track'\), \{\s*height: "\.6rem",[^}]*linear-gradient\(to right, \$\{vars\.primary_600_color\} var\(--range-fill, 0%\), \$\{vars\.dark_825_color\} var\(--range-fill, 0%\)\)/);
    assert.match(form, /input\[type="range"\]::-webkit-slider-thumb'\), \{[^}]*height: "1\.8rem",\s*marginTop: "-\.6rem",/);
    assert.match(form, /input\[type="range"\]::-moz-range-progress'\), \{ height: "\.6rem",[^}]*background: vars\.primary_600_color/);
    assert.match(read(box + "advanced_settings/VoiceSettings.tsx"), /<input type="range" min="0" max="100"[^>]*style=\{\{ "--range-fill": `\$\{draft\.monitor_volume \?\? "100"\}%` \}\}/);
});
test("the forms' select draws the kit select's chevron, at its size and place", () => {
    // Both are shadcn/ui's NativeSelect: a 1.6rem chevron 1.4rem from the right edge.
    const form = read(box + "advanced_settings/VoiceSettings.css.ts");
    const kit = group(/<path d="([^"]+)"/, read("../../kit/Select.tsx"));
    const selectRule = /globalStyle\(inForm\("select"\), \{[^}]*\}/.exec(form);
    assert.ok(selectRule);
    const select = selectRule[0];
    assert.ok(select.includes(`viewBox='0 0 12 12'%3E%3Cpath d='${kit}'`), "the same chevron as the kit's");
    assert.match(select, /paddingRight: "3\.6rem",/);
    assert.match(select, /backgroundPosition: "right 1\.4rem center",\s*backgroundSize: "1\.6rem",/);
});
test("download dialogs write byte counts in the display language", () => {
    for (const page of ["advanced_settings/ModelDownloads.tsx", "ocr/OcrModels.tsx"]) {
        const source = read(box + page);
        assert.doesNotMatch(source, /\} bytes/, page);
        assert.match(source, /t\("model_downloads\.exact_bytes"/, page);
    }
});
test("a modal dialog dims the window with shadcn/ui's 50% black, written as a colour", () => {
    // The forms' dialogs.
    const form = read(box + "advanced_settings/VoiceSettings.css.ts");
    assert.deepEqual([...form.matchAll(/::backdrop"\), \{([^}]*)\}/g)].map(match => match[1].trim()), ['background: "#00000080"']);
    // The settings' leave dialog and the translation's license dialog.
    for (const file of ["topbar/Topbar.css.ts", box + "translation/Translation.css.ts"]) {
        assert.deepEqual([...read(file).matchAll(/"&::backdrop": \{([^}]*)\}/g)].map(match => match[1].trim()), ['background: "#00000080"'], file);
    }
});
