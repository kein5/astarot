import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { hooks, loadModule } from "../../../logics/test/hookHarness.ts";

const read = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");

test("Empty and its description carry shadcn/ui's data-slot and pass their props on", async () => {
    const runtime = hooks();
    const { Empty, EmptyDescription } = await loadModule<typeof import("./Empty.tsx")>(new URL("./Empty.tsx", import.meta.url), runtime);
    const empty = runtime.render(Empty, { role: "status", className: "extra", children: "x" });
    assert.equal(empty.type, "div");
    assert.equal(empty.props["data-slot"], "empty");
    assert.equal(empty.props.role, "status");
    assert.equal(empty.props.className, "empty extra");
    const description = runtime.render(EmptyDescription, { children: "Nothing found" });
    assert.equal(description.type, "p");
    assert.equal(description.props["data-slot"], "empty-description");
    assert.equal(description.props.children, "Nothing found");
    runtime.unmount();
});

test("Empty is a centred column and its words are the description text", () => {
    const css = read("Empty.css.ts");
    // flex-col items-center justify-center gap-6 p-6 text-center text-balance
    assert.match(css, /flexDirection: "column",\s*alignItems: "center",\s*justifyContent: "center",\s*gap: "2\.4rem",/);
    assert.match(css, /padding: "2\.4rem",\s*textAlign: "center",\s*textWrap: "balance",/);
    // text-sm in the muted colour (D-02's description text).
    assert.match(css, /fontSize: "1\.4rem",\s*lineHeight: 1\.6,\s*color: vars\.vox_description_text,/);
});
