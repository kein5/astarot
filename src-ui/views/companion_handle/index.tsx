import { createRoot } from "react-dom/client";
import "../../../locales/config";
import { CompanionHandle } from "./CompanionHandle.tsx";

const root = document.getElementById("root");
if (root) createRoot(root).render(<CompanionHandle />);
