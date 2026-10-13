import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applySavedLocale } from "./i18n";
import { applyTheme, readSavedTheme } from "./themes";
import "katex/dist/katex.min.css";
import "./styles/chrome.css";
import "./styles/content.css";

applySavedLocale();
applyTheme(readSavedTheme());

const root = document.getElementById("root");
if (!root) {
  throw new Error("Missing #root");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
