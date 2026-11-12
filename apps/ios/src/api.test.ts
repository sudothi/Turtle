import { expect, it, vi } from "vitest";
import { Api, ApiError } from "./api";
import { messageSchema, userSchema } from "@turtle/protocol";

vi.mock("expo-file-system", () => ({
  File: class extends Blob {
    constructor(readonly uri: string) { super([new Uint8Array([255, 216, 255, 217])], { type: "image/jpeg" }); }
  },
}));

it("does not send an invalid or oversized group to the server", async () => {
  const transport = vi.fn<typeof fetch>();
  const api = new Api("https://example.test", "session", transport);
  expect(() => api.createGroup(["only-one"])).toThrow();
  expect(() => api.createGroup(Array.from({ length: 10 }, (_, i) => String(i)))).toThrow();
  expect(transport).not.toHaveBeenCalled();
});

it("preserves a blocked DM error without retrying the mutation", async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: "não é possível conversar com essa pessoa" }), { status: 403 }));
  const api = new Api("https://example.test", "session", transport);
  await expect(api.openDm("a/b")).rejects.toEqual(new ApiError(403, "não é possível conversar com essa pessoa"));
  expect(transport).toHaveBeenCalledOnce();
  expect(transport).toHaveBeenCalledWith("https://example.test/dms/a%2Fb", expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer session" }) }));
});

it("rejects an incompatible group response rather than navigating with incomplete data", async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ channelId: "room" })));
  await expect(new Api("https://example.test", "session", transport).createGroup(["a", "b"])).rejects.toThrow("incompatível");
});

it.each(["avatar", "banner"] as const)("uploads %s as real multipart bytes with auth and an automatically generated boundary", async kind => {
  const user = userSchema.parse({ id: "self", username: "self", isAdmin: false });
  const transport = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    expect(url).toBe(`https://example.test/me/${kind}`);
    expect(init?.method).toBe("PUT");
    expect(init?.headers).toMatchObject({ authorization: "Bearer session" });
    expect(new Headers(init?.headers).has("content-type")).toBe(false);
    const request = new Request(url, init);
    expect(request.headers.get("content-type")).toMatch(/^multipart\/form-data; boundary=/);
    const form = await request.formData() as unknown as { get(name: string): File };
    const file = form.get("file");
    expect(file.type).toBe("image/jpeg");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([255, 216, 255, 217]));
    return new Response(JSON.stringify(user));
  });
  await expect(new Api("https://example.test", "session", transport).uploadImage(kind, "file:///crop.jpg")).resolves.toEqual(user);
});

it("encodes message IDs and emoji paths and uses idempotent add/remove reaction methods", async () => {
  const message = messageSchema.parse({ id: "send:self/one", channelId: "room", userId: "self", username: "self", content: "texto", createdAt: new Date().toISOString() });
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(message)));
  const api = new Api("https://example.test", "session", transport);
  await api.editMessage(message.id, "editada");
  expect(transport.mock.calls[0]).toMatchObject(["https://example.test/messages/send%3Aself%2Fone", { method: "PATCH", body: JSON.stringify({ content: "editada" }) }]);
  transport.mockResolvedValue(new Response(JSON.stringify(message)));
  await api.setReaction(message.id, "❤️", true);
  expect(transport.mock.calls[1]).toMatchObject([`https://example.test/messages/send%3Aself%2Fone/reactions/${encodeURIComponent("❤️")}`, { method: "PUT", body: undefined }]);
  transport.mockResolvedValue(new Response(JSON.stringify(message)));
  await api.setReaction(message.id, "❤️", false);
  expect(transport.mock.calls[2]?.[1]?.method).toBe("DELETE");
  transport.mockResolvedValue(new Response(JSON.stringify({ ok: true })));
  await api.deleteMessage(message.id);
  expect(transport.mock.calls[3]).toMatchObject(["https://example.test/messages/send%3Aself%2Fone", { method: "DELETE" }]);
});

it("sends replies to a route that cannot silently downgrade to plain text", async () => {
  const body = { requestId: "c1a1876a-fdf5-44fa-9ae2-399c691d9ccc", content: "resposta", replyTo: "send:friend:original" };
  const saved = messageSchema.parse({ id: "reply", channelId: "a/b", userId: "self", username: "self", content: body.content, createdAt: new Date().toISOString(), replyToId: body.replyTo });
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(saved)));
  const api = new Api("https://example.test", "session", transport);
  await api.sendText("a/b", body);
  expect(transport).toHaveBeenCalledWith("https://example.test/channels/a%2Fb/messages/replies", expect.objectContaining({ method: "POST", body: JSON.stringify(body) }));
  transport.mockResolvedValue(new Response(JSON.stringify({ error: "Not Found", message: "Route POST not found" }), { status: 404 }));
  await expect(api.sendText("a/b", body)).rejects.toMatchObject({ code: "REPLIES_UNSUPPORTED" });
  expect(transport).toHaveBeenCalledTimes(2);
  expect(transport.mock.calls.every(([url]) => String(url).endsWith("/messages/replies"))).toBe(true);
});

it("preserves an unavailable reply error code so cached quotes can be cleared", async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: "mensagem apagada", code: "REPLY_UNAVAILABLE" }), { status: 400 }));
  await expect(new Api("https://example.test", "session", transport).sendText("a", { requestId: "c1a1876a-fdf5-44fa-9ae2-399c691d9ccc", content: "resposta", replyTo: "gone" })).rejects.toMatchObject({ status: 400, code: "REPLY_UNAVAILABLE" });
});
