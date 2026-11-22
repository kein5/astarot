import { useCallback } from "react";
import { atom, useAtom } from "jotai";
import type { SwitchBlockId } from "../main/switchBlocks";

// The main screen's switches the first-run setup leads to (#955): after "Done", the switches of
// the features it prepared stand out until each is turned on. Kept for this run only: the UI
// saves no state of its own (docs/spec/data-and-persistence.md).
const leadsAtom = atom<readonly SwitchBlockId[]>([]);

export const useSetupLeads = () => {
    const [leads, setLeads] = useAtom(leadsAtom);
    // The switches to lead to, in place of any before.
    const lead = useCallback((ids: readonly SwitchBlockId[]) => setLeads([...new Set(ids)]), [setLeads]);
    // A switch turned on no longer stands out.
    const settle = useCallback((id: SwitchBlockId) => setLeads(previous => previous.includes(id) ? previous.filter(item => item !== id) : previous), [setLeads]);
    return { leads, lead, settle };
};
