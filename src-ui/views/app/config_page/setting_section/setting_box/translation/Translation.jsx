import { CredentialPair } from "../_components/credential_pair/CredentialPair";
import { endpointDescription } from "../../../../../../logics/common/endpointPrivacy";
import { useRef, useState } from "react";
import { useI18n } from "@useI18n";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isNonCommercialWeight, needsLicenseConfirmation, weightRequest } from "../../../../../../logics/configs/ctranslate2License";
import { useConsentDialog } from "../../../../../../logics/common/useConsentDialog";
import { useModelDownloads } from "../../../../../../logics/voice/useModelDownloads";
import { translationDownloadable } from "../../../../../../logics/main/setupNeeds";
import { computeDeviceLabel, needsRestart } from "../_components/compute_device/computeDeviceOptions";
import { useTranslationCatalog } from "../../../../../../logics/translation/useTranslationCatalog";
import { ENGINE_FORM_SETTING_ID, isUsersWeight, weightLabel } from "../../../../../../logics/translation/translationCatalog";
import { revealSetting } from "../../../../../../logics/configs/revealSetting.ts";
import { FormRow } from "../_components/form_row/FormRow";
import { localModelList } from "../../../../../../logics/translation/localModelList";
import { TranslationCatalogSection } from "./TranslationCatalog";
import { TranslationGpuRuntimes } from "./TranslationGpuRuntimes";

import {
    useTranslation,

    useSaveButtonLogic,
} from "@logics_configs";

import styles from "./Translation.module.scss";

import {
    DownloadModelsContainer,
    AuthKeyContainer,
    EntryWithSaveButtonContainer,
    DropdownMenuContainer,
    ConnectionCheckButtonContainer,
} from "../_templates/Templates";

import {
    SectionLabelComponent,
} from "../_components";

import { ComputeDevice } from "../_components/compute_device/ComputeDevice";
import { Description } from "../_components/description/Description";
import { CustomModelLink } from "../_components/custom_model_link/CustomModelLink";
import { SetupSection } from "../_components/setup_section/SetupSection";
import { AdvancedSection } from "../_components/advanced_section/AdvancedSection";
import { LegacyModelDownloadDialog } from "../_components/download_models/LegacyModelDownloadDialog";

import {
    deepl_auth_key_url,
    plamo_auth_key_url,
    gemini_auth_key_url,
    openai_auth_key_url,
    groq_auth_key_url,
    openrouter_auth_key_url,
    google_cloud_auth_key_url,
    papago_auth_key_url,
} from "@ui_configs";

import { useLLMConnection } from "@logics_common";
import { useStore_TranslationEngines, useStore_SelectedTranslationEngines } from "@store";

// The providers in 「詳細設定」, by the lists they are drawn in below.
export const EXTERNAL_API_PROVIDERS = ["DeepL_API", "Google_Cloud_API", "Papago_API", "Plamo_API", "Gemini_API", "OpenAI_API", "Groq_API", "OpenRouter_API"];
export const LOCAL_LLM_PROVIDERS = ["LMStudio", "Ollama", "OpenAI_Compatible"];

// The local AI translation is what a first start uses; its model is the first thing here. The
// translation APIs and local LLMs are set up once by those who use them, in 「詳細設定」 (#554).
// Its line counts the ones ready; it opens by itself while a language preset uses one of them.
// The translation catalog (#413), where users add models and APIs of their own, is a section of
// its own after the fold, always in sight (#597).
export const Translation = () => {
    const { t } = useI18n();
    const { currentTranslationEngines } = useStore_TranslationEngines();
    const { currentSelectedTranslationEngines } = useStore_SelectedTranslationEngines();
    const engines = currentTranslationEngines.data ?? [];
    const ready = ids => engines.filter(engine => ids.includes(engine.id) && engine.is_available === true).length;
    const inUse = Object.values(currentSelectedTranslationEngines.data ?? {})
        .some(id => EXTERNAL_API_PROVIDERS.includes(id) || LOCAL_LLM_PROVIDERS.includes(id));
    return (
        <div className={styles.container}>
            <AITranslation_Container />
            <AdvancedSection attention={inUse} status={t("config_page.advanced_status.translation", {
                api: ready(EXTERNAL_API_PROVIDERS), llm: ready(LOCAL_LLM_PROVIDERS) })}>
                <ExternalTranslationAPI_Container />
                <LocalLLM_Container />
            </AdvancedSection>
            <TranslationCatalogSection />
        </div>
    );
};

// The local model and its device are set once; the summary says which model,
// whether it is downloaded, and where it runs.
const AITranslation_Container = () => {
    const { t } = useI18n();
    const { currentCTranslate2WeightTypeStatus, currentSelectedCTranslate2WeightType, currentSelectedTranslationComputeDevice } = useTranslation();
    const selected = currentSelectedCTranslate2WeightType.data;
    const weight = (currentCTranslate2WeightTypeStatus.data || []).find(item => item.id === selected);
    const device = computeDeviceLabel(currentSelectedTranslationComputeDevice.data, t);
    const { catalog } = useModelDownloads();
    const { catalog: translationCatalog } = useTranslationCatalog();
    // false only once the catalog says so; until then the downloads are offered as before.
    const unavailable = !isUsersWeight(selected ?? "") && translationDownloadable(catalog, selected) === false;
    const state = weight?.is_downloaded ? "setup_downloaded" : unavailable ? "setup_unavailable" : "setup_not_downloaded";
    const status = [
        selected ? `${weightLabel(selected, translationCatalog)} · ${t(`config_page.translation.${state}`)}` : null,
        device || null,
    ].filter(Boolean).join(" · ");
    // No built-in model can be downloaded and the selected one cannot translate: say so, and
    // point to the engines in 「詳細設定」 below.
    const nothingToGet = localModelList(currentCTranslate2WeightTypeStatus.data, selected, catalog).unavailable;
    return (
        <div>
            <SectionLabelComponent label={t("config_page.translation.section_label_ai_translation")} />
            {/* Open while the selected model is missing and a model can be downloaded (it, or another one
                listed below): the download is the first thing to do here. */}
            <SetupSection title={t("config_page.translation.setup_title")} status={status} attention={!!weight && !weight.is_downloaded && !(unavailable && nothingToGet)}>
                {/* Unfolded: the way forward is its second sentence. */}
                {nothingToGet && <Description text={t("config_page.translation.models_unavailable")} fold={false} />}
                {translationCatalog?.retired_folder_used === true && <RetiredModelsFolderNote />}
                <CTranslate2WeightType_Box />
                <TranslationComputeDevice_Box />
                {/* The GPU builds of ONNX Runtime, fetched only when asked for (decision 2 (c)). */}
                <TranslationGpuRuntimes />
            </SetupSection>
        </div>
    );
};

// Earlier versions listed the models placed in the translation-models folder; they are no
// longer listed (#597). While that folder holds something, a row above the model list says so
// and its button leads to the translation catalog's form that adds a model from any folder:
// the folds around it open, it scrolls into view and its first field takes focus.
export const RetiredModelsFolderNote = () => {
    const { t } = useI18n();
    const key = name => `config_page.translation.retired_models_folder.${name}`;
    return <div data-retired-models-folder>
        <FormRow group label={t(key("label"))} description={t(key("desc"))} fold={false}>
            <button type="button" onClick={() => revealSetting({ setting_id: ENGINE_FORM_SETTING_ID })}>{t(key("open_add_form"))}</button>
        </FormRow>
    </div>;
};

// One provider is one line until it is opened: most people use one of them or
// none, and nine open forms made this page nine screens long. The line says
// whether the provider can be used. A provider that a language preset uses
// stays open, so its key and model are in sight.
const Provider = ({ id, children }) => {
    const { t } = useI18n();
    const { currentTranslationEngines } = useStore_TranslationEngines();
    const { currentSelectedTranslationEngines } = useStore_SelectedTranslationEngines();
    const engine = (currentTranslationEngines.data ?? []).find(item => item.id === id);
    const in_use = Object.values(currentSelectedTranslationEngines.data ?? {}).includes(id);
    const status = t(`config_page.translation.provider_${in_use ? "in_use" : engine?.is_available === true ? "ready" : "not_set"}`);
    return <SetupSection title={engine?.label ?? id} status={status} attention={in_use}>{children}</SetupSection>;
};

const ExternalTranslationAPI_Container = () => {
    const { t } = useI18n();
    return (
        <div>
            <SectionLabelComponent sub label={t("config_page.translation.section_label_external_api")} />
            <Description text={t("config_page.translation.llm_privacy_desc")} className={styles.privacy_description} />

            <Provider id="DeepL_API">
                <DeepLAuthKey_Box />
            </Provider>
            <Provider id="Google_Cloud_API">
                <GoogleCloudAuthKey_Box />
            </Provider>
            <Provider id="Papago_API">
                <PapagoClientID_Box />
                <PapagoAuthKey_Box />
            </Provider>
            <Provider id="Plamo_API">
                <PlamoAuthKey_Box />
                <PlamoModelContainer />
            </Provider>
            <Provider id="Gemini_API">
                <GeminiAuthKey_Box />
                <GeminiModelContainer />
            </Provider>
            <Provider id="OpenAI_API">
                <OpenAIAuthKey_Box />
                <OpenAIModelContainer />
            </Provider>
            <Provider id="Groq_API">
                <GroqAuthKey_Box />
                <GroqModelContainer />
            </Provider>
            <Provider id="OpenRouter_API">
                <OpenRouterAuthKey_Box />
                <OpenRouterModelContainer />
            </Provider>
        </div>
    );
};

const LocalLLM_Container = () => {
    const { t } = useI18n();
    return (
        <div>
            <SectionLabelComponent sub label={t("config_page.translation.section_label_local_llm")} />
            <Description text={t("config_page.translation.llm_privacy_desc")} className={styles.privacy_description} />
            {/* A model you load into one of these servers yourself is how to translate with your own model. */}
            <CustomModelLink section="translation" />

            <Provider id="LMStudio">
                <LMStudioConnectionCheck_Box />
                <LMStudioURL_Box />
                <LMStudioModelContainer />
            </Provider>
            <Provider id="Ollama">
                <OllamaConnectionCheck_Box />
                <OllamaURL_Box />
                <OllamaModelContainer />
            </Provider>
            <Provider id="OpenAI_Compatible">
                <OpenAICompatibleCredentials />
                <OpenAICompatibleModelContainer />
            </Provider>
        </div>
    );
};

// Selection consent lasts for this session. Download consent is always reviewed.
const license_confirmed_weights = new Set();

const CTranslate2WeightType_Box = () => {
    const { t } = useI18n();
    const {
        currentCTranslate2WeightTypeStatus,
        pendingCTranslate2WeightTypeStatus,
        downloadCTranslate2WeightTypeStatus,

        currentSelectedCTranslate2WeightType,
        setSelectedCTranslate2WeightType,
    } = useTranslation();
    const { catalog } = useModelDownloads();
    const { catalog: translationCatalog } = useTranslationCatalog();
    const [confirming, setConfirming] = useState(null);
    const [downloadReview, setDownloadReview] = useState(null);
    const selection = useRef(null);

    const findWeight = (id) => currentCTranslate2WeightTypeStatus.data.find(item => item.id === id);
    const isConfirmed = (weight) => license_confirmed_weights.has(weight?.id);
    const askFirst = (weight) => needsLicenseConfirmation(weight, currentSelectedCTranslate2WeightType.data) && !isConfirmed(weight);

    const select = (id) => setSelectedCTranslate2WeightType(weightRequest(id, isConfirmed(findWeight(id))));
    const download = (request) => {
        if (isNonCommercialWeight(findWeight(request.weight_type))) license_confirmed_weights.add(request.weight_type);
        pendingCTranslate2WeightTypeStatus(request.weight_type);
        downloadCTranslate2WeightTypeStatus(request);
    };

    const selectFunction = (id) => {
        const weight = findWeight(id);
        if (askFirst(weight)) return setConfirming({ weight, action: "select" });
        select(id);
    };

    const downloadStartFunction = (id) => setDownloadReview(id);

    const confirmLicense = () => {
        const { weight } = confirming;
        license_confirmed_weights.add(weight.id);
        setConfirming(null);
        select(weight.id);
    };


    // Only the models the user can use or get (#565): the ones on their PC, the ones the catalog
    // offers, and the selected one, which the line above names. That one carries
    // download_unavailable when it cannot be had: no download button that would only open a dead end.
    const listed = localModelList(currentCTranslate2WeightTypeStatus.data, currentSelectedCTranslate2WeightType.data, catalog).rows;
    const c_translate2_weight_types_object = listed.map(item => {
        const non_commercial = isNonCommercialWeight(item);
        // A model the user added: its name is its catalog entry's, and its licence is theirs
        // to check.
        if (item.is_custom) {
            return {
                ...item,
                label: weightLabel(item.id, translationCatalog),
                desc: t("config_page.translation.ctranslate2_weight_type.custom_model"),
            };
        }
        return {
            ...item,
            label: item.id,
            desc: t(
                non_commercial
                    ? "config_page.translation.ctranslate2_weight_type.license_non_commercial"
                    : "config_page.translation.ctranslate2_weight_type.license_commercial",
                { license: item.license }
            ),
            desc_tone: non_commercial ? "warning" : undefined,
        };
    });


    return (
        <div ref={selection} tabIndex={-1} role="group" aria-label={t("config_page.translation.ctranslate2_weight_type.label")}>
            {downloadReview && <LegacyModelDownloadDialog kind="ctranslate2" weightType={downloadReview}
                onCancel={() => setDownloadReview(null)} onDownload={download} />}
            {confirming && (
                <CTranslate2LicenseDialog
                    fallback={selection}
                    weight={confirming.weight}
                    action={confirming.action}
                    onCancel={() => setConfirming(null)}
                    onConfirm={confirmLicense}
                />
            )}
            <DownloadModelsContainer
                label={t("config_page.translation.ctranslate2_weight_type.label")}
                desc={t("config_page.translation.ctranslate2_weight_type.desc")}
                name="ctranslate2_weight_type"
                options={c_translate2_weight_types_object}
                checked_variable={currentSelectedCTranslate2WeightType}
                selectFunction={selectFunction}
                downloadStartFunction={downloadStartFunction}
            />
        </div>
    );
};

export const CTranslate2LicenseDialog = ({ weight, action, onCancel, onConfirm, fallback }) => {
    const { t } = useI18n();
    const { dialog, close } = useConsentDialog(true, fallback);
    const [checked, setChecked] = useState(false);
    const cancel = () => { close(); onCancel(); };
    const confirm = () => { if (!checked) return; close(); onConfirm(); };

    const openLink = async (event, url) => {
        if (!isTauri()) return;
        event.preventDefault();
        try { await openUrl(url); }
        catch (error) { console.error("Failed to open", url, error); }
    };
    const key = (name) => `config_page.translation.ctranslate2_weight_type.${name}`;

    return (
        <dialog ref={dialog} className={styles.license_dialog} aria-label={t(key("confirm_title"))} onCancel={event => { event.preventDefault(); cancel(); }}>
            <h3>{t(key("confirm_title"))}</h3>
            <p>{t(key("confirm_body"), { weight_type: weight.id, license: weight.license })}</p>
            <p>
                <a href={weight.license_url} target="_blank" rel="noreferrer" onClick={event => openLink(event, weight.license_url)}>{t(key("license_link"))} ({weight.license})</a>
                {" · "}
                <a href={weight.model_card_url} target="_blank" rel="noreferrer" onClick={event => openLink(event, weight.model_card_url)}>{t(key("model_card_link"))}</a>
            </p>
            <label className={styles.license_check}>
                <input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} />
                {t(key("confirm_check"))}
            </label>
            <div className={styles.license_actions}>
                <button type="button" autoFocus onClick={cancel}>{t(key("confirm_cancel"))}</button>
                <button type="button" className={styles.confirm_button} disabled={!checked} onClick={confirm}>
                    {t(key(action === "download" ? "confirm_download" : "confirm_select"))}
                </button>
            </div>
        </dialog>
    );
};

const TranslationComputeDevice_Box = () => {
    const { t } = useI18n();
    const {
        currentSelectableTranslationComputeDeviceList,
        currentSelectedTranslationComputeDevice,
        setSelectedTranslationComputeDevice,
        currentSelectedTranslationComputeType,
        setSelectedTranslationComputeType,
    } = useTranslation();

    return (
        <>
            <ComputeDevice
                label={t("config_page.translation.translation_compute_device.label")}
                dropdownIdPrefix="translation"
                currentDeviceList={currentSelectableTranslationComputeDeviceList}
                currentSelectedDevice={currentSelectedTranslationComputeDevice}
                setSelectedDevice={setSelectedTranslationComputeDevice}
                currentSelectedComputeType={currentSelectedTranslationComputeType}
                setSelectedComputeType={setSelectedTranslationComputeType}
            />
            {/* A GPU whose ONNX Runtime was set up during this run is used from the next start. */}
            {needsRestart(currentSelectedTranslationComputeDevice.data) &&
                <p role="status">{t("config_page.translation.translation_compute_device.restart_note")}</p>}
        </>
    );
};

const DeepLAuthKey_Box = () => {
    const { t } = useI18n();
    const { currentDeepLAuthKey, setDeepLAuthKey, deleteDeepLAuthKey } = useTranslation();

    const { variable, onChangeFunction, saveFunction } = useSaveButtonLogic({
        variable: currentDeepLAuthKey.data,
        state: currentDeepLAuthKey.state,
        setFunction: setDeepLAuthKey,
        deleteFunction: deleteDeepLAuthKey,
        label: t("config_page.translation.deepl_auth_key.label"),
    });

    return (
        <>
            <AuthKeyContainer
                label={t("config_page.translation.deepl_auth_key.label")}
                desc={t(
                    "config_page.translation.deepl_auth_key.desc",
                    {translator: t("main_page.translator")}
                )}
                webpage_url={deepl_auth_key_url}
                variable={variable}
                state={currentDeepLAuthKey.state}
                onChangeFunction={onChangeFunction}
                saveFunction={saveFunction}
            />
        </>
    );
};

// The official Google and NAVER APIs, called with the user's own keys.
const GoogleCloudAuthKey_Box = () => {
    const { t } = useI18n();
    const { currentGoogleCloudAuthKey, setGoogleCloudAuthKey, deleteGoogleCloudAuthKey } = useTranslation();

    const { variable, onChangeFunction, saveFunction } = useSaveButtonLogic({
        variable: currentGoogleCloudAuthKey.data,
        state: currentGoogleCloudAuthKey.state,
        setFunction: setGoogleCloudAuthKey,
        deleteFunction: deleteGoogleCloudAuthKey,
        label: t("config_page.translation.google_cloud_auth_key.label"),
    });

    return (
        <AuthKeyContainer
            label={t("config_page.translation.google_cloud_auth_key.label")}
            desc={t("config_page.translation.google_cloud_auth_key.desc")}
            webpage_url={google_cloud_auth_key_url}
            variable={variable}
            state={currentGoogleCloudAuthKey.state}
            onChangeFunction={onChangeFunction}
            saveFunction={saveFunction}
        />
    );
};

// Papago needs two values. The Client ID is saved first; the secret is checked with it.
const PapagoClientID_Box = () => {
    const { t } = useI18n();
    const { currentPapagoClientID, setPapagoClientID } = useTranslation();

    const { variable, onChangeFunction, saveFunction } = useSaveButtonLogic({
        variable: currentPapagoClientID.data,
        state: currentPapagoClientID.state,
        setFunction: setPapagoClientID,
        label: t("config_page.translation.papago_client_id.label"),
    });

    return (
        <EntryWithSaveButtonContainer
            label={t("config_page.translation.papago_client_id.label")}
            desc={t("config_page.translation.papago_client_id.desc")}
            variable={variable}
            saveFunction={saveFunction}
            onChangeFunction={onChangeFunction}
            state={currentPapagoClientID.state}
            remove_border_bottom={true}
        />
    );
};
const PapagoAuthKey_Box = () => {
    const { t } = useI18n();
    const { currentPapagoAuthKey, setPapagoAuthKey, deletePapagoAuthKey } = useTranslation();

    const { variable, onChangeFunction, saveFunction } = useSaveButtonLogic({
        variable: currentPapagoAuthKey.data,
        state: currentPapagoAuthKey.state,
        setFunction: setPapagoAuthKey,
        deleteFunction: deletePapagoAuthKey,
        label: t("config_page.translation.papago_auth_key.label"),
    });

    return (
        <AuthKeyContainer
            label={t("config_page.translation.papago_auth_key.label")}
            webpage_url={papago_auth_key_url}
            variable={variable}
            state={currentPapagoAuthKey.state}
            onChangeFunction={onChangeFunction}
            saveFunction={saveFunction}
        />
    );
};

const PlamoAuthKey_Box = () => {
    const { t } = useI18n();
    const { currentPlamoAuthKey, setPlamoAuthKey, deletePlamoAuthKey } = useTranslation();

    const { variable, onChangeFunction, saveFunction } = useSaveButtonLogic({
        variable: currentPlamoAuthKey.data,
        state: currentPlamoAuthKey.state,
        setFunction: setPlamoAuthKey,
        deleteFunction: deletePlamoAuthKey,
        label: t("config_page.translation.plamo_auth_key.label"),
    });

    return (
        <>
            <AuthKeyContainer
                label={t("config_page.translation.plamo_auth_key.label")}
                // desc="Plamo Auth Desc"
                webpage_url={plamo_auth_key_url}
                variable={variable}
                state={currentPlamoAuthKey.state}
                onChangeFunction={onChangeFunction}
                saveFunction={saveFunction}
                remove_border_bottom={true}
            />
        </>
    );
};
const PlamoModelContainer = () => {
    const { t } = useI18n();
    const {
        currentSelectablePlamoModelList,

        currentSelectedPlamoModel,
        setSelectedPlamoModel,

        currentPlamoAuthKey,
    } = useTranslation();


    const selectFunction = (selected_data) => {
        setSelectedPlamoModel(selected_data.selected_id);
    };


    let selected_label = (!currentPlamoAuthKey.data && !currentSelectedPlamoModel.data) ? t("config_page.common.correct_auth_key_required") : currentSelectedPlamoModel.data;


    return (
        <DropdownMenuContainer
            dropdown_id="select_plamo_model"
            label={t("config_page.translation.select_plamo_model.label")}
            selected_id={selected_label}
            list={currentSelectablePlamoModelList.data}
            selectFunction={selectFunction}
            state={currentSelectedPlamoModel.state}
            is_disabled={!currentPlamoAuthKey.data}
        />
    );
};



const GeminiAuthKey_Box = () => {
    const { t } = useI18n();
    const { currentGeminiAuthKey, setGeminiAuthKey, deleteGeminiAuthKey } = useTranslation();

    const { variable, onChangeFunction, saveFunction } = useSaveButtonLogic({
        variable: currentGeminiAuthKey.data,
        state: currentGeminiAuthKey.state,
        setFunction: setGeminiAuthKey,
        deleteFunction: deleteGeminiAuthKey,
        label: t("config_page.translation.gemini_auth_key.label"),
    });

    return (
        <>
            <AuthKeyContainer
                label={t("config_page.translation.gemini_auth_key.label")}
                // desc="Gemini Auth Desc"
                webpage_url={gemini_auth_key_url}
                variable={variable}
                state={currentGeminiAuthKey.state}
                onChangeFunction={onChangeFunction}
                saveFunction={saveFunction}
                remove_border_bottom={true}
            />
        </>
    );
};
const GeminiModelContainer = () => {
    const { t } = useI18n();
    const {
        currentSelectableGeminiModelList,

        currentSelectedGeminiModel,
        setSelectedGeminiModel,

        currentGeminiAuthKey,
    } = useTranslation();


    const selectFunction = (selected_data) => {
        setSelectedGeminiModel(selected_data.selected_id);
    };

    let selected_label = (!currentGeminiAuthKey.data && !currentSelectedGeminiModel.data)
        ? t("config_page.common.correct_auth_key_required")
        : currentSelectedGeminiModel.data;

    return (
        <DropdownMenuContainer
            dropdown_id="select_gemini_model"
            label={t("config_page.translation.select_gemini_model.label")}
            selected_id={selected_label}
            list={currentSelectableGeminiModelList.data}
            selectFunction={selectFunction}
            state={currentSelectedGeminiModel.state}
            is_disabled={!currentGeminiAuthKey.data}
        />
    );
};


const OpenAIAuthKey_Box = () => {
    const { t } = useI18n();
    const { currentOpenAIAuthKey, setOpenAIAuthKey, deleteOpenAIAuthKey } = useTranslation();

    const { variable, onChangeFunction, saveFunction } = useSaveButtonLogic({
        variable: currentOpenAIAuthKey.data,
        state: currentOpenAIAuthKey.state,
        setFunction: setOpenAIAuthKey,
        deleteFunction: deleteOpenAIAuthKey,
        label: t("config_page.translation.openai_auth_key.label"),
    });

    return (
        <>
            <AuthKeyContainer
                label={t("config_page.translation.openai_auth_key.label")}
                // desc="OpenAI Auth Desc"
                webpage_url={openai_auth_key_url}
                variable={variable}
                state={currentOpenAIAuthKey.state}
                onChangeFunction={onChangeFunction}
                saveFunction={saveFunction}
                remove_border_bottom={true}
            />
        </>
    );
};
const OpenAIModelContainer = () => {
    const { t } = useI18n();
    const {
        currentSelectableOpenAIModelList,

        currentSelectedOpenAIModel,
        setSelectedOpenAIModel,

        currentOpenAIAuthKey,
    } = useTranslation();


    const selectFunction = (selected_data) => {
        setSelectedOpenAIModel(selected_data.selected_id);
    };

    let selected_label = (!currentOpenAIAuthKey.data && !currentSelectedOpenAIModel.data)
        ? t("config_page.common.correct_auth_key_required")
        : currentSelectedOpenAIModel.data;

    return (
        <DropdownMenuContainer
            dropdown_id="select_openai_model"
            label={t("config_page.translation.select_openai_model.label")}
            selected_id={selected_label}
            list={currentSelectableOpenAIModelList.data}
            selectFunction={selectFunction}
            state={currentSelectedOpenAIModel.state}
            is_disabled={!currentOpenAIAuthKey.data}
        />
    );
};


const GroqAuthKey_Box = () => {
    const { t } = useI18n();
    const { currentGroqAuthKey, setGroqAuthKey, deleteGroqAuthKey } = useTranslation();

    const { variable, onChangeFunction, saveFunction } = useSaveButtonLogic({
        variable: currentGroqAuthKey.data,
        state: currentGroqAuthKey.state,
        setFunction: setGroqAuthKey,
        deleteFunction: deleteGroqAuthKey,
        label: t("config_page.translation.groq_auth_key.label"),
    });

    return (
        <>
            <AuthKeyContainer
                label={t("config_page.translation.groq_auth_key.label")}
                // desc="Groq Auth Desc"
                webpage_url={groq_auth_key_url}
                variable={variable}
                state={currentGroqAuthKey.state}
                onChangeFunction={onChangeFunction}
                saveFunction={saveFunction}
                remove_border_bottom={true}
            />
        </>
    );
};
const GroqModelContainer = () => {
    const { t } = useI18n();
    const {
        currentSelectableGroqModelList,

        currentSelectedGroqModel,
        setSelectedGroqModel,

        currentGroqAuthKey,
    } = useTranslation();


    const selectFunction = (selected_data) => {
        setSelectedGroqModel(selected_data.selected_id);
    };

    let selected_label = (!currentGroqAuthKey.data && !currentSelectedGroqModel.data)
        ? t("config_page.common.correct_auth_key_required")
        : currentSelectedGroqModel.data;

    return (
        <DropdownMenuContainer
            dropdown_id="select_groq_model"
            label={t("config_page.translation.select_groq_model.label")}
            selected_id={selected_label}
            list={currentSelectableGroqModelList.data}
            selectFunction={selectFunction}
            state={currentSelectedGroqModel.state}
            is_disabled={!currentGroqAuthKey.data}
        />
    );
};


const OpenRouterAuthKey_Box = () => {
    const { t } = useI18n();
    const { currentOpenRouterAuthKey, setOpenRouterAuthKey, deleteOpenRouterAuthKey } = useTranslation();

    const { variable, onChangeFunction, saveFunction } = useSaveButtonLogic({
        variable: currentOpenRouterAuthKey.data,
        state: currentOpenRouterAuthKey.state,
        setFunction: setOpenRouterAuthKey,
        deleteFunction: deleteOpenRouterAuthKey,
        label: t("config_page.translation.openrouter_auth_key.label"),
    });

    return (
        <>
            <AuthKeyContainer
                label={t("config_page.translation.openrouter_auth_key.label")}
                // desc="OpenRouter Auth Desc"
                webpage_url={openrouter_auth_key_url}
                variable={variable}
                state={currentOpenRouterAuthKey.state}
                onChangeFunction={onChangeFunction}
                saveFunction={saveFunction}
                remove_border_bottom={true}
            />
        </>
    );
};
const OpenRouterModelContainer = () => {
    const { t } = useI18n();
    const {
        currentSelectableOpenRouterModelList,

        currentSelectedOpenRouterModel,
        setSelectedOpenRouterModel,

        currentOpenRouterAuthKey,
    } = useTranslation();


    const selectFunction = (selected_data) => {
        setSelectedOpenRouterModel(selected_data.selected_id);
    };

    let selected_label = (!currentOpenRouterAuthKey.data && !currentSelectedOpenRouterModel.data)
        ? t("config_page.common.correct_auth_key_required")
        : currentSelectedOpenRouterModel.data;

    return (
        <DropdownMenuContainer
            dropdown_id="select_openrouter_model"
            label={t("config_page.translation.select_openrouter_model.label")}
            selected_id={selected_label}
            list={currentSelectableOpenRouterModelList.data}
            selectFunction={selectFunction}
            state={currentSelectedOpenRouterModel.state}
            is_disabled={!currentOpenRouterAuthKey.data}
        />
    );
};

const LMStudioConnectionCheck_Box = () => {
    const { t } = useI18n();
    const { currentIsLMStudioConnected, checkConnection_LMStudio } = useLLMConnection();

    return (
        <>
            <ConnectionCheckButtonContainer
                label={t("config_page.translation.lmstudio_connection_check.label")}
                variable={currentIsLMStudioConnected.data}
                state={currentIsLMStudioConnected.state}
                checkFunction={checkConnection_LMStudio}
                remove_border_bottom={true}
                // width="10rem"
            />
        </>
    );
};
const LMStudioURL_Box = () => {
    const { t } = useI18n();
    const { currentLMStudioURL, setLMStudioURL, deleteLMStudioURL } = useTranslation();

    const { variable, onChangeFunction, saveFunction } = useSaveButtonLogic({
        variable: currentLMStudioURL.data,
        state: currentLMStudioURL.state,
        setFunction: setLMStudioURL,
        deleteFunction: deleteLMStudioURL,
        label: "LM Studio URL",
    });

    return (
        <>
            <EntryWithSaveButtonContainer
                label="LM Studio URL"
                // label={t("config_page.translation.lmstudio_url.label")}
                desc={endpointDescription(variable, "", t)}
                variable={variable}
                saveFunction={saveFunction}
                onChangeFunction={onChangeFunction}
                state={currentLMStudioURL.state}
                remove_border_bottom={true}
            />
        </>
    );
};
const LMStudioModelContainer = () => {
    const { t } = useI18n();
    const {
        currentSelectableLMStudioModelList,

        currentSelectedLMStudioModel,
        setSelectedLMStudioModel,
    } = useTranslation();

    const { currentIsLMStudioConnected } = useLLMConnection();

    const selectFunction = (selected_data) => {
        setSelectedLMStudioModel(selected_data.selected_id);
    };

    let selected_label = (!currentIsLMStudioConnected.data && !currentSelectedLMStudioModel.data)
        ? t("config_page.translation.select_lmstudio_model.connection_required")
        : currentSelectedLMStudioModel.data;

    return (
        <DropdownMenuContainer
            dropdown_id="select_lmstudio_model"
            label={t("config_page.translation.select_lmstudio_model.label")}
            selected_id={selected_label}
            list={currentSelectableLMStudioModelList.data}
            selectFunction={selectFunction}
            state={currentSelectedLMStudioModel.state}
            is_disabled={!currentIsLMStudioConnected.data}
        />
    );
};

const OllamaConnectionCheck_Box = () => {
    const { t } = useI18n();
    const { currentIsOllamaConnected, checkConnection_Ollama } = useLLMConnection();

    return (
        <>
            <ConnectionCheckButtonContainer
                label={t("config_page.translation.ollama_connection_check.label")}
                variable={currentIsOllamaConnected.data}
                state={currentIsOllamaConnected.state}
                checkFunction={checkConnection_Ollama}
                remove_border_bottom={true}
                // width="10rem"
            />
        </>
    );
};
// Where Ollama runs: this PC (the default, localhost:11434) or another PC in the LAN.
const OllamaURL_Box = () => {
    const { t } = useI18n();
    const { currentOllamaURL, setOllamaURL } = useTranslation();

    const { variable, onChangeFunction, saveFunction } = useSaveButtonLogic({
        variable: currentOllamaURL.data,
        state: currentOllamaURL.state,
        setFunction: setOllamaURL,
        label: t("config_page.translation.ollama_url.label"),
    });

    return (
        <EntryWithSaveButtonContainer
            label={t("config_page.translation.ollama_url.label")}
            desc={endpointDescription(variable, t("config_page.translation.ollama_url.desc"), t)}
            variable={variable}
            saveFunction={saveFunction}
            onChangeFunction={onChangeFunction}
            state={currentOllamaURL.state}
            remove_border_bottom={true}
        />
    );
};
const OllamaModelContainer = () => {
    const { t } = useI18n();
    const {
        currentSelectableOllamaModelList,

        currentSelectedOllamaModel,
        setSelectedOllamaModel,
    } = useTranslation();

    const { currentIsOllamaConnected } = useLLMConnection();

    const selectFunction = (selected_data) => {
        setSelectedOllamaModel(selected_data.selected_id);
    };

    let selected_label = (!currentIsOllamaConnected.data && !currentSelectedOllamaModel.data)
        ? t("config_page.translation.select_ollama_model.connection_required")
        : currentSelectedOllamaModel.data;

    return (
        <DropdownMenuContainer
            dropdown_id="select_ollama_model"
            label={t("config_page.translation.select_ollama_model.label")}
            selected_id={selected_label}
            list={currentSelectableOllamaModelList.data}
            selectFunction={selectFunction}
            state={currentSelectedOllamaModel.state}
            is_disabled={!currentIsOllamaConnected.data}
        />
    );
};

const OpenAICompatibleCredentials = () => {
    const settings = useTranslation();
    return <CredentialPair settings={settings} base="OpenAICompatible" provider="openai_compatible" section="translation" />;
};
const OpenAICompatibleModelContainer = () => {
    const { t } = useI18n();
    const {
        currentSelectableOpenAICompatibleModelList,

        currentSelectedOpenAICompatibleModel,
        setSelectedOpenAICompatibleModel,

        currentOpenAICompatibleAuthKey,
    } = useTranslation();

    const selectFunction = (selected_data) => {
        setSelectedOpenAICompatibleModel(selected_data.selected_id);
    };

    const selected_label = (!currentOpenAICompatibleAuthKey.data && !currentSelectedOpenAICompatibleModel.data)
        ? t("config_page.common.correct_auth_key_required")
        : currentSelectedOpenAICompatibleModel.data;

    return (
        <DropdownMenuContainer
            dropdown_id="select_openai_compatible_model"
            label={t("config_page.translation.select_openai_compatible_model.label")}
            selected_id={selected_label}
            list={currentSelectableOpenAICompatibleModelList.data}
            selectFunction={selectFunction}
            state={currentSelectedOpenAICompatibleModel.state}
            is_disabled={!currentOpenAICompatibleAuthKey.data}
        />
    );
};
