// The VR panel's "Inputs and outputs" window at its real size (the popup region of
// src-ui/views/vr/vr_layout.json), with the sample of tests/voice/fixtures/io_flow_sample.json in
// the atoms the main window mirrors to VR: for the user guide's screenshots (docsScreenshots.spec.ts).
import { getDefaultStore } from "jotai";
import type { Atom, WritableAtom } from "jotai";
import { createRoot } from "react-dom/client";
import i18n from "../../../locales/config";
import { Atom_IoFlow, Atom_IoTraces, dynamicStoreRegistry } from "../../../src-ui/logics/store";
import "../../../src-ui/views/app/_index_css/root.css";
import { VrIoFlowWindow } from "../../../src-ui/views/vr/VrIoFlowWindow";
import layout from "../../../src-ui/views/vr/vr_layout.json";
import sample from "../../voice/fixtures/io_flow_sample.json";

void i18n.changeLanguage(new URLSearchParams(location.search).get("lang") || "ja");
const atoms = getDefaultStore();
type Writable = WritableAtom<any, [any], void>;
for (const [name, atom] of Object.entries(dynamicStoreRegistry)) {
    if (name.startsWith("Atom_")) atoms.set(atom as Writable, { ...(atoms.get(atom as Atom<object>) as object), state: "ok" });
}
atoms.set(Atom_IoFlow as unknown as Writable, { state: "ok", data: sample.flow });
atoms.set(Atom_IoTraces as unknown as Writable, { state: "ok", data: sample.traces });
const [, , width, height] = layout.regions.popup;

const root = document.getElementById("root");
if (root) {
    createRoot(root).render(
        <div style={{ width, height, background: "var(--dark_1000_color)" }}>
            <VrIoFlowWindow onClose={() => {}} />
        </div>,
    );
}
