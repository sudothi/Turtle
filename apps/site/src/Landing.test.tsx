import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Landing } from "./Landing";
import { APP_URL } from "./config";

describe("site público", () => {
  it("mostra a tartaruga, o formulário da fila de espera e o link para entrar no app", () => {
    const html = renderToStaticMarkup(<Landing tab="waitlist" go={vi.fn()} />);
    expect(html).toContain("swim-turtle");
    expect(html).toContain('type="email"');
    expect(html).toContain("Entrar na lista");
    expect(html).toContain(`href="${APP_URL}"`);
    expect(html).toContain('href="/download"');
  });
  it("mostra o download sem o formulário", () => {
    const html = renderToStaticMarkup(<Landing tab="download" go={vi.fn()} />);
    expect(html).toContain("Baixar o Turtle");
    expect(html).not.toContain('type="email"');
  });
});
