import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initializeWebMCPPolyfill } from "@mcp-b/webmcp-polyfill";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import App from "./App.tsx";
import "./styles/tokens.css";
import "./styles/axiom.css";

initializeWebMCPPolyfill();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
