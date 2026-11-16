import styles from "./ExperimentalFeatures.module.scss";
import { useI18n } from "@useI18n";
import { useExperimentalFeatures } from "@logics_configs";
import {
    EXPERIMENTAL_FEATURES,
    isExperimentalFeatureEnabled,
    experimentalFeatureLabelKey,
    experimentalFeatureDescKey,
    experimentalFeatureRequest,
} from "../../../../../../logics/configs/experimentalFeatures.js";
import { SwitchBoxContainer } from "../_templates/Templates";

// Features that came from the experimental branch after their hands-on checks. Every one is
// off until the user turns it on here (Issue #361).
export const ExperimentalFeatures = () => {
    const { currentExperimentalFeatures, setExperimentalFeatures } = useExperimentalFeatures();
    return (
        <ExperimentalFeatureList
            features={EXPERIMENTAL_FEATURES}
            current={currentExperimentalFeatures}
            setValues={setExperimentalFeatures}
        />
    );
};

export const ExperimentalFeatureList = ({ features, current, setValues }) => {
    const { t } = useI18n();
    return (
        <div className={styles.container}>
            <p className={styles.notice}>{t("config_page.experimental_features.notice")}</p>
            {features.length === 0
                ? <p className={styles.empty}>{t("config_page.experimental_features.empty")}</p>
                : features.map(({ id }) => {
                    const enabled = isExperimentalFeatureEnabled(current.data, id);
                    return (
                        <SwitchBoxContainer
                            key={id}
                            setting_id={`experimental_features.${id}`}
                            label={t(experimentalFeatureLabelKey(id))}
                            desc={t(experimentalFeatureDescKey(id))}
                            variable={{ state: current.state, data: enabled }}
                            toggleFunction={() => setValues(experimentalFeatureRequest(id, !enabled))}
                        />
                    );
                })}
        </div>
    );
};
