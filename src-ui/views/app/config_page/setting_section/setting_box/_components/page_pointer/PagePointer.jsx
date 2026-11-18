import { useStore_SelectedConfigTabId } from "@store";
import { FormRow } from "../form_row/FormRow";
import styles from "./PagePointer.module.scss";
import { revealSetting } from "../../../../../../../logics/configs/revealSetting.ts";

// A row that only leads to another page, where the setting lives (#554, IA-03): what is set
// there on the left, and in the control column a button whose words name the page it opens
// (#537, DESIGN.md "Where a button sits"). The setting itself has one place; other pages
// that touch it carry this row instead of a second copy of its fields.
// target: the setting's data-setting-id there. The page opens on it, with the folds around
// it opened, so a setting in 「詳細設定」 is not left out of sight.
export const PagePointer = ({ label, description, tab, button, target = null }) => {
    const { updateSelectedConfigTabId } = useStore_SelectedConfigTabId();
    const open = () => {
        updateSelectedConfigTabId(tab);
        if (target) revealSetting({ setting_id: target });
    };
    return <FormRow group label={label} description={description} fold={false}>
        <button type="button" className={styles.open_page} data-page-pointer={tab} onClick={open}>{button}</button>
    </FormRow>;
};
