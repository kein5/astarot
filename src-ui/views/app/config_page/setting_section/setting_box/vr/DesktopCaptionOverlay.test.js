import assert from "node:assert/strict";
import { test } from "node:test";
import { hooks, loadModule, find } from "../../../../../../logics/test/hookHarness.js";
import { flush } from "../../../../../../logics/test/bridgeHarness.js";
import * as adjust from "../../../../../../logics/captionOverlay/adjust.ts";

const DEFAULT_SETTINGS = { position: "bottom", font_size: 28, display_duration: 6, opacity: 0.6 };

async function setup(context, { settings = DEFAULT_SETTINGS, placement = { x: null, y: null } } = {}) {
    const runtime = hooks(), saved = [];
    const { DesktopCaptionOverlay } = await loadModule(new URL("./DesktopCaptionOverlay.jsx", import.meta.url), runtime, {
        "@tauri-apps/api/core": { invoke: async () => true },
        "@useI18n": { useI18n: () => ({ t: key => key }) },
        "@ui_configs": { ui_configs: {
            overlay_desktop_default_settings: DEFAULT_SETTINGS,
            overlay_desktop_default_placement: { x: null, y: null },
        } },
        "@logics_configs": { useVr: () => ({
            currentIsEnabledOverlayDesktop: { data: true, state: "ok" },
            toggleIsEnabledOverlayDesktop: () => {},
            currentOverlayDesktopSettings: { data: settings, state: "ok" },
            setOverlayDesktopSettings: async value => saved.push(["settings", value]),
            currentOverlayDesktopPlacement: { data: placement, state: "ok" },
            setOverlayDesktopPlacement: async value => saved.push(["placement", value]),
            currentIoFlowOverlaySettings: { data: { desktop: false, count: 1 }, state: "ok" },
            setIoFlowOverlaySettings: () => {},
        }) },
        "../_components": { SectionLabelComponent: "section" },
        "../_templates/Templates": { ActionButtonContainer: "action", CheckboxContainer: "checkbox",
            RadioButtonContainer: "radio", SliderContainer: "slider" },
        "../../../../../../logics/captionOverlay/adjust": adjust,
        "@images/redo.svg?react": "redo", "@images/check_mark.svg?react": "check",
        "./Vr.module.scss": {},
    });
    const render = () => runtime.render(DesktopCaptionOverlay);
    render(); await flush();
    context.after(() => runtime.unmount());
    const item = id => find(render(), node => node.props?.setting_id === id);
    return { saved, item };
}

test("the reset puts a dragged window back on its edge and the size back to the default", async context => {
    const s = await setup(context, { settings: { ...DEFAULT_SETTINGS, position: "top", font_size: 44 }, placement: { x: 300, y: 200 } });
    const reset = s.item("desktop_overlay_reset_adjustment");
    assert.equal(reset.props.label, "config_page.vr.desktop_overlay_reset_adjustment.label");
    assert.equal(reset.props.desc, "config_page.vr.desktop_overlay_reset_adjustment.desc");
    await reset.props.onclickFunction();
    // The edge the user chose stays; only what Ctrl changed goes back.
    assert.deepEqual(s.saved, [
        ["placement", { x: null, y: null }],
        ["settings", { ...DEFAULT_SETTINGS, position: "top", font_size: 28 }],
    ]);
});

test("the reset sends nothing that is already at its default", async context => {
    const s = await setup(context);
    await s.item("desktop_overlay_reset_adjustment").props.onclickFunction();
    assert.deepEqual(s.saved, []);
});

test("choosing an edge moves a dragged window back to it", async context => {
    const moved = await setup(context, { placement: { x: 300, y: 200 } });
    moved.item("desktop_overlay_position").props.selectFunction("top");
    assert.deepEqual(moved.saved, [["settings", { ...DEFAULT_SETTINGS, position: "top" }], ["placement", { x: null, y: null }]]);
});

test("choosing an edge for a window that was never dragged saves only the edge", async context => {
    const s = await setup(context);
    s.item("desktop_overlay_position").props.selectFunction("top");
    assert.deepEqual(s.saved, [["settings", { ...DEFAULT_SETTINGS, position: "top" }]]);
    // The controls are explained where they are set.
    assert.equal(s.item("desktop_overlay_position").props.desc, "config_page.vr.desktop_overlay_position.desc");
    assert.equal(s.item("desktop_overlay_font_size").props.desc, "config_page.vr.desktop_overlay_font_size.desc");
});
