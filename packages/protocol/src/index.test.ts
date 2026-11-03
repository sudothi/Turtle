import { describe, expect, it } from "vitest";
import { clientEvent, registerBody } from "./index.js";

describe("protocol", () => {
  it("aceita ping e send", () => {
    expect(clientEvent.parse({ t: "ping" })).toEqual({ t: "ping" });
    expect(clientEvent.parse({ t: "send", channelId: "c", content: " oi " }).t).toBe("send");
  });
  it("aceita entrar e sair da voz", () => {
    expect(clientEvent.parse({ t: "voice", channelId: "c", muted: true, deafened: false }).t).toBe("voice");
    expect(clientEvent.parse({ t: "voice", channelId: null, muted: false, deafened: false }).t).toBe("voice");
  });
  it("rejeita evento desconhecido e mensagem vazia", () => {
    expect(() => clientEvent.parse({ t: "nope" })).toThrow();
    expect(() => clientEvent.parse({ t: "send", channelId: "c", content: "  " })).toThrow();
  });
  it("valida cadastro", () => {
    expect(() => registerBody.parse({ inviteCode: "x", username: "a", password: "12345678" })).toThrow();
    expect(registerBody.parse({ inviteCode: "x", username: "thiago", password: "12345678" }).username).toBe("thiago");
  });
});
