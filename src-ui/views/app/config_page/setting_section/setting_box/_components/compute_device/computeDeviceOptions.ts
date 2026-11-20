import type { TranslationComputeDevice } from "../../../../../../../logics/configs/config_page_setter/settingTypes";

// PC と VR で同じデバイスの識別・表示名・対応精度を使う。

type Translate = (key: string, options?: Record<string, unknown>) => string;

// The devices by index, as the backend lists them (transformToIndexedArray); [] until they arrive.
export type ComputeDeviceList = Readonly<Record<string, TranslationComputeDevice>> | [];
// The chosen device; "" before one is saved.
export type ComputeDeviceChoice = TranslationComputeDevice | "" | null | undefined;

// A label for each device, and for each precision of the chosen one: { id: label }.
export type ComputeLabels = Record<string, string>;

// The engine names the processor "cpu"; the screen says CPU, as a GPU keeps its own name.
export const computeDeviceName = <N extends string | undefined>(name: N): N | "CPU" => (typeof name === "string" && name.toLowerCase() === "cpu" ? "CPU" : name);

// A GPU whose ONNX Runtime was set up during this run: chosen now, it is used from the next start.
export const needsRestart = (device: ComputeDeviceChoice) => device !== "" && device?.restart_required === true;

// The name of a device, saying when it needs the app started again.
export const computeDeviceLabel = (device: ComputeDeviceChoice, t?: Translate) => {
    const name = computeDeviceName(device ? device.device_name : undefined);
    return name && needsRestart(device) && t ? t("config_page.common.compute_device.after_restart", { device: name }) : name;
};

const transformDeviceArray = (devices: ComputeDeviceList | null | undefined = {}, t?: Translate): ComputeLabels => {
    if (!devices) return {};
    const name_counts = Object.values(devices).reduce<Record<string, number>>((counts, device) => {
        const name = device?.device_name;
        if (name) {
            counts[name] = (counts[name] || 0) + 1;
        }
        return counts;
    }, {});

    const name_indices: Record<string, number> = {};
    const result: ComputeLabels = {};

    Object.entries(devices).forEach(([key, device]) => {
        const name = device?.device_name;
        if (!name) return;

        let value = computeDeviceName(name);
        if (name_counts[name] > 1) {
            name_indices[name] = (name_indices[name] || 0);
            value = `${value}:${name_indices[name]}`;
            name_indices[name]++;
        }
        result[key] = needsRestart(device) && t ? t("config_page.common.compute_device.after_restart", { device: value }) : value;
    });

    return result;
};

const findKeyByDeviceValue = (devices: ComputeDeviceList | null | undefined, target_value: ComputeDeviceChoice) => {
    if (!devices || !target_value) return null;
    for (const [key, value] of Object.entries(devices)) {
        if (
            value &&
            value.device === target_value.device &&
            value.device_index === target_value.device_index &&
            value.device_name === target_value.device_name
        ) {
            return parseInt(key);
        }
    }
    return null;
};

// From the smallest model to the most precise. int4 is the ONNX engine's weight-only variant.
const DEFAULT_ORDER = [
    "auto",
    "int4",
    "int8",
    "int8_bfloat16",
    "int8_float16",
    "int8_float32",
    "bfloat16",
    "float16",
    "int16",
    "float32"
];

const sortComputeTypesArray = (compute_types_array: readonly string[] | null = []) => {
    const src_set = new Set(compute_types_array || []);
    const from_order = DEFAULT_ORDER.filter((id) => src_set.has(id));

    const invalid_ids = (compute_types_array || []).filter((id) => !DEFAULT_ORDER.includes(id));
    if (invalid_ids.length > 0) {
        console.error("[sortComputeTypesArray] Unsupported compute types ignored:", invalid_ids);
    }

    return from_order;
};

const buildSimpleLabels = (ordered_array: readonly string[] = [], t: Translate) => {
    const n = ordered_array.length;
    if (n === 0) return {};

    const labels: ComputeLabels = {};

    ordered_array.forEach((id, idx) => {
        if (idx === 0 && id === "auto") {
            labels[id] = t("config_page.common.compute_device.type_template_auto");
            return;
        }

        if (idx === 1) {
            labels[id] = t(
                "config_page.common.compute_device.type_template_low",
                { type_name: id }
            );
            return;
        }

        if (idx === n - 1) {
            labels[id] = t(
                "config_page.common.compute_device.type_template_high",
                { type_name: id }
            );
            return;
        }

        labels[id] = id;
    });

    return labels;
};

export const buildComputeDeviceOptions = (devices: ComputeDeviceList | null | undefined, selected_device: ComputeDeviceChoice, t: Translate) => {
    const selected_device_id = findKeyByDeviceValue(devices, selected_device);
    // A key was found, so the list holds devices.
    const listed = selected_device_id !== null && devices && !Array.isArray(devices) ? devices[selected_device_id] : undefined;
    const compute_types = selected_device_id !== null
        ? listed?.compute_types ?? []
        : [];

    return {
        device_labels: transformDeviceArray(devices, t),
        selected_device_id,
        compute_type_labels: buildSimpleLabels(sortComputeTypesArray(compute_types), t),
    };
};
