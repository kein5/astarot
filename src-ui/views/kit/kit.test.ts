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
    const select = read("Select.tsx");
    for (const slot of ["native-select-wrapper", "native-select", "native-select-icon", "native-select-option", "native-select-optgroup"]) {
        assert.match(select, new RegExp(`data-slot="${slot}"`), slot);
    }
    // The option parts are exported beside the select, as NativeSelectOption and NativeSelectOptGroup are.
    assert.match(read("index.ts"), /export \{ Select, SelectOptGroup, SelectOption,/);
    const toggle = read("Switch.tsx");
    assert.match(toggle, /<RadixSwitch\.Root data-slot="switch"/);
    assert.match(toggle, /<RadixSwitch\.Thumb data-slot="switch-thumb"/);
});

test("a part takes its ref as one of the props, as shadcn/ui's parts do on React 19", () => {
    // DESIGN.md "Components": no forwardRef; the ref goes on with the rest of the props.
    for (const file of ["Button.tsx", "Dialog.tsx", "Select.tsx", "Setting.tsx", "Switch.tsx", "TextField.tsx"]) {
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

test("the gallery is served by the dev server only", () => {
    const vite = readFileSync(new URL("../../../vite.config.js", import.meta.url), "utf8");
    assert.doesNotMatch(vite, /kit-lab/);
    assert.match(readFileSync(new URL("../../kit-lab.html", import.meta.url), "utf8"), /views\/kit_lab\/index\.tsx/);
});
