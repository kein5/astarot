import * as styles from "./ExperimentalFeatures.css.ts";
import { useI18n } from "@useI18n";
import { useExperimentalFeatures } from "@logics_configs";
import {
    EXPERIMENTAL_FEATURES,
    isExperimentalFeatureEnabled,
    experimentalFeatureLabelKey,
    experimentalFeatureDescKey,
    experimentalFeatureRequest,
} from "../../../../../../logics/configs/experimentalFeatures.ts";
import type { ExperimentalFeature, ExperimentalFeatureValues } from "../../../../../../logics/configs/experimentalFeatures.ts";
import { DropdownMenuContainer, SwitchBoxContainer } from "../_templates/Templates";
import { EDGES } from "../../../../../../logics/companion/hexagram.ts";

type Current = { state?: string; data?: unknown };

type ListProps = {
    features: readonly ExperimentalFeature[];
    current: Current;
    setValues: (values: ExperimentalFeatureValues) => unknown;
    // The tray companion's own setting: the screen edge its hexagram hides at.
    edge?: { current: Current; set: (edge: string) => unknown };
};

// Features that came from the experimental branch after their hands-on checks. Every one is
// off until the user turns it on here (Issue #361).
export const ExperimentalFeatures = () => {
    const { currentExperimentalFeatures, setExperimentalFeatures, currentTrayCompanionEdge, setTrayCompanionEdge } =
        useExperimentalFeatures() as {
            currentExperimentalFeatures: Current;
            setExperimentalFeatures: ListProps["setValues"];
            currentTrayCompanionEdge: Current;
            setTrayCompanionEdge: (edge: string) => unknown;
        };
    return (
        <ExperimentalFeatureList
            features={EXPERIMENTAL_FEATURES}
            current={currentExperimentalFeatures}
            setValues={setExperimentalFeatures}
            edge={{ current: currentTrayCompanionEdge, set: setTrayCompanionEdge }}
        />
    );
};

export const ExperimentalFeatureList = ({ features, current, setValues, edge }: ListProps) => {
    const { t } = useI18n();
    return (
        <div className={styles.container}>
            <p className={styles.notice}>{t("config_page.experimental_features.notice")}</p>
            {features.length === 0
                ? <p className={styles.empty}>{t("config_page.experimental_features.empty")}</p>
                : features.map(({ id }) => {
                    const enabled = isExperimentalFeatureEnabled(current.data, id);
                    return (
                        <div key={id}>
                            <SwitchBoxContainer
                                setting_id={`experimental_features.${id}`}
                                label={t(experimentalFeatureLabelKey(id))}
                                desc={t(experimentalFeatureDescKey(id))}
                                variable={{ state: current.state, data: enabled }}
                                toggleFunction={() => setValues(experimentalFeatureRequest(id, !enabled))}
                            />
                            {id === "tray_companion" && enabled && edge && <TrayCompanionEdge {...edge} />}
                        </div>
                    );
                })}
        </div>
    );
};

// Where the tray companion's hexagram hides: shown under its switch while it is on.
const TrayCompanionEdge = ({ current, set }: NonNullable<ListProps["edge"]>) => {
    const { t } = useI18n();
    const key = "config_page.experimental_features.items.tray_companion.edge";
    const list = Object.fromEntries(EDGES.map(edge => [edge, t(`${key}.${edge}`)]));
    return (
        <DropdownMenuContainer
            setting_id="experimental_features.tray_companion.edge"
            dropdown_id="tray_companion_edge"
            label={t(`${key}.label`)}
            desc={t(`${key}.desc`)}
            selected_id={typeof current.data === "string" ? current.data : "right"}
            list={list}
            selectFunction={(selected: { selected_id: string }) => set(selected.selected_id)}
            state={current.state}
        />
    );
};
