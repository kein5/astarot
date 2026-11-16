import { useSettingValue } from "./config_page_setter/ui_config_setter.js";
import { isExperimentalFeatureEnabled } from "./experimentalFeatures.ts";

// Whether the user turned an experimental feature on. Code that belongs to the feature mounts
// or runs only while this is true; see experimentalFeatures.ts.
export const useExperimentalFeature = (id: string): boolean => {
    const { data } = useSettingValue("ExperimentalFeatures") as { data: unknown };
    return isExperimentalFeatureEnabled(data, id);
};
