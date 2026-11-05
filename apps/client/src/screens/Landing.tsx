import type { MouseEvent } from "react";
import { TurtleMark } from "@turtle/ui";
import { DesktopDownload } from "../components/DesktopDownload";
import { SwimmingTurtle } from "./SwimmingTurtle";

export type LandingTab = "home" | "download";

/** Página pública do site: tartaruga gigante nadando no canto e abas Download e Entrar no canto direito. */
export function Landing({ tab, loggedIn, go }: { tab: LandingTab; loggedIn: boolean; go: (path: string) => void }) {
  const link = (path: string) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    go(path);
  };
  return (
    <main className="landing lino-live">
      <header className="landing-top">
        <a href="/" className="landing-brand" onClick={link("/")}>
          <TurtleMark size={30} />
          <span className="t-display">Turtle</span>
        </a>
        <nav className="landing-nav" aria-label="Site">
          <a href="/download" className={`landing-tab${tab === "download" ? " active" : ""}`} aria-current={tab === "download" ? "page" : undefined} onClick={link("/download")}>
            Download
          </a>
          <a href={loggedIn ? "/" : "/login"} className="t-btn lino sm landing-login" onClick={link(loggedIn ? "/" : "/login")}>
            {loggedIn ? "Abrir o app" : "Entrar"}
          </a>
        </nav>
      </header>

      {tab === "download" && (
        <section className="landing-panel lino lino-lg" aria-label="Download do app desktop">
          <h1 className="t-display">Baixar o Turtle</h1>
          <DesktopDownload />
        </section>
      )}

      <div className="landing-sea" aria-hidden="true">
        <SwimmingTurtle className="lino-boil-filter" />
      </div>
    </main>
  );
}
