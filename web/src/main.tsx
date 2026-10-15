import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { App } from "@/app/router";
import { ErrorBoundary } from "@/components/error-boundary";
import "./original-styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ErrorBoundary fullScreen>
        <App />
      </ErrorBoundary>
    </BrowserRouter>
  </StrictMode>,
);
