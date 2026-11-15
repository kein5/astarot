import React from "react";
import { createRoot } from "react-dom/client";
import "../../../locales/config";
import "./page.css";
import { CompanionHandle } from "./CompanionHandle";

createRoot(document.getElementById("root")).render(<CompanionHandle />);
