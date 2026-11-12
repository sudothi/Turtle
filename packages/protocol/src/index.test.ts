import { describe, expect, it } from "vitest";
import { clientEvent, serverEvent, encodeMentions, mentionedIds, registerBody, sendTextBody, splitMentions } from "./index.js";

describe("protocol", () => {
  it("preserva o envio HTTP antigo e valida referências de resposta em HTTP e WebSocket", () => {
    const body = { requestId: "c1a1876a-fdf5-44fa-9ae2-399c691d9ccc", content: "texto" };
    expect(sendTextBody.parse(body)).toEqual(body);
    const replyTo = `send:${"u".repeat(36)}:${body.requestId}`;
    expect(sendTextBody.parse({ ...body, replyTo }).replyTo).toBe(replyTo);
    expect(clientEvent.safeParse({ t: "send", channelId: "c", content: "resposta", replyTo }).success).toBe(true);
    for (const replyTo of ["", "x".repeat(129), null, 42]) {
      expect(sendTextBody.safeParse({ ...body, replyTo }).success).toBe(false);
    }
  });
  it("negocia confirmação durável sem alterar os eventos antigos", () => {
    expect(serverEvent.parse({ t: "pong" })).toEqual({ t: "pong" });
    expect(serverEvent.parse({ t: "pong", confirmedText: true })).toEqual({ t: "pong", confirmedText: true });
    const event = { t: "sendConfirmed", channelId: "c", nonce: "c1a1876a-fdf5-44fa-9ae2-399c691d9ccc", content: " oi ", replyTo: "original" };
    expect(clientEvent.parse(event)).toEqual({ ...event, content: "oi" });
    expect(clientEvent.safeParse({ ...event, nonce: "legado" }).success).toBe(false);
    expect(clientEvent.safeParse({ ...event, content: " " }).success).toBe(false);
    expect(serverEvent.parse({ t: "error", nonce: event.nonce, status: 400, code: "REPLY_UNAVAILABLE", error: "apagada" })).toMatchObject({ status: 400, code: "REPLY_UNAVAILABLE" });
  });
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
