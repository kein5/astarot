import { useI18n } from "@useI18n";
import { useAppearance } from "@logics_configs";
import { Button } from "../../../../../kit/index.ts";
import { Tooltip } from "../../../../../common_components/tooltip/Tooltip";
import { atLogFontLimit, nextLogFontSize } from "../../../../../../logics/main/logFontSize.ts";
import * as styles from "./LogFontButtons.css.ts";

// #1314 (M-8): the log's font size in sight, as the VR toolbar has it: A− and A＋ at the start of
// the composer, away from the send button, so a press meant for them never sends. Each press moves
// the size one mark of the settings' slider. Each button's name says the size now, and its tooltip
// shows that name; at an end of the range the button says so and a press does nothing, but it
// keeps its focus and its tooltip. Until the saved size is read, neither button does anything.
export const LogFontButtons = () => {
    const { t } = useI18n();
    const { currentMessageLogUiScaling, setMessageLogUiScaling } = useAppearance();
    const size = currentMessageLogUiScaling.data;
    const known = currentMessageLogUiScaling.state === "ok" && typeof size === "number" && Number.isFinite(size);
    const button = (direction: -1 | 1) => {
        const side = direction < 0 ? "smaller" : "larger";
        const limit = known && atLogFontLimit(size, direction);
        const name = !known ? t(`main_page.log_font.${side}`)
            : limit ? t(`main_page.log_font.${direction < 0 ? "smallest" : "largest"}`, { size })
            : t(`main_page.log_font.${side}_now`, { size });
        return <Tooltip bare placement="top" title={name}>
            <Button size="compact" className={styles.button} aria-label={name} aria-disabled={!known || limit ? true : undefined}
                data-log-font={side}
                onClick={() => { if (known && !limit) setMessageLogUiScaling(nextLogFontSize(size, direction)); }}>
                {/* i18n-exempt: a font-size symbol, as on the VR toolbar; the button's name says smaller or larger */}
                {direction < 0 ? "A−" : "A＋"}
            </Button>
        </Tooltip>;
    };
    return <div className={styles.group} role="group" aria-label={t("config_page.appearance.textbox_ui_size.label")}>
        {button(-1)}
        {button(1)}
    </div>;
};
