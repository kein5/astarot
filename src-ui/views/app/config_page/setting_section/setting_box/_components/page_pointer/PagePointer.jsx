import { useStore_SelectedConfigTabId } from "@store";
import { FormRow } from "../form_row/FormRow";

// A row that only leads to another page, where the setting lives (#554, IA-03): what is set
// there on the left, and in the control column a button whose words name the page it opens
// (#537, DESIGN.md "Where a button sits"). The setting itself has one place; other pages
// that touch it carry this row instead of a second copy of its fields.
export const PagePointer = ({ label, description, tab, button }) => {
    const { updateSelectedConfigTabId } = useStore_SelectedConfigTabId();
    return <FormRow group label={label} description={description} fold={false}>
        <button type="button" data-page-pointer={tab} onClick={() => updateSelectedConfigTabId(tab)}>{button}</button>
    </FormRow>;
};
