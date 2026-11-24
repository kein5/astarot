import { useEffect, useRef } from "react";
import { useI18n } from "@useI18n";
import { useVcRuntimes } from "../../../../../../logics/voice/useVcRuntimes";
import { VcRuntimeSetup } from "../advanced_settings/VcRuntimeSetup";
import { catalogHeading } from "../advanced_settings/catalogHeading";
import { useHintDescriptions } from "../_components/hint/Hint";
import * as styles from "../advanced_settings/VoiceSettings.css.ts";

// llama.cpp's server, which runs a translation LLM such as TranslateGemma (ADR-015). The app does
// not ship it: its Vulkan build, which runs on the GPU or the CPU, is fetched from llama.cpp's
// GitHub release after the user's consent, through the same runtime setup as the GPU builds of
// ONNX Runtime. Only that build is offered (decision 5 of the LLM runtime plan). Where the
// backend does not offer it (another platform), this renders nothing.
export const LLAMACPP_RUNTIMES = ["llamacpp-vulkan"];

// onInstalled: called when a build comes or goes, so the catalog asks again which entries can run.
export interface TranslationLlamaRuntimesProps {
    onInstalled?: () => void;
}

export const TranslationLlamaRuntimes = ({ onInstalled }: TranslationLlamaRuntimesProps = {}) => {
    const { t } = useI18n();
    const hints = useHintDescriptions();
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
    // On a page reviewed against #614 (#1112), the explanation sits in the heading's hint while
    // VcRuntimeSetup below shows the download size, license and fetch action at a glance.
    return <div role="group" className={styles.catalog_group} aria-label={t("translation_catalog.llamacpp.label")}>
        {catalogHeading(hints, "h4", t("translation_catalog.llamacpp.label"), [t("translation_catalog.llamacpp.desc")])}
        {offered.map(id => <VcRuntimeSetup key={id} engine={id} />)}
    </div>;
};
