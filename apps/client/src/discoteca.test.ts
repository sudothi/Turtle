import { describe, expect, it } from "vitest";
import { inviteContent, parseInvite } from "./discoteca";

describe("convite da discoteca", () => {
  it("reconhece só a mensagem que é exatamente o convite", () => {
    expect(parseInvite(inviteContent("abc_123-X"))).toBe("abc_123-X");
    expect(parseInvite(`  ${inviteContent("abc")}\n`)).toBe("abc");
    expect(parseInvite("veja turtle://discoteca/abc")).toBeUndefined();
    expect(parseInvite("turtle://discoteca/")).toBeUndefined();
    expect(parseInvite("turtle://discoteca/a b")).toBeUndefined();
    expect(parseInvite("oi")).toBeUndefined();
  });
});
