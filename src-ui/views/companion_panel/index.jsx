import React from "react";
import { createRoot } from "react-dom/client";
import "../../../locales/config";
import "../app/_index_css/root.css";
import { CompanionPanel } from "./CompanionPanel";

createRoot(document.getElementById("root")).render(<CompanionPanel />);
