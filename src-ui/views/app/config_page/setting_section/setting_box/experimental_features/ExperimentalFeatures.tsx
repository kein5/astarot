import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import * as styles from "./ExperimentalFeatures.css.ts";
import { useI18n } from "@useI18n";
import { useExperimentalFeatures, useVr } from "@logics_configs";
import { useStdoutToPython } from "@useStdoutToPython";
import RedoSvg from "@images/redo.svg?react";
import CheckMarkSvg from "@images/check_mark.svg?react";
import {
    EXPERIMENTAL_FEATURES,
    isExperimentalFeatureEnabled,
    experimentalFeatureLabelKey,
    experimentalFeatureDescKey,
    experimentalFeatureRequest,
} from "../../../../../../logics/configs/experimentalFeatures.ts";
import type { ExperimentalFeature, ExperimentalFeatureValues } from "../../../../../../logics/configs/experimentalFeatures.ts";
import { ActionButtonContainer, CheckboxContainer, DropdownMenuContainer } from "../_templates/Templates";
import { SectionLabelComponent } from "../_components";
import { EDGES } from "../../../../../../logics/companion/hexagram.ts";

type Current = { state?: string; data?: unknown };

type ListProps = {
    features: readonly ExperimentalFeature[];
    current: Current;
    setValues: (values: ExperimentalFeatureValues) => unknown;
    // The tray companion's own settings: the screen edge its hexagram hides at, and the monitor.
    edge?: { current: Current; set: (edge: string) => unknown };
    monitor?: { current: Current; set: (monitor: string) => unknown; list: () => Promise<MonitorInfo[]> };
    // The VR panel (VR UI), listed here with the features on trial (#554, Q-05).
    vrPanel?: VrPanelProps;
};

// The VR panel keeps its own saved switch (OVERLAY_VR_PANEL, /set/enable/overlay_vr_panel),
// so whoever had it on keeps it on after it moved here from the VR page.
type VrPanelProps = { current: Current; toggle: () => unknown; resetLauncher: () => unknown };

// A connected monitor, as src-tauri/src/companion.rs (companion_monitors) lists it.
export type MonitorInfo = { id: string; number: number; width: number; height: number; primary: boolean };

// While the page is open the list is read again now and then, so a monitor plugged in or out shows.
export const MONITORS_EVERY_MS = 3000;
const PRIMARY_OPTION = "@primary";

// Features that came from the experimental branch after their hands-on checks. Every one is
// off until the user turns it on here (Issue #361).
export const ExperimentalFeatures = () => {
    const { currentIsEnabledOverlayVrPanel, toggleIsEnabledOverlayVrPanel } = useVr();
    const { asyncStdoutToPython } = useStdoutToPython();
    const { currentExperimentalFeatures, setExperimentalFeatures, currentTrayCompanionEdge, setTrayCompanionEdge,
        currentTrayCompanionMonitor, setTrayCompanionMonitor } = useExperimentalFeatures();
    return (
        <ExperimentalFeatureList
            features={EXPERIMENTAL_FEATURES}
            current={currentExperimentalFeatures}
            setValues={setExperimentalFeatures}
            edge={{ current: currentTrayCompanionEdge, set: setTrayCompanionEdge }}
            monitor={{ current: currentTrayCompanionMonitor, set: setTrayCompanionMonitor,
                list: () => invoke<MonitorInfo[]>("companion_monitors") }}
            vrPanel={{ current: currentIsEnabledOverlayVrPanel, toggle: toggleIsEnabledOverlayVrPanel,
                resetLauncher: () => asyncStdoutToPython("/run/vr_launcher_reset") }}
        />
    );
};

export const ExperimentalFeatureList = ({ features, current, setValues, edge, monitor, vrPanel }: ListProps) => {
    const { t } = useI18n();
    return (
        <div className={styles.container}>
            {/* Like every other page, it starts with its category heading, then the notice. */}
            <SectionLabelComponent label={t("config_page.experimental_features.section_label")} />
            <p className={styles.notice}>{t("config_page.experimental_features.notice")}</p>
            {features.length === 0 && !vrPanel
                ? <p className={styles.empty}>{t("config_page.experimental_features.empty")}</p>
                : features.map(({ id }) => {
                    const enabled = isExperimentalFeatureEnabled(current.data, id);
                    return (
                        <div key={id}>
                            <CheckboxContainer
                                setting_id={`experimental_features.${id}`}
                                label={t(experimentalFeatureLabelKey(id))}
                                desc={t(experimentalFeatureDescKey(id))}
                                variable={{ state: current.state, data: enabled }}
                                toggleFunction={() => setValues(experimentalFeatureRequest(id, !enabled))}
                            />
                            {id === "tray_companion" && enabled && edge && <TrayCompanionEdge {...edge} />}
                            {id === "tray_companion" && enabled && monitor && <TrayCompanionMonitor {...monitor} />}
                        </div>
                    );
                })}
            {vrPanel && <VrPanelItem {...vrPanel} />}
        </div>
    );
};

// The wrist launcher and windows inside VR, from upstream VRCT and still on trial in VR.
// The launcher's reset is shown with it while it is on, like the tray companion's settings.
const VrPanelItem = ({ current, toggle, resetLauncher }: VrPanelProps) => {
    const { t } = useI18n();
    const key = "config_page.experimental_features.items.vr_panel";
    return (
        <div>
            <CheckboxContainer
                setting_id="experimental_features.vr_panel"
                label={t(`${key}.label`)}
                desc={t(`${key}.desc`)}
                variable={current}
                toggleFunction={toggle}
            />
            {current.data === true && <ActionButtonContainer
                setting_id="experimental_features.vr_panel.reset_launcher"
                label={t(`${key}.reset_launcher.label`)}
                desc={t(`${key}.reset_launcher.desc`)}
                IconComponent={RedoSvg}
                ClickedIconComponent={CheckMarkSvg}
                clicked_duration={1000}
                onclickFunction={resetLauncher}
            />}
        </div>
    );
};

// Where the tray companion's hexagram hides: shown under its checkbox while it is on.
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

// Which monitor the hexagram shows on: the primary one (the default), or one connected now. A
// chosen monitor that is unplugged stays chosen and is listed as not connected; the hexagram uses
// the primary monitor meanwhile and goes back to it when it is plugged in again.
const TrayCompanionMonitor = ({ current, set, list }: NonNullable<ListProps["monitor"]>) => {
    const { t } = useI18n();
    // null until the first list arrives: the saved monitor is not called unplugged before then.
    const [monitors, setMonitors] = useState<MonitorInfo[] | null>(null);
    // The last read failed. Without a list the saved monitor said "Loading" for as long as the
    // reads kept failing (#563); it now says that the list cannot be read.
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        let live = true;
        const read = () => list().then(next => {
            if (!live) return;
            setMonitors(next);
            setFailed(false);
        }, () => { if (live) setFailed(true); });
        read();
        const timer = setInterval(read, MONITORS_EVERY_MS);
        return () => { live = false; clearInterval(timer); };
    }, []);
    const key = "config_page.experimental_features.items.tray_companion.monitor";
    const selected = typeof current.data === "string" ? current.data : "";
    // The primary monitor is saved as an empty name; the list gives it an id of its own.
    const options: Record<string, string> = { [PRIMARY_OPTION]: t(`${key}.primary`) };
    for (const item of monitors ?? []) {
        const name = t(`${key}.display`, { number: item.number, width: item.width, height: item.height });
        options[item.id] = item.primary ? `${name} ${t(`${key}.is_primary`)}` : name;
    }
    if (selected && !(selected in options)) {
        options[selected] = t(monitors ? `${key}.missing` : failed ? `${key}.unknown` : "common.loading");
    }
    return (
        <DropdownMenuContainer
            setting_id="experimental_features.tray_companion.monitor"
            dropdown_id="tray_companion_monitor"
            label={t(`${key}.label`)}
            desc={t(`${key}.desc`)}
            selected_id={selected || PRIMARY_OPTION}
            list={options}
            selectFunction={(choice: { selected_id: string }) => set(choice.selected_id === PRIMARY_OPTION ? "" : choice.selected_id)}
            state={current.state}
        />
    );
};
