import { useLanguageSettings } from "@logics_main";
import { ToggleGroup, ToggleGroupItem } from "../../../../../kit/index.ts";
import * as styles from "./PresetTabSelector.css.ts";

const PRESETS = ["1", "2", "3"] as const;

// The three presets beside the 「言語設定」 heading, as the kit's ToggleGroup (D-27, decided on
// 2026-11-25): three radios named by their numbers, the preset in use checked. Each is a stop of
// the Tab key, as the three buttons were (rovingFocus off). While the language settings are busy
// they stay focusable but dimmed (aria-disabled) and a press waits. Pressing the preset in use with
// the pointer changes nothing (Radix offers an empty value then); Enter and Space act on the key
// going down, once while it is held, and ask for the preset even when it is the one in use, as
// they did before the kit. The preset in use is the engine's: a placeholder until it is sent
// (data-skeleton, MainPage.css.ts).
export const PresetTabSelector = () => {
    const { canChangeLanguageSettings, isLanguageSettingsBusy, currentSelectedPresetTabNumber, setSelectedPresetTabNumber } = useLanguageSettings();
    const press = (preset_number: string) => {
        if (!canChangeLanguageSettings()) return;
        setSelectedPresetTabNumber(preset_number);
    };
    const selected = currentSelectedPresetTabNumber.data;

    return (
        <ToggleGroup type="single" rovingFocus={false} className={styles.container} value={selected}
            onValueChange={value => { if (value && value !== selected) press(value); }}>
            {PRESETS.map(preset_number => (
                <ToggleGroupItem key={preset_number} value={preset_number} className={styles.tab} data-skeleton=""
                    aria-disabled={isLanguageSettingsBusy}
                    onKeyDown={event => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); if (event.repeat) return; press(preset_number); } }}>
                    {preset_number}
                </ToggleGroupItem>
            ))}
        </ToggleGroup>
    );
};
