import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks } from "./hookHarness.ts";

// The harness runs a render's effects as React does: the layout effects first, then the passive
// ones; for each kind the clean-ups first, then the effects, in the order the component calls
// them; and on unmount the layout effects' clean-ups first. Views rely on it, e.g. the VR language
// window's layout effect reads a change before a passive effect answers it.

test("a render runs its layout effects before its passive ones, each kind in order", () => {
    const runtime = hooks(), ran: string[] = [];
    const component = ({ step }: { step: number }) => {
        runtime.api.useEffect(() => { ran.push(`passive 1 (${step})`); return () => { ran.push(`passive 1 cleaned (${step})`); }; }, [step]);
        runtime.api.useLayoutEffect(() => { ran.push(`layout 1 (${step})`); return () => { ran.push(`layout 1 cleaned (${step})`); }; }, [step]);
        runtime.api.useEffect(() => { ran.push(`passive 2 (${step})`); }, []);
        runtime.api.useLayoutEffect(() => { ran.push(`layout 2 (${step})`); return () => { ran.push(`layout 2 cleaned (${step})`); }; }, [step]);
        return null;
    };
    runtime.render(component, { step: 1 });
    assert.deepEqual(ran, ["layout 1 (1)", "layout 2 (1)", "passive 1 (1)", "passive 2 (1)"]);
    ran.length = 0;
    // A change runs only the effects whose dependencies changed, each after its own clean-up.
    runtime.render(component, { step: 2 });
    assert.deepEqual(ran, ["layout 1 cleaned (1)", "layout 2 cleaned (1)", "layout 1 (2)", "layout 2 (2)",
        "passive 1 cleaned (1)", "passive 1 (2)"]);
    ran.length = 0;
    runtime.unmount();
    assert.deepEqual(ran, ["layout 1 cleaned (2)", "layout 2 cleaned (2)", "passive 1 cleaned (2)"]);
    // Cleaned up once: a second unmount has nothing left to clean.
    ran.length = 0;
    runtime.unmount();
    assert.deepEqual(ran, []);
});
