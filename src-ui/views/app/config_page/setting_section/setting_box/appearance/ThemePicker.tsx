import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { useI18n } from "@useI18n";
import { useAppearance } from "@logics_configs";
import CheckSvg from "@images/check_mark.svg?react";
import { FormRow } from "../_components/form_row/FormRow";
import { ColorEntryWithSaveButton } from "../_components/color_entry_with_save_button/ColorEntryWithSaveButton";
import {
    CUSTOM, DEFAULT_PRESET, DEFAULT_THEME, PRESETS, accentNearStates, deriveTokens, themeSetting,
} from "../../../../../../logics/theme/themes.ts";
import type { ThemeColors, ThemeSetting } from "../../../../../../logics/theme/themes.ts";
import * as styles from "./ThemePicker.css.ts";

const HEX = /^#[0-9a-f]{6}$/i;
// How often a colour being dragged in the picker is sent: the theme follows the pointer, and the
// engine is not asked for every step of it.
export const SEND_EVERY_MS = 150;

// The theme (#965): a tile for each preset and one for the user's own colours. Choosing a tile
// applies it at once, as the page's other choices do. The user's own colours are kept while a
// preset is in use, so "Custom" brings them back.
export const ThemeContainer = () => {
    const { t } = useI18n();
    const { currentTheme, setTheme } = useAppearance();
    const saved = themeSetting(currentTheme.data) ?? DEFAULT_THEME;
    // A preset this version does not know is drawn, and shown, as the default.
    const inUse = saved.preset === CUSTOM || PRESETS.some(preset => preset.id === saved.preset) ? saved.preset : DEFAULT_PRESET;
    const custom = useCustomColors(saved, setTheme);

    const tiles = [
        ...PRESETS.map(preset => ({ id: preset.id, colors: preset.colors, name: t(`config_page.appearance.theme.presets.${preset.id}`) })),
        { id: CUSTOM, colors: custom.colors, name: t("config_page.appearance.theme.custom") },
    ];
    const near = accentNearStates(custom.colors.accent);

    return (
        <div data-setting-id="theme">
            {/* The row's group wraps the tiles as the window allows. */}
            <FormRow label={t("config_page.appearance.theme.label")} description={t("config_page.appearance.theme.desc")} group>
                {tiles.map(tile => <ThemeTile key={tile.id} {...tile} checked={tile.id === inUse}
                    onChoose={() => setTheme({ preset: tile.id, custom: custom.colors } satisfies ThemeSetting)} />)}
            </FormRow>
            {inUse === CUSTOM && (
                <div className={styles.custom} data-theme-custom>
                    {(["base", "accent"] as const).map(which => (
                        <FormRow key={which} label={t(`config_page.appearance.theme.${which}.label`)} description={t(`config_page.appearance.theme.${which}.desc`)}>
                            <div className={styles.colorField} data-theme-color={which}>
                                <ColorEntryWithSaveButton label={t(`config_page.appearance.theme.${which}.label`)} width="10rem"
                                    variable={custom.texts[which]} onChangeFunction={value => custom.type(which, value)}
                                    saveFunction={custom.flush} />
                            </div>
                        </FormRow>
                    ))}
                    {near.length > 0 && <p className={styles.nearStates} role="status">{t("config_page.appearance.theme.accent_near_states")}</p>}
                </div>
            )}
        </div>
    );
};

interface ThemeTileProps {
    id: string;
    name: string;
    colors: ThemeColors;
    checked: boolean;
    onChoose: () => void;
}

const ThemeTile = ({ id, name, colors, checked, onChoose }: ThemeTileProps) => {
    // The picture's colours are the theme's own, whatever theme the page is drawn in.
    const tokens = useMemo(() => deriveTokens(colors), [colors]);
    return (
        <label className={clsx(styles.tile, { [styles.tileSelected]: checked })} data-theme-option={id}>
            <input type="radio" name="theme" value={id} className={styles.radio} checked={checked}
                onChange={() => { if (!checked) onChoose(); }} />
            <span className={styles.preview} aria-hidden="true" style={{
                "--theme_tile_rail": tokens["--vox_rail"], "--theme_tile_canvas": tokens["--vox_canvas"],
                "--theme_tile_surface": tokens["--vox_surface"], "--theme_tile_accent": tokens["--primary_600_color"],
            }}>
                <span className={styles.previewRail} />
                <span className={styles.previewCanvas}>
                    <span className={styles.previewSurface} />
                    <span className={styles.previewAccent} />
                </span>
            </span>
            <span className={styles.name}>
                {name}
                {checked && <CheckSvg className={styles.check} aria-hidden="true" />}
            </span>
        </label>
    );
};

// The user's own colours as typed or picked. A whole "#rrggbb" applies at once; while a colour is
// dragged it is sent at most every SEND_EVERY_MS, and the last one always.
const useCustomColors = (saved: ThemeSetting, setTheme: (value: ThemeSetting) => unknown) => {
    const [colors, setColors] = useState<ThemeColors>(saved.custom);
    const [texts, setTexts] = useState<ThemeColors>(saved.custom);
    const waiting = useRef<ThemeColors | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const { base, accent } = saved.custom;
    // What the engine keeps, when nothing typed here waits to be sent.
    useEffect(() => {
        if (waiting.current || timer.current) return;
        setColors({ base, accent });
        setTexts({ base, accent });
    }, [base, accent]);
    const send = (value: ThemeColors) => setTheme({ preset: CUSTOM, custom: value });
    const flush = () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        if (waiting.current) send(waiting.current);
        waiting.current = null;
    };
    // Leaving the page sends what still waits.
    const latestFlush = useRef(flush);
    latestFlush.current = flush;
    useEffect(() => () => latestFlush.current(), []);
    const type = (which: keyof ThemeColors, value: string) => {
        setTexts(previous => ({ ...previous, [which]: value }));
        if (!HEX.test(value)) return;
        const next = { ...colors, [which]: value.toLowerCase() };
        setColors(next);
        waiting.current = next;
        // The first step goes at once; the steps after it wait for the pause.
        if (!timer.current) {
            flush();
            timer.current = setTimeout(() => { timer.current = null; flush(); }, SEND_EVERY_MS);
        }
    };
    return { colors, texts, type, flush };
};
