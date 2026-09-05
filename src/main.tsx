import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./ui/components/ErrorBoundary";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/shell.css";
import "./styles/controls.css";
import "./styles/ui.css";
import "./styles/views.css";
import "./styles/calendar.css";
import "./styles/notes.css";
import "./styles/overlays.css";

import { useStore } from "./state/store";

// Dev only: lets a headless browser drive the real app to check real layout,
// which jsdom cannot measure. Stripped from production builds.
if (import.meta.env.DEV) {
  (window as unknown as { __tempoStore?: unknown }).__tempoStore = useStore;
}

const container = document.getElementById("root");
if (!container) throw new Error("Root element not found");

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
