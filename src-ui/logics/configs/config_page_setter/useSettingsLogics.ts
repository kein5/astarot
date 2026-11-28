import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { getStoreHook } from "@store";
import type { AtomState, UpdateOptions } from "@store";
import { useStdoutToPython } from "@useStdoutToPython";
import type { StdoutResult } from "@useStdoutToPython";
import { useI18n } from "@useI18n";
import { deviceOptionsToObject, arrayToObject, arrayToIdLabel, transformToIndexedArray } from "@utils";
import type { DeviceOption } from "@utils";
import type { SaveState } from "../../voice/useSettingsDraft.tsx";
import { awaitInlineAnswer, errorCodeOf, refusalKeys } from "../fieldErrors.ts";
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
        // Every setting saves by itself without a "saved" notice (#1111).
        const buildSuccessHandler = (transformName: SettingResponseTransform | null) => {
            return (payload: unknown) => {
                const transformed = transformResponse(transformName, payload);
                if (updateValue) updateValue(transformed);
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


// A text field that saves by itself (#1111): on Enter, or when focus leaves the field, a changed
// value that passes `validate` is sent. Escape puts the saved value back (`revert`). No "saved"
// notice is shown; a refusal is said under the field (`error`).
export interface SaveButtonLogicOptions {
    // The saved value; after a save, the value the backend answered with.
    variable: unknown;
    state?: string;
    setFunction: (value: unknown) => Promise<StdoutResult> | StdoutResult;
    // Saves an empty field by deleting the value (credentials).
    deleteFunction?: () => Promise<StdoutResult> | StdoutResult;
    // What is wrong with a value and what kind of value would do, said beside the field; null when
    // the value may be saved. A value it refuses is never sent.
    validate?: (value: string) => string | null;
    // An API key or another credential (#1111, decided 2): leaving the field empty keeps the
    // saved value and puts it back; only Enter on the empty field deletes it (or clears it).
    // Taken as true when the field has a deleteFunction.
    credential?: boolean;
    // The set endpoint `setFunction` sends to. With it, a refusal of the field's own save is said
    // under the field only, not as a notice too.
    endpoint?: string;
}

export const useSaveButtonLogic = ({
    variable,
    state,
    setFunction,
    deleteFunction,
    validate,
    credential = typeof deleteFunction === "function",
    endpoint,
}: SaveButtonLogicOptions) => {
    const { t } = useI18n();
    const [input_value, setInputValue] = useState<unknown>(variable);
    const [saveState, setSaveState] = useState<SaveState>("saved");
    // What the field says under it: a refused value, or a save that did not go through (#1111).
    const [problem, setProblem] = useState<string | null>(null);
    // A refused save is said in the words its code has (the notice it no longer raises), or as
    // "could not be saved" without one.
    const saveFailed = (result?: unknown) => {
        const code = errorCodeOf(result);
        setProblem(code ? t(refusalKeys(code)) : t("config_page.auto_save.save_failed"));
    };
    const submitted = useRef<{ value: unknown } | null>(null);
    const previous = useRef<unknown>(variable);
    const same = (a: unknown, b: unknown) => String(a ?? "") === String(b ?? "");

    const onChangeFunction = (value: unknown) => {
        setInputValue(value);
        if (!submitted.current) setSaveState("unsaved");
        setProblem(null);
    };
    const saveFunction = async (): Promise<StdoutResult | undefined> => {
        if (saveState === "saving" || state === "pending") return;
        const request = { value: input_value };
        submitted.current = request;
        setSaveState("saving");
        const empty = input_value === "" || input_value === null;
        const deleting = empty && typeof deleteFunction === "function";
        // Only the field's own set is awaited: its refusal is said under the field (fieldErrors.ts).
        const settle = endpoint && !deleting ? awaitInlineAnswer(endpoint) : null;
        try {
            const response = await (deleting ? deleteFunction() : setFunction(empty ? "" : input_value));
            const reply = typeof response === "object" && response !== null ? response : null;
            // An answer with another status ends the wait where it is received (fieldErrors.ts).
            if (settle && !(reply?.status && reply.status !== 200)) settle();
            if (submitted.current !== request) return response;
            if (reply?.status === 200) {
                setInputValue((value: unknown) => same(value, request.value) ? reply.result : value);
                previous.current = reply.result;
                setSaveState("saved");
                submitted.current = null;
            } else if (response === false || reply?.status) {
                setSaveState("save_failed");
                submitted.current = null;
                saveFailed(reply?.result);
            }
            return response;
        } catch {
            settle?.();
            if (submitted.current === request) {
                setSaveState("save_failed");
                submitted.current = null;
                saveFailed();
            }
            return false;
        }
    };
    // Enter, or focus leaving the field: a changed value is checked and then saved; an unchanged
    // one has nothing to save.
    const commit = async (): Promise<StdoutResult | undefined> => {
        if (saveState === "saving" || state === "pending") return;
        if (same(input_value, variable)) {
            setSaveState("saved");
            setProblem(null);
            return;
        }
        const refused = validate?.(String(input_value ?? "")) ?? null;
        setProblem(refused);
        if (refused) return;
        return saveFunction();
    };
    // Focus leaving the field: as Enter, except that an emptied credential is put back, not deleted.
    const leave = async (): Promise<StdoutResult | undefined> => {
        if (credential && String(input_value ?? "") === "") {
            discard();
            return;
        }
        return commit();
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
        const timer = setTimeout(() => { setSaveState("save_failed"); saveFailed(); }, 5000);
        return () => clearTimeout(timer);
    }, [saveState]);
    useEffect(() => () => { submitted.current = null; }, []);

    const discard = () => {
        submitted.current = null;
        setInputValue(variable);
        setSaveState("saved");
        setProblem(null);
    };
    // Enter calls `saveFunction` and leaving the field `leaveFunction`, which check first (commit),
    // and Escape calls `revert`. `error` is what to say under the field.
    // `saveState` is the field's own save: "saving" while it waits, "save_failed" when refused.
    return { variable: input_value, onChangeFunction, saveFunction: commit, leaveFunction: leave, revert: discard, error: problem, saveState };
};
