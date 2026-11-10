import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Landing } from "./Landing";

describe("public landing", () => {
  it("preserves the turtle and email form while removing login and download links from the waiting list", () => {
    const html = renderToStaticMarkup(<Landing tab="waitlist" loggedIn={false} go={vi.fn()} />);
    expect(html).toContain("swim-turtle");
    expect(html).toContain('type="email"');
    expect(html).toContain("Entrar na lista");
    expect(html).not.toContain('href="/login"');
    expect(html).not.toContain('href="/entrar"');
    expect(html).not.toContain('href="/download"');
  });
  it("keeps the public entry page at /inicio and its login action at the original /entrar", () => {
    const html = renderToStaticMarkup(<Landing tab="home" loggedIn={false} go={vi.fn()} />);
    expect(html).toContain('href="/inicio"');
    expect(html).toContain('href="/entrar"');
    expect(html).toContain('href="/download"');
    expect(html).not.toContain('type="email"');
  });
  it("opens the authenticated workspace without navigating back to the waiting list", () => {
    const html = renderToStaticMarkup(<Landing tab="home" loggedIn go={vi.fn()} />);
    expect(html).toContain('href="/app"');
    expect(html).toContain("Abrir o app");
  });
});
