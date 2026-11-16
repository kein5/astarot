import { useSettingValue } from "./config_page_setter/ui_config_setter.js";
import { isExperimentalFeatureEnabled } from "./experimentalFeatures.js";

// Whether the user turned an experimental feature on. Code that belongs to the feature mounts
// or runs only while this is true; see experimentalFeatures.js.
export const useExperimentalFeature = id => {
    const { data } = useSettingValue("ExperimentalFeatures");
    return isExperimentalFeatureEnabled(data, id);
};
