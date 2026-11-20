export interface DeviceOption {
    id: string | number;
    label: string;
}

export interface LabelUpdate {
    id: unknown;
    label: string;
}

export const deviceOptionsToObject = (devices: readonly DeviceOption[]): Record<string, string> => {
    const counts = new Map<string, number>();
    for (const device of devices) counts.set(device.label, (counts.get(device.label) ?? 0) + 1);
    return Object.fromEntries(devices.map(({ id, label }) => [id,
        (counts.get(label) ?? 0) > 1 ? `${label} (${id})` : label,
    ]));
};

export const arrayToObject = <T extends PropertyKey>(array: readonly T[]): Record<PropertyKey, T> => {
    return array.reduce<Record<PropertyKey, T>>((obj, item) => {
        obj[item] = item;
        return obj;
    }, {});
};

export const arrayToIdLabel = <T>(array: readonly T[]): { id: T; label: T }[] => {
    return array.map((element) => ({
        id: element,
        label: element,
    }));
};

export const chunkArray = <T>(array: readonly T[], size: number): T[][] => {
    const chunked: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
        chunked.push(array.slice(i, i + size));
    }
    return chunked;
};

export const clampMinMax = (value: number, min: number, max: number): number => {
    return Math.min(Math.max(value, min), max);
};
// console.log(clamp(5, 1, 10));  // 5 (範囲内)
// console.log(clamp(-3, 0, 10)); // 0 (minより小さい)
// console.log(clamp(15, 1, 10)); // 10 (maxより大きい)
// console.log(clamp(7.5, 1, 10)); // 7.5 (範囲内、少数)

export const randomIntMinMax = (min: number, max?: number): number => {
	if (min === max) return min;
	if (max === undefined) {
		max = min;
		min = 0;
	}
	const int = Math.floor(Math.random() * (max - min + 1)) + min;
	return int;
};

export const updateLabelsById = <T extends { id: unknown }>(data_array: readonly T[], updates: readonly LabelUpdate[]) => {
    return data_array.map(item => {
        const update = updates.find(update_item => update_item.id === item.id);
        return update ? { ...item, label: update.label } : item;
    });
};

export const genNumArray = (count: number, start_from = 0): number[] => {
    return [...Array(count).keys()].map(i => i + start_from);
};

export const genNumObjArray = (count: number, start_from = 0): Record<PropertyKey, number> => {
    return arrayToObject(genNumArray(count, start_from));
};

// This is using for only AI models compute device list, currently. (CTranslate2, Whisper)
export const transformToIndexedArray = <T>(devices: readonly T[]): Record<number, T> => {
    return devices.reduce<Record<number, T>>((result, device, index) => {
        result[index] = device;
        return result;
    }, {});
};
