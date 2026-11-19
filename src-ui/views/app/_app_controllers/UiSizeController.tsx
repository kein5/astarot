import { useLayoutEffect } from "react";
import { useAppearance } from "@logics_configs";

// Applied before the browser paints the render that brought the size: with an effect, the
// first frame after the saved size arrived was still drawn at the old size, and what waits
// for the size (the empty conversation's greeting, EmptyState.tsx) showed there first.
export const UiSizeController = () => {
    const { currentUiScaling } = useAppearance();
    const font_size = 62.5 * currentUiScaling.data / 100;

    useLayoutEffect(() => {
        document.documentElement.style.setProperty("font-size", `${font_size}%`);
    }, [currentUiScaling.data]);

    return null;
};