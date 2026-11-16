import { useEffect } from "react";
import { useI18n } from "@useI18n";
import { useStore_SelectableFontFamilyList } from "@store";
import { useVr } from "@logics_configs";
import { useIsOpenedConfigPage } from "@logics_common";
import { DropdownMenuContainer } from "../_templates/Templates";
import { missingLanguagesText } from "../../../../../../logics/common/fontLanguages.js";

// The subtitles' font, from the fonts on this PC (the same list as the app's font). No font is
// bundled: when no font here can show a language, the description says so.
export const OverlayFontFamily = () => {
    const { t, i18n } = useI18n();
    const {
        currentOverlayFontFamily,
        setOverlayFontFamily,
        currentOverlayFontMissingLanguages,
        getOverlayFontMissingLanguages,
    } = useVr();
    const { currentSelectableFontFamilyList } = useStore_SelectableFontFamilyList();
    const { currentIsOpenedConfigPage } = useIsOpenedConfigPage();

    // Fonts can be added while the app runs; ask again each time the settings open.
    useEffect(() => {
        if (currentIsOpenedConfigPage.data === true) getOverlayFontMissingLanguages();
    }, [currentIsOpenedConfigPage.data]);

    const fonts = currentSelectableFontFamilyList.data ?? {};
    const selected = currentOverlayFontFamily.data ?? "";
    const list = { "": t("config_page.vr.overlay_font_family.auto") };
    // A saved font that is gone stays listed with a note (the subtitles use the automatic fonts).
    if (selected !== "" && Object.keys(fonts).length && !(selected in fonts)) {
        list[selected] = t("config_page.vr.overlay_font_family.not_installed", { name: selected });
    }
    Object.assign(list, fonts);

    const missing = Array.isArray(currentOverlayFontMissingLanguages.data) ? currentOverlayFontMissingLanguages.data : [];
    const desc = missing.length
        ? `${t("config_page.vr.overlay_font_family.desc")}\n${t("config_page.vr.overlay_font_family.missing",
            { languages: missingLanguagesText(missing, i18n?.language) })}`
        : t("config_page.vr.overlay_font_family.desc");

    return (
        <DropdownMenuContainer
            setting_id="overlay_font_family"
            dropdown_id="overlay_font_family"
            label={t("config_page.vr.overlay_font_family.label")}
            desc={desc}
            selected_id={selected}
            list={list}
            selectFunction={(selected_data) => setOverlayFontFamily(selected_data.selected_id)}
            state={currentOverlayFontFamily.state}
        />
    );
};
