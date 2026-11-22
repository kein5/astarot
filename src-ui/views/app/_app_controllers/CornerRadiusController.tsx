import { useState, useEffect } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { store } from "@store";

export const CornerRadiusController = () => {
    const [is_win11, setIsWin11] = useState(false);
    const [is_maximized, setIsMaximized] = useState(false);

    const appWindow = store.appWindow;

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


    useEffect(() => {
        let unlisten: UnlistenFn | undefined;
        const setup = async () => {
            // The entry point sets the main window before anything is drawn (views/app/index.tsx).
            if (!appWindow) throw new TypeError("The main window is not set (store.appWindow).");
            // 初期状態取得
            setIsMaximized(await appWindow.isMaximized());
            // リサイズ時にも再取得
            const updateMax = () => appWindow.isMaximized().then(setIsMaximized);
            unlisten = await appWindow.listen("tauri://resize", updateMax);
        }
        setup();

        return () => {
            if (unlisten) {
                unlisten();
            }
        }
    }, []);

    // 角丸の適用
    useEffect(() => {
        const radius = is_win11 && !is_maximized ? "10px" : "0";
        document.body.style.borderRadius = radius;
    }, [is_win11, is_maximized]);

    return null;
}