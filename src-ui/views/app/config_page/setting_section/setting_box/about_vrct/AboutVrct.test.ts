import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";
import i18next from "i18next";
import clsx from "clsx";
import { hooks, loadModule, findIn, nodesIn, componentName, draw, stubGlobals, eventTarget, unchecked } from "../../../../../../logics/test/hookHarness.ts";
import { readLocale, localeAt, textAt, branchAt } from "../../../../../../logics/test/locales.ts";
import type { TreeNode } from "../../../../../../logics/test/hookHarness.ts";
import type { ColorEntryWithSaveButtonProps } from "../_components/color_entry_with_save_button/ColorEntryWithSaveButton.tsx";

const resources = Object.fromEntries(["en", "ja"].map(language => [language, { translation: readLocale(language) }]));
const all = (tree: unknown, predicate: (node: TreeNode) => boolean) => nodesIn(tree).filter(predicate);
const translate = async (language: string) => {
    const i18n = i18next.createInstance();
    await i18n.init({ lng: language, fallbackLng: false, resources });
    return { i18n, t: i18n.t.bind(i18n) };
};

for (const language of ["en", "ja"]) {
    test(`${language}: every About image link names its destination/person and credit images have text equivalents`, async () => {
        const translation = await translate(language), runtime = hooks();
        const source = await readFile(new URL("./AboutVrct.tsx", import.meta.url), "utf8");
        const images = Object.fromEntries([...source.matchAll(/from "(@images\/[^"]+)"/g)].map(match => [match[1], match[1]]));
        const { AboutVrct } = await loadModule<typeof import("./AboutVrct.tsx")>(new URL("./AboutVrct.tsx", import.meta.url), runtime, {
            ...images, "@useI18n": { useI18n: () => translation },
            "@logics_configs": { useAppearance: () => ({ currentUiLanguage: { data: language } }) },
            "@logics_common": { useSoftwareVersion: () => ({ currentSoftwareVersion: { data: "test" } }) },
            "@ui_configs": { upstream_vrct_document_url: () => "https://example.test/docs" },
        });
        const tree = runtime.render(AboutVrct);
        const links = all(tree, node => node.props?.href_id);
        assert.equal(links.length, 12);
        const names = [];
        for (const component of links) {
            // A link of the page's own: what it draws is the anchor.
            const link = draw(component), name = link.props["aria-label"];
            assert.equal(link.type, "a"); assert.ok(link.props.href);
            assert.ok(name && !name.startsWith("config_page."));
            assert.equal(findIn(link, node => node.type === "img").props.alt, "");
            assert.equal(name, translation.t(`config_page.about_vrct.image_links.${component.props.href_id}`));
            names.push(name);
        }
        assert.equal(new Set(names).size, 12);
        const creditImages = all(tree, node => node.type === "img");
        assert.equal(creditImages.length, 15);
        for (const image of creditImages) {
            assert.ok(image.props.alt && !image.props.alt.startsWith("config_page."), image.props.src);
        }
        const disclaimer = findIn(tree, node => node.props?.className === "vrchat_disclaimer");
        // The trademark notice keeps its original English wording in every locale.
        assert.equal(disclaimer.props.lang, "en");
        assert.match(disclaimer.props.children, /not endorsed by VRChat/);
    });

    test(`${language}: color swatches identify the field and expose expansion`, async t => {
        const translation = await translate(language), runtime = hooks();
        stubGlobals(t, { document: eventTarget(), window: eventTarget() });
        const { ColorEntryWithSaveButton } = await loadModule<typeof import("../_components/color_entry_with_save_button/ColorEntryWithSaveButton.tsx")>(new URL("../_components/color_entry_with_save_button/ColorEntryWithSaveButton.tsx", import.meta.url), runtime, {
            clsx: { clsx }, "@useI18n": { useI18n: () => translation },
            "../_atoms/_entry/_Entry": { _Entry: "entry" }, "react-colorful": { HexColorPicker: "picker" },
        });
        // Test data: a swatch that is only opened, so without the save it never calls.
        const swatch = (label: string) => unchecked<ColorEntryWithSaveButtonProps>({ label, variable: "#FFFFFF" });
        const names = [];
        for (const label of language === "ja" ? ["文字色", "背景色"] : ["Text color", "Background color"]) {
            const tree = runtime.render(ColorEntryWithSaveButton, swatch(label));
            const button = findIn(tree, node => node.type === "button");
            assert.ok(button.props["aria-label"].includes(label));
            names.push(button.props["aria-label"]);
        }
        assert.equal(new Set(names).size, 2);
        let button = findIn(runtime.render(ColorEntryWithSaveButton, swatch("Field")), node => node.type === "button");
        assert.equal(button.props["aria-expanded"], false);
        button.props.onClick();
        button = findIn(runtime.render(ColorEntryWithSaveButton, swatch("Field")), node => node.type === "button");
        assert.equal(button.props["aria-expanded"], true);
        runtime.unmount();
    });

    test(`${language}: both VR duration sliders use localized visible and accessible values`, async () => {
        const translation = await translate(language), runtime = hooks();
        const settings = { opacity: 1, ui_scaling: 1, display_duration: 1, fadeout_duration: 2 };
        const controls = { ui_scaling: {}, display_duration: {}, fadeout_duration: {} };
        const { Vr } = await loadModule<typeof import("../vr/Vr.tsx")>(new URL("../vr/Vr.tsx", import.meta.url), runtime, {
            "@useI18n": { useI18n: () => translation },
            "@ui_configs": { ui_configs: { overlay_small_log: controls } },
            "../_components": { Slider: "slider", SectionLabelComponent: "heading" }, "../_components/form_row/FormRow": { FormRow: "form-row" },
            "../_templates/Templates": { RadioButtonContainer: "radio", CheckboxContainer: "checkbox", ActionButtonContainer: "action" },
            "@common_components": { ResetButton: "reset" }, "../_components/page_pointer/PagePointer": { PagePointer: "pointer" }, "../_components/advanced_section/AdvancedSection": { AdvancedSection: "advanced" }, "@utils": { randomIntMinMax: () => 0 },
            "../_components/hint/Hint": { HintDescriptions: "hints", Hint: "hint", useHintDescriptions: () => false },
            "./DesktopCaptionOverlay": { DesktopCaptionOverlay: "desktop" },
            "./OverlayFontFamily": { OverlayFontFamily: "font" },
            "@logics_configs": { useVr: () => ({ currentOverlaySmallLogSettings: { data: settings }, currentOverlayLargeLogSettings: {} }) },
            "@logics_common": { useIsOpenedConfigPage: () => ({ currentIsOpenedConfigPage: { data: true } }) },
        });
        const root = runtime.render(Vr);
        const overlay = findIn(root, node => node.props?.id === "overlay_settings_small");
        const overlayTree = draw(overlay);
        const other = findIn(overlayTree, node => componentName(node) === "OtherControls");
        const tree = draw(other);
        const durationSliders = all(tree, node => node.type === "slider" && [60, 5].includes(node.props.max));
        assert.equal(durationSliders.length, 2);
        for (const duration of durationSliders) {
            const sliderRuntime = hooks();
            const { Slider } = await loadModule<typeof import("../_components/slider/Slider.tsx")>(new URL("../_components/slider/Slider.tsx", import.meta.url), sliderRuntime, {
                "@logics_configs": { useSliderLogic: () => ({ ui_value: duration.props.variable }) },
            });
            const slider = sliderRuntime.render(Slider, duration.props);
            const thumb = findIn(slider, node => node.props?.role === "slider");
            const expected = translation.t("config_page.common.duration_seconds", { count: duration.props.variable });
            assert.equal(thumb.props["aria-valuetext"], expected);
            assert.equal(findIn(slider, node => node.props?.className === "valueLabelLabel").props.children, expected);
            assert.equal(expected, language === "ja" ? `${duration.props.variable}秒` : duration.props.variable === 1 ? "1 second" : "2 seconds");
        }
    });
}

test("all new locale keys exist in both files without relying on fallback", () => {
    const flatten = (value: object, prefix = ""): string[] => Object.entries(value).flatMap(([key, child]) => typeof child === "object"
        ? flatten(child, `${prefix}${key}.`) : [`${prefix}${key}`]);
    for (const language of ["en", "ja"]) {
        const page = branchAt(resources[language].translation, "config_page");
        const keys = [...flatten(branchAt(page, "about_vrct.image_links")), ...flatten(branchAt(page, "about_vrct.credits"))];
        const other = branchAt(resources[language === "en" ? "ja" : "en"].translation, "config_page");
        assert.deepEqual(keys, [...flatten(branchAt(other, "about_vrct.image_links")), ...flatten(branchAt(other, "about_vrct.credits"))]);
        for (const name of ["open_color_picker", "duration_seconds_one", "duration_seconds_other"]) assert.ok(localeAt(page, `common.${name}`));
        assert.ok(textAt(page, "transcription.mic_word_filter.remove_word").includes("{{word}}"));
    }
});

// #912: every picture on the page carries its natural size (width, height), so the page keeps its
// place before the pictures are decoded. The sizes are read from the files themselves.
test("every picture of the About page carries the natural size of its file", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("./AboutVrct.tsx", import.meta.url), "utf8");
    const files = Object.fromEntries([...source.matchAll(/import (\w+) from "@images\/([^"]+\.(?:png|svg))";/g)].map(([, name, path]) => [name, path]));
    const sizeOf = (path: string): [number, number] => {
        const data = readFileSync(new URL(`../../../../../assets/${path}`, import.meta.url));
        if (path.endsWith(".png")) return [data.readUInt32BE(16), data.readUInt32BE(20)];
        const svg = data.toString("utf8", 0, 600);
        return [Number(/\swidth="(\d+)"/.exec(svg)?.[1]), Number(/\sheight="(\d+)"/.exec(svg)?.[1])];
    };
    const pictures = [...source.matchAll(/<img src=\{(\w+)\}([^>]*)\/>/g)];
    assert.ok(pictures.length >= 16, String(pictures.length));
    for (const [, name, rest] of pictures.filter(([, name]) => name in files)) {
        const size = /width=\{(\d+)\} height=\{(\d+)\}/.exec(rest);
        assert.ok(size, `${name} has no width and height`);
        assert.deepEqual([Number(size[1]), Number(size[2])], sizeOf(files[name]), name);
    }
    // The link pictures: their size beside each link, and on their img.
    const links = [...source.matchAll(/\{ img: (\w+), size: \[(\d+), (\d+)\], href:/g)];
    assert.ok(links.length >= 12, String(links.length));
    for (const [, name, width, height] of links) assert.deepEqual([Number(width), Number(height)], sizeOf(files[name]), name);
    assert.match(source, /src=\{img\} width=\{link\.size\[0\]\} height=\{link\.size\[1\]\}/);
});
