// The local weights the model list of Settings → Translation shows (#565). The translation
// catalog's built-in entries follow the same rule, from the same data, so that both places show the
// same models: the ones on the user's PC, the ones the download catalog offers, the selected one,
// and one being downloaded.
import { useTranslation } from "@logics_configs";
import { useModelDownloads } from "../voice/useModelDownloads";
import { localModelList } from "./localModelList";

export function useListedLocalWeights(): ReadonlySet<string> {
    const { currentCTranslate2WeightTypeStatus, currentSelectedCTranslate2WeightType } = useTranslation();
    const { catalog } = useModelDownloads();
    const rows = localModelList(currentCTranslate2WeightTypeStatus.data, currentSelectedCTranslate2WeightType.data, catalog).rows;
    return new Set(rows.map(row => row.id));
}
