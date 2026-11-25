import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "vitest";

// The rules of the #452 settings kit that a reader of the source could break without noticing.
// The behaviour itself (Space toggles a switch, a label names it, focus shows a ring) was checked
// in a browser against kit-lab.html; see docs/design/components/README.md.
const read = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");
const kitFiles = readdirSync(new URL(".", import.meta.url)).filter(name => /\.(ts|tsx)$/.test(name));

test("the kit takes every colour from the tokens", () => {
    // Comments name issues (#452), so only the code is searched.
    const code = (name: string) => read(name).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const name of kitFiles) {
        assert.doesNotMatch(code(name), /#[0-9a-fA-F]{3,8}\b/, `${name} writes a colour by hand`);
    }
});

test("a primary button is Lilac with Dark Plum words, and buttons do not submit by default", () => {
    const css = read("Button.css.ts");
    assert.match(css, /primary: \{\s*background: vars\.primary_600_color,\s*color: vars\.vox_on_primary/);
    assert.match(read("Button.tsx"), /type = "button"/);
});

test("buttons are medium weight and a disabled control is half as strong, as in shadcn/ui", () => {
    assert.match(read("Button.css.ts"), /fontWeight: 500,/);
    assert.match(read("shared.css.ts"), /opacity: \.5,/);
});

test("a button with an icon has shadcn/ui's narrower sides, and an icon button is square", () => {
    const css = read("Button.css.ts");
    // has-[>svg]:px-3 at the regular size, px-2.5 at compact (shadcn/ui's sm).
    assert.match(css, /regular: \{ selectors: \{ "&:has\(> svg\)": \{ paddingInline: "1\.2rem" \} \} \}/);
    assert.match(css, /compact: \{[^}]*selectors: \{ "&:has\(> svg\)": \{ paddingInline: "1rem" \} \}/);
    // size="icon": as wide as it is high, the regular height until D-03 is decided.
    assert.match(css, /icon: \{ width: "4rem", height: "4rem", padding: 0 \}/);
});

test("the switch is Radix's, the select is the system's", () => {
    assert.match(read("Switch.tsx"), /from "@radix-ui\/react-switch"/);
    assert.match(read("Switch.css.ts"), /"&\[data-state='checked'\]": \{ transform: "translateX\(2\.2rem\)", background: vars\.vox_on_primary \}/);
    const select = read("Select.tsx");
    assert.match(select, /<select\b/);
    assert.doesNotMatch(select, /@radix-ui\/react-select/, "Radix Select writes a <style> element at run time");
});

test("each part carries the data-slot of its shadcn/ui counterpart", () => {
    // DESIGN.md "Components": a component takes its structure from shadcn/ui, a data-slot
    // naming each part included (docs/design/components/shadcn-alignment.md).
    assert.match(read("Button.tsx"), /<button type=\{type\} data-slot="button"/);
    assert.match(read("TextField.tsx"), /data-slot="input"/);
    assert.match(read("Textarea.tsx"), /<textarea\s*data-slot="textarea"/);
    const select = read("Select.tsx");
    for (const slot of ["native-select-wrapper", "native-select", "native-select-icon", "native-select-option", "native-select-optgroup"]) {
        assert.match(select, new RegExp(`data-slot="${slot}"`), slot);
    }
    // The option parts are exported beside the select, as NativeSelectOption and NativeSelectOptGroup are.
    assert.match(read("index.ts"), /export \{ Select, SelectOptGroup, SelectOption,/);
    const toggle = read("Switch.tsx");
    assert.match(toggle, /<RadixSwitch\.Root data-slot="switch"/);
    assert.match(toggle, /<RadixSwitch\.Thumb data-slot="switch-thumb"/);
    const pressed = read("Toggle.tsx");
    for (const slot of ["toggle", "toggle-group", "toggle-group-item"]) assert.match(pressed, new RegExp(`data-slot="${slot}"`), slot);
    const popover = read("Popover.tsx");
    for (const slot of ["popover", "popover-trigger", "popover-anchor", "popover-content"]) assert.match(popover, new RegExp(`data-slot="${slot}"`), slot);
    assert.match(read("Progress.tsx"), /<progress data-slot="progress"/);
    const item = read("Item.tsx");
    for (const slot of ["item-group", "item", "item-media", "item-content", "item-title", "item-description", "item-actions"]) {
        assert.match(item, new RegExp(`data-slot="${slot}"`), slot);
    }
    const card = read("Card.tsx");
    for (const slot of ["card", "card-header", "card-title", "card-description", "card-content", "card-footer"]) {
        assert.match(card, new RegExp(`data-slot="${slot}"`), slot);
    }
    assert.match(read("Badge.tsx"), /<span data-slot="badge"/);
    assert.match(read("index.ts"), /export \{ Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle,/);
});

test("what needs the user is a card in the warning's amber; the other rows are quiet, in one frame", () => {
    // DESIGN.md "Components" (#759, #614): the layout says it before the words are read.
    const css = read("Item.css.ts");
    const attention = css.slice(css.indexOf("const attention = style({"), css.indexOf("const muted"));
    assert.match(attention, /borderLeft: `\.3rem solid \$\{vars\.vox_state_warning\}`/);
    assert.match(attention, /background: vars\.vox_warning_tint/);
    assert.match(attention, /minHeight: "6\.4rem"/);
    // The frame of the quiet rows, a hairline between two of them.
    assert.match(css, /const outlineGroup = style\(\{\s*gap: 0,\s*border: `\.1rem solid \$\{vars\.vox_border\}`/);
    assert.match(css, /\[`\$\{outlineGroup\} > & \+ &`\]: \{ borderTop: `\.1rem solid \$\{vars\.vox_border\}` \}/);
    // The mark grows with the card and the name takes full strength (1.5rem / 600).
    assert.match(css, /\[`\$\{attention\} > &`\]: \{ width: "2\.4rem", height: "2\.4rem"/);
    assert.match(css, /\[`\$\{attention\} &`\]: \{ fontSize: "1\.5rem", fontWeight: 600/);
    // A variant's room wins over its size's, and the frame's rows touch at any size: the classes
    // that win are declared after the ones they override.
    assert.ok(css.indexOf("const attention = style(") > css.indexOf("const compactSize = style("));
    assert.ok(css.indexOf("const outlineGroup = style(") > css.indexOf("const compactGroup = style("));
    // The spinning arc stands still for reduced motion.
    assert.match(css, /"@media": \{ "\(prefers-reduced-motion: reduce\)": \{ animation: "none" \} \}/);
});

test("compact rows put the words under the name in a narrow list, and a row taken out is struck through", () => {
    const css = read("Item.css.ts");
    assert.match(css, /gridTemplateColumns: "minmax\(8rem, 14rem\) minmax\(0, 1fr\)"/);
    assert.match(css, /"@container": \{ "\(max-width: 52rem\)": \{ gridTemplateColumns: "minmax\(0, 1fr\)", rowGap: 0 \} \}/);
    assert.match(css, /\[`\$\{removed\} &`\]: \{ fontWeight: 400, color: vars\.dark_500_color, textDecoration: "line-through" \}/);
    // The group is the container the rows measure.
    assert.match(css, /containerType: "inline-size"/);
    // The confirmation inside a row, named after AlertDialog's parts; its buttons are the kit's
    // Button, which keeps data-slot="button" so the forms' rules leave them alone.
    const confirm = read("InlineConfirm.tsx");
    for (const slot of ["inline-confirm-content", "inline-confirm-description"]) assert.match(confirm, new RegExp(`data-slot="${slot}"`), slot);
    assert.doesNotMatch(confirm, /<Button[^>]*data-slot=/);
});

test("the confirmation inside a row stays in the row: no dialog, no popover, the way back first", () => {
    // H-07 of the hand-built inventory: it belongs to the row it removes.
    const confirm = read("InlineConfirm.tsx");
    assert.doesNotMatch(confirm.replace(/\/\/.*$/gm, ""), /<dialog|@radix-ui|showModal|popover/i);
    assert.match(confirm, /<Button autoFocus onClick=\{event => \{ context\?\.back\(\); onClick\?\.\(event\); \}\} \{\.\.\.rest\} \/>/);
    assert.match(confirm, /<Button tone="danger" \{\.\.\.props\} \/>/);
    // Its sentence in the description's size and colour, as a form's notes.
    const css = read("InlineConfirm.css.ts");
    assert.match(css, /fontSize: "1\.2rem",\s*lineHeight: 1\.6,\s*color: vars\.vox_description_text/);
    assert.match(css, /display: "flex",\s*flexWrap: "wrap",\s*alignItems: "center",\s*gap: "\.8rem"/);
});

test("a part takes its ref as one of the props, as shadcn/ui's parts do on React 19", () => {
    // DESIGN.md "Components": no forwardRef; the ref goes on with the rest of the props.
    for (const file of ["Badge.tsx", "Button.tsx", "Card.tsx", "Dialog.tsx", "InlineConfirm.tsx", "Item.tsx", "Popover.tsx", "Progress.tsx", "Select.tsx", "Setting.tsx",
        "Switch.tsx", "TextField.tsx", "Textarea.tsx", "Toggle.tsx"]) {
        assert.doesNotMatch(read(file), /forwardRef/, file);
    }
});

test("the select is drawn like shadcn/ui's NativeSelect", () => {
    const css = read("Field.css.ts");
    // A 1.6rem chevron 1.4rem from the right, over 3.6rem of room.
    assert.match(css, /right: "1\.4rem",\s*width: "1\.6rem",\s*height: "1\.6rem",\s*marginTop: "-\.8rem"/);
    assert.match(css, /paddingRight: "3\.6rem"/);
    // Disabled: the wrapper dims the select and its chevron together, and the select itself
    // is not dimmed a second time.
    assert.match(css, /"&:has\(select:disabled\)": \{ opacity: disabledLook\.opacity \}/);
    assert.match(css, /select: \{[\s\S]*?"&:disabled": \{ opacity: 1 \}/);
});

test("where the engine draws the list itself, the select opens it in the forms' look", () => {
    // Decided on 2026-11-25: on WebView2 (base-select) every kit Select opens the list as the
    // settings forms' selects did, and wraps a long value; the rules only apply where supported.
    const css = read("Field.css.ts");
    const forms = readFileSync(new URL("../app/config_page/setting_section/setting_box/advanced_settings/VoiceSettings.css.ts", import.meta.url), "utf8");
    const supported = /\[BASE_SELECT\]: \{/g;
    assert.match(css, /const BASE_SELECT = "\(appearance: base-select\)";/);
    assert.match(css, /const select = `\$\{selectWrap\} > select`;/);
    // Every rule for the list waits for base-select: as many as there are rules for the select's parts.
    assert.equal(css.match(supported)?.length, css.match(/globalStyle\((`\$\{select\}|select,)/g)?.length);
    assert.equal(css.match(supported)?.length, 9);
    assert.match(css, /globalStyle\(`\$\{select\}, \$\{select\}::picker\(select\)`, \{ "@supports": \{ \[BASE_SELECT\]: \{ appearance: BASE_SELECT_APPEARANCE \} \} \}\);/);
    assert.match(css, /globalStyle\(`\$\{select\}::picker-icon`, \{ "@supports": \{ \[BASE_SELECT\]: \{ display: "none" \} \} \}\);/, "the kit's chevron stays the only one");
    // The list, its motion, its rows and the chosen row carry the forms' values.
    // The block a rule gives under base-select, its braces matched (a template's ${} included).
    const body = (text: string, rule: string) => {
        const at = text.indexOf(rule);
        assert.notEqual(at, -1, rule);
        const open = text.indexOf("{", text.indexOf("[BASE_SELECT]:", at));
        let depth = 0, end = open;
        do { depth += text[end] === "{" ? 1 : text[end] === "}" ? -1 : 0; end += 1; } while (depth > 0);
        return text.slice(open, end).replace(/\s+/g, " ");
    };
    // A rule of the kit's file as written there, where ${select} is the select's selector.
    const sel = ["$", "{select}"].join("");
    const kitRule = (rest: string) => `globalStyle(\`${sel}${rest}`;
    for (const [kit, form] of [[kitRule("::picker(select)`, {"), 'globalStyle(inForm("select::picker(select)"), {'],
        [kitRule(" option`,"), 'globalStyle(inForm("option"),'],
        [kitRule(` option:hover, ${sel} option:focus-visible\``), 'globalStyle(inForm("option:hover", "option:focus-visible")'],
        [kitRule(" option:checked`"), 'globalStyle(inForm("option:checked")'],
        [kitRule(" option::checkmark`"), 'globalStyle(inForm("option::checkmark")']]) {
        assert.equal(body(css, kit), body(forms, form), kit);
    }
    assert.match(body(css, kitRule("::picker(select)`, {")), /positionTryOrder: "normal",/);
    assert.match(css, /transition: `opacity \$\{vars\.vox_motion_fast\} \$\{vars\.vox_ease\}, transform \$\{vars\.vox_motion\} \$\{vars\.vox_ease_settle\}`,\s*"@starting-style": \{ opacity: 0, transform: "translateY\(-\.6rem\) scaleY\(\.94\)" \},/);
    // The forms' own rules, for the selects that are still theirs, leave the kit's select alone.
    assert.match(forms, /globalStyle\(inForm\("select:open::picker\(select\)"\), \{\s*"@supports": \{ \[BASE_SELECT\]: \{ "@starting-style"/);
    assert.doesNotMatch(forms, /`\$\{container\} select/);
});

test("a progress bar keeps the forms' look: one palette at two lightnesses, .6rem with round ends", () => {
    // D-32 (2026-11-25): not shadcn/ui's primary/20 track, which is the value's colour made transparent.
    const css = read("Progress.css.ts");
    assert.match(css, /height: "\.6rem",[\s\S]*?borderRadius: "\.3rem",[\s\S]*?background: vars\.dark_825_color,/);
    assert.match(css, /"&::-webkit-progress-bar": \{ background: vars\.dark_825_color, borderRadius: "\.3rem" \}/);
    assert.match(css, /"&::-webkit-progress-value": \{ background: vars\.primary_500_color, borderRadius: "\.3rem" \}/);
    assert.match(css, /"&::-moz-progress-bar": \{ background: vars\.primary_500_color, borderRadius: "\.3rem" \}/);
    // The engines' own bar is turned off, or they draw theirs instead of the kit's.
    assert.match(css, /appearance: "none",\s*WebkitAppearance: "none",/);
    assert.doesNotMatch(css, /opacity|color-mix/);
});

test("a textarea keeps the way each place grows: no field-sizing, an edge to drag in a form, none when it fills", () => {
    // D-13 (2026-11-25): field-sizing: content is not Baseline Widely available, so a field does not grow with its text.
    const css = read("Field.css.ts");
    assert.doesNotMatch(css.replace(/\/\/.*$/gm, ""), /fieldSizing|field-sizing/, "the comments say why; the code does not use it");
    assert.match(css, /\{ variants: \{ kind: "textarea", fill: false \}, style: \{ minHeight: "8rem", resize: "vertical" \} \}/);
    assert.match(css, /\{ variants: \{ kind: "textarea", fill: true \}, style: \{ resize: "none" \} \}/);
    assert.match(css, /defaultVariants: \{ kind: "text", mono: false, fill: false, inFrame: false \}/);
});

test("a textarea inside its screen's frame has no frame of its own and takes the frame's words", () => {
    // Decided on 2026-11-25 (#1194), as shadcn/ui's InputGroupTextarea sits in an InputGroup.
    const css = read("Field.css.ts");
    const inFrame = css.slice(css.indexOf("inFrame: {"), css.indexOf("false: {},", css.indexOf("inFrame: {")));
    for (const rule of [/minHeight: 0,/, /padding: 0,/, /background: "transparent",/, /border: 0,/, /borderRadius: 0,/, /color: "inherit",/,
        /fontSize: "inherit",/, /lineHeight: "inherit",/, /"&:focus-visible": \{ outline: "none" \}/]) {
        assert.match(inFrame, rule);
    }
    // The placeholder keeps the field's color: the frame sets none.
    assert.doesNotMatch(inFrame, /placeholder/);
});

test("rows are divided by a hairline, groups by space; only field rows stack when narrow", () => {
    const css = read("Setting.css.ts");
    assert.match(css, /\[`\$\{rows\} > & \+ &`\]: \{ borderTop: `\.1rem solid \$\{vars\.vox_border\}` \}/);
    assert.match(css, /"& \+ &": \{ marginTop: "3\.2rem" \}/);
    const field = css.slice(css.indexOf("field: {"), css.indexOf("inline: {"));
    assert.match(field, /"\(max-width: 35\.6rem\)": \{ gridTemplateColumns: "minmax\(0, 1fr\)"/);
    assert.match(field, /"\(max-width: 700px\)"/);
    const inline = css.slice(css.indexOf("inline: {"));
    assert.doesNotMatch(inline.split("\n")[0], /@container|@media/);
    assert.match(css, /"&\[data-changed='true'\]::before"/);
});

test("a row's label names its control and its description describes it", () => {
    const row = read("Setting.tsx");
    assert.match(row, /<label htmlFor=\{id\}/);
    assert.match(row, /children\(\{ id, "aria-describedby": descriptionId \}\)/);
    assert.match(row, /<section className=\{styles\.group\} aria-labelledby=\{headingId\}>/);
});

test("a card keeps the catalogs' look: its room and frame, no fill and no shadow; the one in use the active frame and tint (D-28)", () => {
    const css = read("Card.css.ts");
    const base = css.slice(css.indexOf("base: {"), css.indexOf("variants: {"));
    assert.match(base, /display: "grid",\s*gap: "1\.2rem",\s*minWidth: 0,\s*padding: "1\.6rem",\s*border: `\.1rem solid \$\{vars\.dark_800_color\}`,\s*borderRadius: vars\.vox_radius,/);
    assert.doesNotMatch(base, /background|boxShadow/, "no fill and no shadow");
    assert.match(css, /true: \{ borderColor: vars\.vox_state_active, background: vars\.vox_highlight_tint \}/);
    // The parts: the name's block tight inside, the content and the footer a little apart inside.
    assert.match(css, /export const header = style\(\{ display: "grid", gap: "\.4rem", minWidth: 0 \}\);/);
    assert.match(css, /export const title = style\(\{ fontSize: "1\.5rem", fontWeight: 600, color: vars\.dark_200_color \}\);/);
    assert.match(css, /export const content = style\(\{ display: "grid", gap: "\.8rem", minWidth: 0 \}\);/);
    assert.match(css, /export const footer = style\(\{ display: "grid", gap: "\.8rem", minWidth: 0 \}\);/);
});

test("a badge keeps its square corners and says its state in words; fills and marks only repeat them (D-29)", () => {
    const css = read("Badge.css.ts");
    const base = css.slice(css.indexOf("base: {"), css.indexOf("variants: {"));
    assert.match(base, /padding: "\.1rem \.8rem",\s*border: `\.1rem solid \$\{vars\.dark_700_color\}`,\s*borderRadius: "\.4rem",\s*fontSize: "1\.2rem",\s*fontWeight: 500,\s*lineHeight: 1\.6,/);
    assert.doesNotMatch(base, /9999|50%|rounded|background/, "square corners, no fill");
    // A filled badge has dark words; the active tone fills with its own colour.
    assert.match(css, /solid: \{ background: vars\.dark_300_color, borderColor: vars\.dark_300_color, color: vars\.dark_950_color \}/);
    assert.match(css, /\{ variants: \{ tone: "active", variant: "solid" \}, style: \{ background: vars\.vox_state_active, borderColor: vars\.vox_state_active \} \}/);
    assert.match(css, /tint: \{ background: vars\.vox_highlight_tint \}/);
    assert.match(css, /dashed: \{ borderStyle: "dashed" \}/);
    // The check is a filled circle with a tick, the ring an empty circle, drawn in the words' colour.
    assert.match(css, /const CHECK = mask\("[^"]*%3Cpath d='M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1z/);
    assert.match(css, /const RING = mask\("[^"]*%3Ccircle cx='8' cy='8' r='5\.6' fill='none'/);
    assert.match(css, /backgroundColor: "currentColor",\s*WebkitMask: shape,\s*mask: shape,/);
    assert.match(css, /"&::before": \{ content: '"!"' \}/);
});

test("the gallery is served by the dev server only", () => {
    const vite = readFileSync(new URL("../../../vite.config.js", import.meta.url), "utf8");
    assert.doesNotMatch(vite, /kit-lab/);
    assert.match(readFileSync(new URL("../../kit-lab.html", import.meta.url), "utf8"), /views\/kit_lab\/index\.tsx/);
});

test("toggles and popovers are Radix's; a popover is not modal, so no <style> is added at run time", () => {
    assert.match(read("Toggle.tsx"), /from "@radix-ui\/react-toggle"/);
    assert.match(read("Toggle.tsx"), /from "@radix-ui\/react-toggle-group"/);
    const popover = read("Popover.tsx");
    assert.match(popover, /from "@radix-ui\/react-popover"/);
    // Radix's popover is modal only when asked; the kit never asks (react-remove-scroll would add a <style>).
    assert.doesNotMatch(popover, /\bmodal\s*[=:{]/);
    // Mute keeps its amber while pressed (D-27): the warning tone of the toggle.
    assert.match(read("Toggle.css.ts"), /warning: \{\s*selectors: \{\s*\[on\]: \{ borderColor: vars\.vox_state_warning, color: vars\.vox_state_warning/);
});
