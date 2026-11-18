import { createRoot } from "react-dom/client";
import "./page.css";
import { CaptionOverlay } from "./CaptionOverlay";

const root = document.getElementById("root");
if (root) createRoot(root).render(<CaptionOverlay />);
