import { createRoot } from "react-dom/client";
import "../../../locales/config";
import "../app/_index_css/root.css";
import { KitLab } from "./KitLab.tsx";

const root = document.getElementById("root");
if (root) createRoot(root).render(<KitLab />);
