import type { ReactNode } from "react";
import { useI18n } from "@useI18n";
import type { TranslationComputeDevice } from "../../../../../../../logics/configs/config_page_setter/settingTypes";
import type { DropdownSelection } from "../dropdown_menu/DropdownMenu";

import {
    MultiDropdownMenuContainer,
} from "../../_templates/Templates";

import { buildComputeDeviceOptions } from "./computeDeviceOptions";
import type { ComputeDeviceChoice, ComputeDeviceList } from "./computeDeviceOptions";

export interface ComputeDeviceProps {
    label: ReactNode;
    // The dropdowns' ids: <prefix>_compute_device and <prefix>_compute_type.
    dropdownIdPrefix: string;
    currentDeviceList: { state?: string; data: ComputeDeviceList };
    currentSelectedDevice: { state?: string; data: ComputeDeviceChoice };
    setSelectedDevice: (device: TranslationComputeDevice) => unknown;
    currentSelectedComputeType: { state?: string; data: string };
    setSelectedComputeType: (compute_type: string) => unknown;
}

export const ComputeDevice = ({
    label,
    dropdownIdPrefix,
    currentDeviceList,
    currentSelectedDevice,
    setSelectedDevice,
    currentSelectedComputeType,
    setSelectedComputeType,
}: ComputeDeviceProps) => {
    const { t } = useI18n();

    const { device_labels, selected_device_id, compute_type_labels } = buildComputeDeviceOptions(
        currentDeviceList.data, currentSelectedDevice.data, t
    );

    const selectFunction_ComputeDevice = (selected_data: DropdownSelection) => {
        // [] has no devices to pick.
        const list = currentDeviceList.data;
        const target_obj = list && !Array.isArray(list) ? list[selected_data.selected_id] : undefined;
        if (target_obj) {
            setSelectedDevice(target_obj);
        }
    };

    const selectFunction_ComputeType = (selected_data: DropdownSelection) => {
        setSelectedComputeType(selected_data.selected_id);
    };

    const is_disabled_selector = currentSelectedDevice.state === "pending" || currentSelectedComputeType.state === "pending";

    return (
        <MultiDropdownMenuContainer
            setting_id={`${dropdownIdPrefix}_compute_device`}
            label={label}
            desc={t("config_page.common.compute_device.desc")}
            dropdown_settings={[
                {
                    dropdown_id: `${dropdownIdPrefix}_compute_device`,
                    secondary_label: t("config_page.common.compute_device.label_device"),
                    selected_id: selected_device_id,
                    list: device_labels,
                    selectFunction: selectFunction_ComputeDevice,
                    state: currentSelectedDevice.state,
                    is_disabled: is_disabled_selector,
                },
                {
                    dropdown_id: `${dropdownIdPrefix}_compute_type`,
                    secondary_label: t("config_page.common.compute_device.label_type"),
                    selected_id: currentSelectedComputeType.data,
                    list: compute_type_labels,
                    selectFunction: selectFunction_ComputeType,
                    state: currentSelectedComputeType.state,
                    is_disabled: is_disabled_selector,
                }
            ]}
        />
    );
};