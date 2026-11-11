import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { LinoDefs } from "@turtle/ui";
import "@turtle/ui/styles.css";
import "./site.css";
import { Landing, type LandingTab } from "./Landing";

const tabOf = (path: string): LandingTab => (path.replace(/\/+$/, "") === "/download" ? "download" : "waitlist");

function Site() {
  const [path, setPath] = useState(() => location.pathname);
  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);
  const go = useCallback((to: string) => {
    if (to !== location.pathname) history.pushState(null, "", to);
    setPath(to);
    scrollTo(0, 0);
  }, []);
  return (
    <>
      <LinoDefs />
      <Landing tab={tabOf(path)} go={go} />
    </>
  );
}

createRoot(document.getElementById("root")!).render(<Site />);
