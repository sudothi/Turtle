import { describe, expect, it } from "vitest";
import { parseRichText } from "./richtext.js";

describe("formatação das mensagens", () => {
  it("links: pontuação final fica fora e só http(s) vira link", () => {
    expect(parseRichText("veja https://exemplo.com/a?b=1, ok")).toEqual([
      { type: "text", text: "veja " },
      { type: "link", href: "https://exemplo.com/a?b=1", text: "https://exemplo.com/a?b=1" },
      { type: "text", text: ", ok" },
    ]);
    expect(parseRichText("javascript:alert(1)")).toEqual([{ type: "text", text: "javascript:alert(1)" }]);
  });
  it("negrito, itálico, código, bloco e spoiler", () => {
    expect(parseRichText("**a** *b* `c` ||d||").filter((n) => n.type !== "text").map((n) => n.type)).toEqual(["bold", "italic", "code", "spoiler"]);
    expect(parseRichText("```\nlinha *1*\n```")).toEqual([{ type: "codeblock", text: "linha *1*" }]);
  });
  it("não formata dentro de código e não confunde multiplicação ou snake_case", () => {
    expect(parseRichText("`**x**`")).toEqual([{ type: "code", text: "**x**" }]);
    expect(parseRichText("2 * 3 * 4 e meu_nome_aqui")).toEqual([{ type: "text", text: "2 * 3 * 4 e meu_nome_aqui" }]);
  });
  it("link dentro de negrito", () => {
    const n = parseRichText("**https://a.com**");
    expect(n[0]).toMatchObject({ type: "bold", children: [{ type: "link", href: "https://a.com/" }] });
  });
});
