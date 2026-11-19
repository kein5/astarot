import { useEffect, useRef } from "react";
import { useI18n } from "@useI18n";
import { useVcRuntimes } from "../../../../../../logics/voice/useVcRuntimes";
import { VcRuntimeSetup } from "../advanced_settings/VcRuntimeSetup";

// llama.cpp's server, which runs a translation LLM such as TranslateGemma (ADR-015). The app does
// not ship it: its Vulkan build, which runs on the GPU or the CPU, is fetched from llama.cpp's
// GitHub release after the user's consent, through the same runtime setup as the GPU builds of
// ONNX Runtime. Only that build is offered (decision 5 of the LLM runtime plan). Where the
// backend does not offer it (another platform), this renders nothing.
export const LLAMACPP_RUNTIMES = ["llamacpp-vulkan"];

// onInstalled: called when a build comes or goes, so the catalog asks again which entries can run.
export const TranslationLlamaRuntimes = ({ onInstalled } = {}) => {
    const { t } = useI18n();
    const { catalog, state, send } = useVcRuntimes();
    useEffect(() => {
        send("/get/data/vc_runtime_catalog"); send("/get/data/vc_runtime_state");
    }, [send]);
    const installed = LLAMACPP_RUNTIMES.filter(id => state.installed[id]).join(",");
    const seen = useRef(installed);
    useEffect(() => {
        if (installed === seen.current) return;
        seen.current = installed;
        onInstalled?.();
    }, [installed, onInstalled]);
    const offered = LLAMACPP_RUNTIMES.filter(id => catalog?.runtimes?.some(row => row.id === id));
    if (offered.length === 0) return null;
    return <div role="group" aria-label={t("translation_catalog.llamacpp.label")}>
        <h4>{t("translation_catalog.llamacpp.label")}</h4>
        <p>{t("translation_catalog.llamacpp.desc")}</p>
        {offered.map(id => <VcRuntimeSetup key={id} engine={id} />)}
    </div>;
};
