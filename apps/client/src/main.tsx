import { createRoot } from "react-dom/client";
import { App } from "./App";
import "@turtle/ui/styles.css";
import "./styles.css";
import "./servers.css";
import "./chat.css";

createRoot(document.getElementById("root")!).render(<App />);
