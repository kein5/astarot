import { store, useStore_SettingBoxScrollPosition } from "@store";

// The settings page's scroll container. SettingSection sets it in a layout effect, before
// any effect of the page can ask for it.
const container = () => store.setting_box_scroll_container?.current;

export const useSettingBoxScrollPosition = () => {
    const { currentSettingBoxScrollPosition, updateSettingBoxScrollPosition } = useStore_SettingBoxScrollPosition();

    const saveScrollPosition = () => {
        const element = container();
        if (element) {
            updateSettingBoxScrollPosition(element.scrollTop);
        }
    };
    const restoreScrollPosition = () => {
        const element = container();
        if (element) {
            updateSettingBoxScrollPosition((pre) => {
                element.scrollTop = pre.data;
                return pre.data;
            });
        }
    };

    const resetScrollPosition = () => {
        const element = container();
        if (element) {
            element.scrollTop = 0;
            updateSettingBoxScrollPosition(0);
        }
    };

    return {
        saveScrollPosition,
        restoreScrollPosition,
        resetScrollPosition,
        currentSettingBoxScrollPosition,
        updateSettingBoxScrollPosition,
    };
};
