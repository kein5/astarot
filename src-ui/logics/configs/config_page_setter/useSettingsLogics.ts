import { useState, useEffect, useCallback, useMemo, useRef, useId } from "react";
import { getStoreHook } from "@store";
import type { AtomState, UpdateOptions } from "@store";
import { useStdoutToPython } from "@useStdoutToPython";
import type { StdoutResult } from "@useStdoutToPython";
import { useNotificationStatus } from "@logics_common";
import { deviceOptionsToObject, arrayToObject, arrayToIdLabel, transformToIndexedArray } from "@utils";
import type { DeviceOption } from "@utils";
import { setSaveBarEntry } from "../../voice/saveBar";
import type { SaveState } from "../../voice/saveBar";
import type { SettingLogicsTemplateId } from "../../common/initializationFields.ts";
import type { ConfigFunctions, CustomWeightStatus, DownloadedWeights, SettingResponseTransform, SettingRunDirection,
    WeightDownloadProgress, WeightDownloaded, WeightTypeStatus } from "./settingTypes.ts";

// The fields of a SETTINGS_ARRAY entry this hook reads.
export interface SettingLogicsEntry {
    Category: string;
    Base_Name: string;
    logics_template_id: SettingLogicsTemplateId;
    base_endpoint_name: string;
    add_endpoint_run_array?: readonly SettingRunDirection[];
    response_transform?: SettingResponseTransform;
}

// The fields made for the settings, named after them (currentX, setX, ...). createCategoryHook
// (ui_config_setter.ts) gives them their types.
export type SettingFields = Record<string, unknown>;

type Update = (payload: unknown, options?: UpdateOptions) => void;
type WeightList = AtomState<readonly WeightTypeStatus[]>;

// The store hook's functions, as the registry gives them (getStoreHook).
const isAction = (value: unknown): value is () => void => typeof value === "function";
const isUpdate = (value: unknown): value is Update => typeof value === "function";
const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null;

const isDeviceOption = (value: unknown): value is DeviceOption => isRecord(value)
    && (typeof value.id === "string" || typeof value.id === "number") && typeof value.label === "string";
const isPropertyKey = (value: unknown): value is PropertyKey => typeof value === "string" || typeof value === "number" || typeof value === "symbol";

// The backend's list, checked before a transform reads it. A list is all the backend sends here.
const listOf = <T>(payload: unknown, isItem: (item: unknown) => item is T, transformName: string): T[] => {
    if (!Array.isArray(payload)) throw new TypeError(`[transformResponse] ${transformName} expects a list.`);
    const items: T[] = [];
    for (const item of payload) {
        if (!isItem(item)) throw new TypeError(`[transformResponse] ${transformName} got an item it cannot read.`);
        items.push(item);
    }
    return items;
};
const isAnything = (item: unknown): item is unknown => true;

const transformResponse = (transformName: SettingResponseTransform | null, payload: unknown): unknown => {
    if (!transformName) return payload;

    switch (transformName) {
        case "deviceOptionsToObject":
            return deviceOptionsToObject(listOf(payload, isDeviceOption, transformName));
        case "arrayToObject":
            return arrayToObject(listOf(payload, isPropertyKey, transformName));
        case "arrayToIdLabel":
            return arrayToIdLabel(listOf(payload, isAnything, transformName));
        case "transformToIndexedArray":
            return transformToIndexedArray(listOf(payload, isAnything, transformName));
        default:
            throw new Error(`[transformResponse] Unknown transform name: "${String(transformName)}". Please add it to the switch in useSettingsLogics.ts.`);
    }
};

export const useSettingsLogics = (settingsArray: readonly SettingLogicsEntry[], Category: string): { settings: SettingFields } => {
    const { asyncStdoutToPython } = useStdoutToPython();
    const { showNotification_SaveSuccess } = useNotificationStatus();

    const filtered = settingsArray.filter((s) => s.Category === Category);
    const result: SettingFields = {};


    for (const s of filtered) {
        const base = s.Base_Name;
        const storeHook = getStoreHook(base);

        if (!storeHook) {
            console.warn(`[useSettingsLogics] store hook not found for ${base}`);
            continue;
        }

        const store = storeHook();

        const currentKey = `current${base}`;
        const updateKey = `update${base}`;
        const pendingKey = `pending${base}`;

        const current = store[currentKey];
        const update = store[updateKey];
        const pending = store[pendingKey];
        const updateValue = isUpdate(update) ? update : null;
        // The download functions below always change the list; the store hook always has update.
        const updateList = (next: (old_status: WeightList) => WeightTypeStatus[]) => {
            if (!updateValue) throw new TypeError(`[useSettingsLogics] ${updateKey} is not a function`);
            updateValue(next);
        };

        const currentExportName = `current${base}`;
        const updateExportName = `update${base}`;
        const updateFromBackendExportName = `updateFromBackend${base}`;
        const getExportName = `get${base}`;
        const setExportName = `set${base}`;
        const deleteExportName = `delete${base}`;
        const toggleExportName = `toggle${base}`;
        const setSuccessExportName = `setSuccess${base}`;
        const deleteSuccessExportName = `deleteSuccess${base}`;

        const runExportName = `runSuccess${base}`;

        // To use by UI------------------------------------
        const buildGet = () => {
            return (): Promise<StdoutResult> => {
                if (isAction(pending)) pending();
                return asyncStdoutToPython(`/get/data/${s.base_endpoint_name}`);
            };
        };

        const buildSet = () => {
            return (value?: unknown): Promise<StdoutResult> => {
                if (isAction(pending)) pending();
                return asyncStdoutToPython(`/set/data/${s.base_endpoint_name}`, value);
            };
        };

        const buildDelete = () => {
            return (value?: unknown): Promise<StdoutResult> => {
                if (isAction(pending)) pending();
                return asyncStdoutToPython(`/delete/data/${s.base_endpoint_name}`, value);
            };
        };

        const buildRun = () => {
            return () => {
                asyncStdoutToPython(`/run/${s.base_endpoint_name}`);
            };
        };


        // To use a response from backend------------------------------------
        const buildSuccessHandler = (transformName: SettingResponseTransform | null) => {
            return (payload: unknown) => {
                const transformed = transformResponse(transformName, payload);
                if (updateValue) updateValue(transformed);
                showNotification_SaveSuccess();
            };
        };

        const buildUpdateFromBackend = (transformName: SettingResponseTransform | null) => {
            return (payload: unknown) => {
                const transformed = transformResponse(transformName, payload);
                if (updateValue) updateValue(transformed);
            };
        };


        result[currentExportName] = current;
        result[updateExportName] = update;
        result[updateFromBackendExportName] = buildUpdateFromBackend(s.response_transform ?? null);

        if (s.add_endpoint_run_array?.includes("to_backend")) {
            result[runExportName] = buildRun();
        }


        if (s.logics_template_id === "get_list") {
            result[getExportName] = buildGet();
            continue;
        }

        if (s.logics_template_id === "get_only") {
            result[getExportName] = buildGet();
            continue;
        }

        if (s.logics_template_id === "get_set") {
            result[getExportName] = buildGet();
            result[setExportName] = buildSet();
            result[setSuccessExportName] = buildSuccessHandler(s.response_transform ?? null);
            continue;
        }

        if (s.logics_template_id === "get_set_delete") {
            result[getExportName] = buildGet();
            result[setExportName] = buildSet();
            result[setSuccessExportName] = buildSuccessHandler(s.response_transform ?? null);
            result[deleteExportName] = buildDelete();
            result[deleteSuccessExportName] = buildSuccessHandler(s.response_transform ?? null);
            continue;
        }

        if (s.logics_template_id === "toggle_enable_disable") {
            result[getExportName] = buildGet();
            result[toggleExportName] = () => {
                if (isAction(pending)) pending();
                const isOn = isRecord(current) && current.data;
                if (isOn) {
                    asyncStdoutToPython(`/set/disable/${s.base_endpoint_name}`);
                } else {
                    asyncStdoutToPython(`/set/enable/${s.base_endpoint_name}`);
                }
            };

            result[setSuccessExportName] = buildSuccessHandler(s.response_transform ?? null);
            continue;
        }

        if (s.logics_template_id === "weight_download_status") {
            result[setSuccessExportName] = buildSuccessHandler(s.response_transform ?? null);

            result[`updateDownloadProgress${base}`] = (payload: WeightDownloadProgress) => {
                updateList((old_status) => {
                    return old_status.data.map((item) =>
                        payload.weight_type === item.id && item.is_pending
                            ? { ...item, job_id: payload.job_id, progress: payload.progress * 100 }
                            : item
                    );
                });
            };
            result[`updateDownloaded${base}`] = (downloaded_weight_type_status: DownloadedWeights) => {
                updateList((old_status) => {
                    // Models the user added to the local translation (a translation catalog
                    // entry, "user:<id>") are known only to the backend: they are listed after
                    // the built-in ones, and leave when the backend drops them.
                    const users = (id: string) => id.startsWith("user:");
                    const known = old_status.data
                        .filter((item) => !users(item.id) || item.id in (downloaded_weight_type_status ?? {}))
                        .map((item) => ({
                            ...item,
                            is_downloaded: downloaded_weight_type_status[item.id] ?? item.is_downloaded,
                        }));
                    const added = Object.entries(downloaded_weight_type_status ?? {})
                        .filter(([id]) => users(id) && !known.some(item => item.id === id))
                        .map(([id, is_downloaded]): CustomWeightStatus => ({ id, is_custom: true, is_downloaded: is_downloaded === true }));
                    return [...known, ...added];
                });
            };
            result[`pending${base}`] = (id: string) => {
                updateList((old_status) => {
                    return old_status.data.map((item) =>
                        id === item.id
                            ? { ...item, is_pending: true, job_id: null }
                            : item
                    );
                });
            };
            result[`downloaded${base}`] = (payload: WeightDownloaded) => {
                const id = typeof payload === "string" ? payload : payload?.weight_type;
                updateList((old_status) => {
                    return old_status.data.map((item) =>
                        id === item.id && (typeof payload === "string" || payload?.downloaded === true)
                            ? { ...item, is_downloaded: true, is_pending: false, progress: null }
                            : item
                    );
                });
            };

            result[`download${base}`] = (weight_type: unknown) => {
                asyncStdoutToPython(`/run/download_${s.base_endpoint_name}`, weight_type);
            };

            continue;
        }
    }

    return { settings: result };
};


export const useConfigFunctions = (Category: string): ConfigFunctions => {
    const { asyncStdoutToPython } = useStdoutToPython();

    switch (Category) {
        case "Vr":
            return {
                sendTextToOverlay: (text: string) => {
                    asyncStdoutToPython("/run/send_text_overlay", text);
                },
            };
        default:
            return {};
    }
};


export type SliderSetterTiming = "on_change" | "on_change_committed";

// One mark under a slider; label is "" where none is shown.
export interface SliderMark {
    value: number;
    label: string;
}

export interface SliderLogicOptions {
    variable: number;
    state?: string;
    // false, or a promise of false, when the value was not sent: the slider goes back.
    setterFunction: (value: number) => unknown;
    postUpdateAction?: () => void;
    min: number;
    max: number;
    step?: number;
    show_label_values?: readonly number[] | null;
    marks_step?: number;
    setter_timing?: SliderSetterTiming;
    debounce_ms?: number;
}

export const useSliderLogic = ({
    variable,
    state,
    setterFunction,
    postUpdateAction,
    min,
    max,
    step = 1,
    show_label_values = null,
    marks_step,
    setter_timing = "on_change_committed",
    debounce_ms = 200,
}: SliderLogicOptions) => {
    const [ui_value, setUiValue] = useState(variable);
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const debouncedSetter = useCallback((value: number) => {
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
        }
        if (debounce_ms === 0) return setterFunction(value);
        debounceTimerRef.current = setTimeout(() => {
            Promise.resolve(setterFunction(value)).then(sent => { if (sent === false) setUiValue(variable); });
            debounceTimerRef.current = null;
        }, debounce_ms);
    }, [setterFunction, variable, debounce_ms]);

    useEffect(() => {
        return () => {
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
            }
        };
    }, []);

    const marks = useMemo(() => {
        if (show_label_values === null && marks_step === undefined) {
            return null;
        }

        const markMap = new Map<number, SliderMark>();

        // 1. marks_step が明示的に指定されている場合、min から max まで marks_step 刻みで目盛りを生成
        if (marks_step !== undefined && marks_step > 0) {
            const decimalPlaces = marks_step.toString().includes('.')
                ? marks_step.toString().split('.')[1].length
                : 0;

            let current = min;
            for (let i = 0; i <= 1000; i++) {
                if (current > max + (marks_step / 10)) break;
                const fixedValue = parseFloat(current.toFixed(decimalPlaces));
                const hasLabel = show_label_values?.includes(fixedValue);
                markMap.set(fixedValue, {
                    value: fixedValue,
                    label: hasLabel ? `${fixedValue}` : "",
                });
                current += marks_step;
            }
        }

        // 2. show_label_values が指定されている場合、その値は必ず mark として含める（label付き）
        if (show_label_values && Array.isArray(show_label_values)) {
            for (const val of show_label_values) {
                if (val >= min && val <= max) {
                    markMap.set(val, {
                        value: val,
                        label: `${val}`,
                    });
                }
            }
        }

        return Array.from(markMap.values()).sort((a, b) => a.value - b.value);
    }, [min, max, marks_step, show_label_values]);

    // setter_timing の値によってuseCallbackの呼び出し数が変わるとHooksルール違反になるため、
    // 常に同数のuseCallbackを呼び出し、公開する関数だけをsetter_timingで切り替える
    const onChangeForOnChange = useCallback((value: number) => {
        setUiValue(value);
        debouncedSetter(value);
    }, [debouncedSetter]);

    const onChangeForCommitted = useCallback((value: number) => {
        setUiValue(value);
    }, []);

    const onChangeCommittedForCommitted = useCallback((value: number) => {
        Promise.resolve(setterFunction(value)).then(sent => { if (sent === false) setUiValue(variable); });
    }, [setterFunction, variable]);

    let onChangeFunction: ((value: number) => void) | undefined;
    let onChangeCommittedFunction: ((value: number) => void) | null | undefined;

    if (setter_timing === "on_change") {
        onChangeFunction = onChangeForOnChange;
        onChangeCommittedFunction = null;
    } else if (setter_timing === "on_change_committed") {
        onChangeFunction = onChangeForCommitted;
        onChangeCommittedFunction = onChangeCommittedForCommitted;
    } else {
        console.error(`Invalid 'setter_timing' value provided to useSliderLogic. Expected 'on_change' or 'on_change_committed'. Received: ${String(setter_timing)}`);
    }

    useEffect(() => {
        if (state === "pending") return;
        if (variable !== ui_value) {
            setUiValue(variable);
        }
        if (postUpdateAction) {
            postUpdateAction();
        }
    }, [variable, state]);

    return {
        ui_value,
        onChangeFunction,
        onChangeCommittedFunction,
        marks,
    };
};


// A text field saved from the config page top bar, like every other settings
// form; `label` names it in the bar's list of changes. Enter still saves the
// one field.
export interface SaveButtonLogicOptions {
    // The saved value; after a save, the value the backend answered with.
    variable: unknown;
    state?: string;
    setFunction: (value: unknown) => Promise<StdoutResult> | StdoutResult;
    // Saves an empty field by deleting the value (credentials).
    deleteFunction?: () => Promise<StdoutResult> | StdoutResult;
    label?: string;
}

export const useSaveButtonLogic = ({
    variable,
    state,
    setFunction,
    deleteFunction,
    label,
}: SaveButtonLogicOptions) => {
    const [input_value, setInputValue] = useState<unknown>(variable);
    const [saveState, setSaveState] = useState<SaveState>("saved");
    const submitted = useRef<{ value: unknown } | null>(null);
    const previous = useRef<unknown>(variable);
    const same = (a: unknown, b: unknown) => String(a ?? "") === String(b ?? "");

    const onChangeFunction = (value: unknown) => {
        setInputValue(value);
        if (!submitted.current) setSaveState("unsaved");
    };
    const saveFunction = async (): Promise<StdoutResult | undefined> => {
        if (saveState === "saving" || state === "pending") return;
        const request = { value: input_value };
        submitted.current = request;
        setSaveState("saving");
        const empty = input_value === "" || input_value === null;
        try {
            const response = await (empty && typeof deleteFunction === "function"
                ? deleteFunction() : setFunction(empty ? "" : input_value));
            if (submitted.current !== request) return response;
            const reply = typeof response === "object" && response !== null ? response : null;
            if (reply?.status === 200) {
                setInputValue((value: unknown) => same(value, request.value) ? reply.result : value);
                previous.current = reply.result;
                setSaveState("saved");
                submitted.current = null;
            } else if (response === false || reply?.status) {
                setSaveState("save_failed");
                submitted.current = null;
            }
            return response;
        } catch {
            if (submitted.current === request) {
                setSaveState("save_failed");
                submitted.current = null;
            }
            return false;
        }
    };

    useEffect(() => {
        // Pending recovery and rejected responses carry the old confirmed value.
        // Only untouched fields follow a refresh; submitted drafts await their response.
        const old = previous.current;
        if (!submitted.current) setInputValue((value: unknown) => same(value, old) ? variable : value);
        previous.current = variable;
    }, [variable]);
    useEffect(() => {
        if (saveState !== "saving") return;
        const timer = setTimeout(() => setSaveState("save_failed"), 5000);
        return () => clearTimeout(timer);
    }, [saveState]);
    useEffect(() => () => { submitted.current = null; }, []);

    const saving = saveState === "saving";
    const dirty = !!submitted.current || saveState === "save_failed" || !same(input_value, variable);
    const status = saving || saveState === "save_failed" ? saveState : dirty ? "unsaved" : "saved";
    const id = useId();
    const discard = () => {
        submitted.current = null;
        setInputValue(variable);
        setSaveState("saved");
    };
    const latest = useRef({ saveFunction, discard });
    latest.current = { saveFunction, discard };
    useEffect(() => {
        setSaveBarEntry(id, {
            dirty, edited: dirty, saving, saveState: status,
            changes: dirty && label ? [label] : [], canSave: state !== "pending",
            save: () => latest.current.saveFunction(), discard: () => latest.current.discard(),
        });
    }, [id, dirty, saving, status, label, state]);
    useEffect(() => () => setSaveBarEntry(id, null), [id]);

    return { variable: input_value, onChangeFunction, saveFunction };
};

const createMarks = (min: number, max: number, marks_step = 1, labelFormatter = (value: number): unknown => value): SliderMark[] => {
    const marks: SliderMark[] = [];
    let current = min;

    const decimalPlaces = marks_step.toString().includes('.')
        ? marks_step.toString().split('.')[1].length
        : 0;

    for (let i = 0; i <= 1000; i++) {
        // Use a small epsilon for the comparison to handle floating point errors
        if (current > max + (marks_step / 10)) break;

        const fixedValue = parseFloat(current.toFixed(decimalPlaces));
        marks.push({ value: fixedValue, label: `${labelFormatter(fixedValue)}` });

        current += marks_step;
    }
    return marks;
};
