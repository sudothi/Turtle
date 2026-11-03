import { createRoot } from "react-dom/client";
import { theme } from "@turtle/ui";

createRoot(document.getElementById("root")!).render(
  <div style={{ background: theme.background, color: theme.foreground, minHeight: "100vh", display: "grid", placeItems: "center", fontFamily: "sans-serif" }}>
    <h1>Turtle</h1>
  </div>,
);
