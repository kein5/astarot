import type { ReactNode } from "react";
import { useI18n } from "@useI18n";
import { useStore_SelectedConfigTabId } from "@store";
import { FormRow } from "../form_row/FormRow";
import * as styles from "./PagePointer.css.ts";
import { revealSetting } from "../../../../../../../logics/configs/revealSetting.ts";
import { TabIcon } from "../../../../sidebar_section/SidebarSection";

type Translate = (key: string, options?: Record<string, unknown>) => string;

// The words of a button that opens another settings page (#537): the page's name, as its tab
// and heading say it, and what is done there, in one label, 「「デバイス」で音声経路を変更」. A
// button that only said 「音声経路を変更」 looked as if the change happened here. Without an
// action the page as a whole is the reason to go, 「「チャット読み取り（OCR）」を開く」.
export const pageLinkLabel = (t: Translate, tab: string, action: string | null = null) => {
    const page = t(`config_page.side_menu_labels.${tab}`);
    return action ? t("config_page.page_link.do", { page, action }) : t("config_page.page_link.open", { page });
};

// The button itself: the page's icon from the settings menu leads, so it is seen as the way to
// that tab before it is read (#614). The icon is decoration; the words carry the name.
// target: the setting's data-setting-id there. The page opens on it, with the folds around
// it opened, so a setting in 「詳細設定」 is not left out of sight.
export interface PageLinkButtonProps {
    // The settings tab to open (settingsMenu.ts).
    tab: string;
    action?: string | null;
    target?: string | null;
    className?: string | null;
}

export const PageLinkButton = ({ tab, action = null, target = null, className = null }: PageLinkButtonProps) => {
    const { t } = useI18n();
    const { updateSelectedConfigTabId } = useStore_SelectedConfigTabId();
    const open = () => {
        updateSelectedConfigTabId(tab);
        if (target) revealSetting({ setting_id: target });
    };
    return <button type="button" className={className ? `${styles.open_page} ${className}` : styles.open_page} data-page-pointer={tab} onClick={open}>
        <span className={styles.page_icon} aria-hidden="true"><TabIcon tab_id={tab} className={styles.page_icon_svg} /></span>
        <span>{pageLinkLabel(t, tab, action)}</span>
    </button>;
};

// A row that only leads to another page, where the setting lives (#554, IA-03): what is set
// there on the left, and in the control column the button above (DESIGN.md "Where a button
// sits"). The setting itself has one place; other pages that touch it carry this row instead
// of a second copy of its fields.
export interface PagePointerProps {
    label: ReactNode;
    description?: string;
    tab: string;
    action?: string | null;
    target?: string | null;
}

export const PagePointer = ({ label, description, tab, action, target = null }: PagePointerProps) =>
    <FormRow group label={label} description={description} fold={false}>
        <PageLinkButton tab={tab} action={action} target={target} />
    </FormRow>;
