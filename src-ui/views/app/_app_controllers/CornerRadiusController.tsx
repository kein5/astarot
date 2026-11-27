import { useState, useEffect } from "react";
import { useWindowMaximized } from "@logics_common";

export const CornerRadiusController = () => {
    const [is_win11, setIsWin11] = useState(false);
    const is_maximized = useWindowMaximized();

    // OS 判定（Win11 なら platformVersion の major ≥13）
    useEffect(() => {
        if (navigator.userAgentData?.getHighEntropyValues) {
            navigator.userAgentData
                .getHighEntropyValues(["platformVersion"])
                .then(({ platformVersion }) => {
                    // Without a version the major is NaN, which is not Windows 11.
                    const major = parseInt((platformVersion ?? "").split(".")[0], 10);
                    setIsWin11(major >= 13);
                })
                .catch(() => {
                    setIsWin11(false);
                })
        } else {
            // フォールバックで Win10 扱い
            setIsWin11(false);
        }
    }, [])


    // 角丸の適用
    useEffect(() => {
        const radius = is_win11 && !is_maximized ? "10px" : "0";
        document.body.style.borderRadius = radius;
    }, [is_win11, is_maximized]);

    return null;
}