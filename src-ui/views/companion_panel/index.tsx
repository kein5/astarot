import { createRoot } from "react-dom/client";
import "../../../locales/config";
import "../app/_index_css/root.css";
import { CompanionPanel } from "./CompanionPanel.tsx";

const root = document.getElementById("root");
if (root) createRoot(root).render(<CompanionPanel />);
