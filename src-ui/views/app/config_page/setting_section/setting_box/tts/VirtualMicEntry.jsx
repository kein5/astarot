import { useI18n } from "@useI18n";
import { useVirtualMic } from "../../../../../../logics/voice/useVirtualMic";
import { FormRow } from "../_components/form_row/FormRow";

// The way to the virtual microphone guide from the settings, on Windows only (#321). It
// opens the guide; the guide plays its test tone only when asked and changes no setting.
export const VirtualMicEntry = () => {
    const { t } = useI18n();
    const { status, openGuide } = useVirtualMic();
    if (status?.supported !== true) return null;
    const found = status.cables.length > 0;
    // What the guide checks is a description; that no cable was found is a state, kept in sight (#614).
    return <FormRow label={t("virtual_mic.entry.label")} keepDescription={!found}
        description={t(found ? "virtual_mic.entry.found" : "virtual_mic.entry.missing")}>
        <button type="button" onClick={openGuide}>{t("virtual_mic.entry.open")}</button>
    </FormRow>;
};
