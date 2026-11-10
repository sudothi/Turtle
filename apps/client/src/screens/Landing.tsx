import type { MouseEvent } from "react";
import { TurtleMark } from "@turtle/ui";
import { DesktopDownload } from "../components/DesktopDownload";
import { SwimmingTurtle } from "./SwimmingTurtle";
import { WaitlistForm } from "./WaitlistForm";

export type LandingTab = "waitlist" | "home" | "download";

/** Shared public design: waiting list at /, existing entry page at /entrar. */
export function Landing({ tab, loggedIn, go }: { tab: LandingTab; loggedIn: boolean; go: (path: string) => void }) {
  const home = tab === "waitlist" ? "/" : "/entrar";
  const link = (path: string) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    go(path);
  };
  return (
    <main className={`landing lino-live${tab === "waitlist" ? " landing-waitlist" : ""}`}>
      <header className="landing-top">
        <a href={home} className="landing-brand" onClick={link(home)}>
          <TurtleMark size={30} />
          <span className="t-display">Turtle</span>
        </a>
        {tab !== "waitlist" && <nav className="landing-nav" aria-label="Site">
          <a href="/download" className={`landing-tab${tab === "download" ? " active" : ""}`} aria-current={tab === "download" ? "page" : undefined} onClick={link("/download")}>
            Download
          </a>
          <a href={loggedIn ? "/app" : "/login"} className="t-btn lino sm landing-login" onClick={link(loggedIn ? "/app" : "/login")}>
            {loggedIn ? "Abrir o app" : "Entrar"}
          </a>
        </nav>}
      </header>

      {tab === "waitlist" && <WaitlistForm />}

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
