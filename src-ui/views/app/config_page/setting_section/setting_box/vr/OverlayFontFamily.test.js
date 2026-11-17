import assert from "node:assert/strict";
import { test } from "node:test";
import { hooks, loadModule } from "../../../../../../logics/test/hookHarness.js";
import { missingLanguagesText } from "../../../../../../logics/common/fontLanguages.ts";

async function render({ selected = "", missing = [], open = true, fonts = { "Noto Sans": "Noto Sans" } } = {}) {
    const runtime = hooks(), asked = [], chosen = [];
    const { OverlayFontFamily } = await loadModule(new URL("./OverlayFontFamily.jsx", import.meta.url), runtime, {
        "@store": { useStore_SelectableFontFamilyList: () => ({ currentSelectableFontFamilyList: { data: fonts } }) },
        "@logics_configs": { useVr: () => ({
            currentOverlayFontFamily: { data: selected, state: "ok" },
            setOverlayFontFamily: value => chosen.push(value),
            currentOverlayFontMissingLanguages: { data: missing },
            getOverlayFontMissingLanguages: () => asked.push(true),
        }) },
        "@logics_common": { useIsOpenedConfigPage: () => ({ currentIsOpenedConfigPage: { data: open } }) },
        "../_templates/Templates": { DropdownMenuContainer: "dropdown" },
        "../../../../../../logics/common/fontLanguages.ts": { missingLanguagesText },
    });
    const tree = runtime.render(OverlayFontFamily, {});
    return { props: tree.props, asked, chosen };
}

test("the list offers automatic first, then this PC's fonts, and a saved font that is gone", async () => {
    const auto = await render();
    assert.deepEqual(Object.keys(auto.props.list), ["", "Noto Sans"]);
    assert.equal(auto.props.selected_id, "");
    auto.props.selectFunction({ selected_id: "Noto Sans" });
    assert.deepEqual(auto.chosen, ["Noto Sans"]);

    const gone = await render({ selected: "Gone Sans" });
    assert.deepEqual(Object.keys(gone.props.list), ["", "Gone Sans", "Noto Sans"]);
    assert.equal(gone.props.list["Gone Sans"], "config_page.vr.overlay_font_family.not_installed");
});

test("the description warns when no font here can show a language, asked for when the settings open", async () => {
    const fine = await render();
    assert.equal(fine.props.desc, "config_page.vr.overlay_font_family.desc");
    assert.equal(fine.asked.length, 1);

    const missing = await render({ missing: ["Japanese"] });
    assert.equal(missing.props.desc, "config_page.vr.overlay_font_family.desc\nconfig_page.vr.overlay_font_family.missing");

    const closed = await render({ open: false });
    assert.equal(closed.asked.length, 0);
});
