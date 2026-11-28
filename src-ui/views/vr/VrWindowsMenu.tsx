import { useI18n } from "@useI18n";
import ConfigurationSvg from "@images/configuration.svg?react";
import LanguageSvg from "@images/mui_language.svg?react";
import FlowSvg from "@images/io_flow.svg?react";
import { VrWindow } from "./VrWindow";
import type { VrPopup } from "./VrPopupWindow";
import { WindowsSvg } from "./VrLauncherIcons";
import * as styles from "./VrWindowsMenu.css.ts";

// The launcher has room for eight buttons (#1248). The text to speech switch and its stop took two
// of them (#1314, V-4), so the windows opened now and then share one button: it opens this list, and
// a row opens its window in the same place. The log, opened most, keeps its own button.
export const VrWindowsMenu = ({ onOpen, onClose }: { onOpen: (popup: VrPopup) => void; onClose: () => void }) => {
    const { t } = useI18n();
    const rows: { popup: VrPopup; Icon: typeof LanguageSvg; label: string }[] = [
        { popup: "language", Icon: LanguageSvg, label: t("vr_panel.window_language") },
        { popup: "io_flow", Icon: FlowSvg, label: t("io_flow.vr_window") },
        { popup: "settings", Icon: ConfigurationSvg, label: t("vr_panel.window_settings") },
    ];
    return <VrWindow Icon={WindowsSvg} title={t("vr_panel.window_more")} onClose={onClose} is_lockable={false}>
        <div className={styles.body}>
            {rows.map(({ popup, Icon, label }) => (
                <button key={popup} type="button" className={styles.row} onClick={() => onOpen(popup)}>
                    <Icon className={styles.icon} aria-hidden="true" />
                    <span>{label}</span>
                </button>
            ))}
        </div>
    </VrWindow>;
};
