import { describe, expect, it } from "vitest";
import { discoInviteLink, parseDiscoInvite } from "./jukebox";

describe("convite da discoteca no chat", () => {
  it("o endereço vai e volta, e texto comum não vira convite", () => {
    expect(parseDiscoInvite(discoInviteLink("uJ7a-WMy3GErVDmO"))).toBe("uJ7a-WMy3GErVDmO");
    expect(parseDiscoInvite(`  ${discoInviteLink("abc_123")}\n`)).toBe("abc_123");
    expect(parseDiscoInvite("oi turtle://discoteca/abc")).toBeNull();
    expect(parseDiscoInvite("turtle://discoteca/")).toBeNull();
    expect(parseDiscoInvite("https://exemplo.com/discoteca/abc")).toBeNull();
  });
});
