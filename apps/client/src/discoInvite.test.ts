import { describe, expect, it } from "vitest";
import { discoIdFromPath, discoInviteLink, discoWebLink, parseDiscoInvite } from "./jukebox";

describe("convite da discoteca no chat", () => {
  it("o endereço vai e volta, e texto comum não vira convite", () => {
    expect(parseDiscoInvite(discoInviteLink("uJ7a-WMy3GErVDmO"))).toBe("uJ7a-WMy3GErVDmO");
    expect(parseDiscoInvite(`  ${discoInviteLink("abc_123")}\n`)).toBe("abc_123");
    expect(parseDiscoInvite("oi turtle://discoteca/abc")).toBeNull();
    expect(parseDiscoInvite("turtle://discoteca/")).toBeNull();
    expect(parseDiscoInvite("https://exemplo.com/discoteca/abc")).toBeNull();
  });

  it("o link para copiar abre o app na discoteca", () => {
    const link = discoWebLink("uJ7a-WMy3GErVDmO", "https://app.ogturtle.xyz");
    expect(link).toBe("https://app.ogturtle.xyz/discoteca/uJ7a-WMy3GErVDmO");
    expect(discoIdFromPath(new URL(link).pathname)).toBe("uJ7a-WMy3GErVDmO");
    expect(parseDiscoInvite(link, "https://app.ogturtle.xyz")).toBe("uJ7a-WMy3GErVDmO");
    expect(parseDiscoInvite(`${link}\n`, "https://app.ogturtle.xyz")).toBe("uJ7a-WMy3GErVDmO");
    expect(parseDiscoInvite(link, "https://outro.exemplo")).toBeNull();
    expect(discoIdFromPath("/discoteca/")).toBeNull();
    expect(discoIdFromPath("/convite/abc")).toBeNull();
  });
});
