import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkUrl, fetchLinkPreview, isPublicIp, parseMeta } from "./linkpreview.js";

describe("prévia de links", () => {
  it("só endereços públicos passam", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "nao-e-ip"])
      expect(isPublicIp(ip), ip).toBe(false);
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) expect(isPublicIp(ip), ip).toBe(true);
  });

  it("só http e https, sem senha na URL e em portas comuns", () => {
    expect(checkUrl("https://exemplo.com/a?b=1")).not.toBeNull();
    for (const u of ["file:///etc/passwd", "ftp://x.com", "javascript:alert(1)", "https://user:pw@x.com", "http://x.com:22", "http://x.com:6379", "lixo"])
      expect(checkUrl(u), u).toBeNull();
  });

  it("lê título e descrição (Open Graph primeiro) e decodifica entidades", () => {
    const html = `<html><head><title>Fallback</title><meta name="description" content="descrição simples">
      <meta property="og:title" content="Jogo &amp; Cia &#233;"><meta property="og:description" content='Uma "boa" página'></head></html>`;
    expect(parseMeta(html)).toEqual({ title: "Jogo & Cia é", description: 'Uma "boa" página' });
    expect(parseMeta("<title> Só título </title>")).toEqual({ title: "Só título", description: null });
    expect(parseMeta("<p>nada</p>")).toEqual({ title: null, description: null });
  });

  describe("busca de verdade", () => {
    let srv: Server;
    let base = "";
    beforeAll(async () => {
      srv = createServer((req, res) => {
        if (req.url === "/ok") res.setHeader("content-type", "text/html").end("<title>Olá</title><meta name=description content=mundo>");
        else if (req.url === "/redir") res.writeHead(302, { location: "/ok" }).end();
        else if (req.url === "/imagem") res.setHeader("content-type", "image/png").end("x");
        else res.writeHead(404).end();
      });
      await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
      base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    });
    afterAll(() => srv.close());

    it("endereço local é recusado por padrão (SSRF)", async () => {
      expect(await fetchLinkPreview(`${base}/ok`)).toBeNull();
      expect(await fetchLinkPreview("http://localhost:8080/ok")).toBeNull();
      expect(await fetchLinkPreview("http://[::1]:8080/ok")).toBeNull();
    });

    it("com o modo de teste, lê a página, segue redirecionamento e ignora o que não é HTML", async () => {
      expect(await fetchLinkPreview(`${base}/ok`, { allowPrivate: true })).toMatchObject({ title: "Olá", description: "mundo" });
      expect(await fetchLinkPreview(`${base}/redir`, { allowPrivate: true })).toMatchObject({ title: "Olá" });
      expect(await fetchLinkPreview(`${base}/imagem`, { allowPrivate: true })).toBeNull();
      expect(await fetchLinkPreview(`${base}/nada`, { allowPrivate: true })).toBeNull();
    });
  });
});
