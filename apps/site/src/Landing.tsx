import type { MouseEvent } from "react";
import { TurtleMark } from "@turtle/ui";
import { DesktopDownload } from "./DesktopDownload";
import { APP_URL } from "./config";
import { SwimmingTurtle } from "./SwimmingTurtle";
import { WaitlistForm } from "./WaitlistForm";

export type LandingTab = "waitlist" | "download";

/** Site público: fila de espera em / e download em /download. O app fica em outro domínio. */
export function Landing({ tab, go }: { tab: LandingTab; go: (path: string) => void }) {
  const home = "/";
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
        <nav className="landing-nav" aria-label="Site">
          <a href="/download" className={`landing-tab${tab === "download" ? " active" : ""}`} aria-current={tab === "download" ? "page" : undefined} onClick={link("/download")}>
            Download
          </a>
          <a href={APP_URL} className="t-btn lino sm landing-login">Entrar</a>
        </nav>
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
