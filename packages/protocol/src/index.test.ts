import { describe, expect, it } from "vitest";
import { clientEvent, encodeMentions, mentionedIds, registerBody, splitMentions } from "./index.js";

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
    // só anexo, sem texto, vale
    expect(clientEvent.parse({ t: "send", channelId: "c", content: "", attachments: ["a"] }).t).toBe("send");
  });
  it("valida cadastro", () => {
    expect(() => registerBody.parse({ inviteCode: "x", username: "a", password: "12345678" })).toThrow();
    expect(registerBody.parse({ inviteCode: "x", username: "thiago", password: "12345678" }).username).toBe("thiago");
  });
  it("menções usam o nome de exibição e viram <@id>", () => {
    const people = [
      { userId: "a1", username: "thiago", displayName: "Thi" },
      { userId: "b2", username: "ana", displayName: "Ana Paula" },
      { userId: "c3", username: "anabel", displayName: null },
    ];
    expect(encodeMentions("oi @Thi e @ana paula!", people)).toBe("oi <@a1> e <@b2>!");
    expect(encodeMentions("@thiago", people)).toBe("<@a1>");
    expect(encodeMentions("@anabel tudo bem", people)).toBe("<@c3> tudo bem");
    expect(encodeMentions("@Thiaguinho email@Thi", people)).toBe("@Thiaguinho email@Thi");
    expect(mentionedIds("<@a1> e <@b2>")).toEqual(["a1", "b2"]);
    expect(splitMentions("oi <@a1>!")).toEqual([{ text: "oi " }, { userId: "a1" }, { text: "!" }]);
  });
});
