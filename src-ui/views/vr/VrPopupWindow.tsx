import { VrLanguageWindow } from "./VrLanguageWindow";
import { VrSettingsWindow } from "./VrSettingsWindow";
import { VrIoFlowWindow } from "./VrIoFlowWindow";
import { VrWindowsMenu } from "./VrWindowsMenu";

// The temporary windows; one at a time. "windows" lists the other three (#1314, V-4).
export type VrPopup = "language" | "settings" | "io_flow" | "windows";

// 一時ウィンドウ (言語 / VR設定 / 入力と出力、それを並べたメニュー)。同時に1つだけ開く
export const VrPopupWindow = ({ popup, onOpen, onClose }: { popup: VrPopup | null; onOpen: (popup: VrPopup) => void; onClose: () => void }) => {
    if (popup === "language") {
        return <VrLanguageWindow onClose={onClose} />;
    }
    if (popup === "settings") {
        return <VrSettingsWindow onClose={onClose} />;
    }
    if (popup === "io_flow") {
        return <VrIoFlowWindow onClose={onClose} />;
    }
    if (popup === "windows") {
        return <VrWindowsMenu onOpen={onOpen} onClose={onClose} />;
    }
    return null;
};
